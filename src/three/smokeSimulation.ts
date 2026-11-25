import * as THREE from 'three';
import { DmxUniversesMap } from '../gdtf/dmxEngine';
import { RenderMode, SceneObject } from '../types/visualizer';

const SELECTED_COLOR = 0xff3b30;
const SMOKE_WIRE_COLOR = 0x5d8aa8;

export interface ResolvedSmokeState {
  legacyModel: boolean;
  speedPct: number; // 0..200
  autoSize: boolean;
  width: number; // meters
  height: number; // meters
  depth: number; // meters
  densityPct: number; // 0..100
  variationPct: number; // 0..100
  edgeSoftnessPct: number; // 0..100
  patch: string;
  isPatched: boolean;
  patchUniverse: number;
  patchAddress: number;
}

export function parseSmokePatch(patch?: string): {
  isPatched: boolean;
  universe: number;
  address: number;
} {
  if (!patch || patch === 'Unpatched') {
    return { isPatched: false, universe: 1, address: 1 };
  }
  const m = patch.match(/^(\d+)\.(\d+)$/);
  if (!m) {
    return { isPatched: false, universe: 1, address: 1 };
  }
  const universe = Math.max(1, Math.min(4, Number(m[1]) || 1));
  const address = Math.max(1, Math.min(511, Number(m[2]) || 1));
  return { isPatched: true, universe, address };
}

export function resolveSmokeParameters(
  obj: SceneObject,
  dmxUniverses?: DmxUniversesMap,
): ResolvedSmokeState {
  const patchStr = obj.smokePatch ?? 'Unpatched';
  const parsed = parseSmokePatch(patchStr);
  let densityPct = obj.smokeDensity ?? 1.3;
  let speedPct = obj.smokeSpeed ?? 0;

  if (parsed.isPatched && dmxUniverses) {
    const buf = dmxUniverses[parsed.universe];
    if (buf) {
      const chDensity = buf[parsed.address - 1] ?? 0;
      const chSpeed = buf[parsed.address] ?? 0;
      // DMX Ch+0 controls haze density (0..15%), Ch+1 controls fan drift speed (0..150%)
      densityPct = Number(((chDensity / 255) * 15).toFixed(1));
      speedPct = Math.round((chSpeed / 255) * 150);
    }
  }

  return {
    legacyModel: Boolean(obj.smokeLegacyModel),
    speedPct: Math.max(0, Math.min(200, speedPct)),
    autoSize: Boolean(obj.smokeAutoSize),
    width: Math.max(1, obj.smokeWidth ?? 16),
    height: Math.max(1, obj.smokeHeight ?? 7),
    depth: Math.max(1, obj.smokeDepth ?? 12),
    densityPct: Math.max(0, Math.min(100, densityPct)),
    variationPct: Math.max(0, Math.min(100, obj.smokeVariation ?? 100)),
    edgeSoftnessPct: Math.max(0, Math.min(100, obj.smokeEdgeSoftness ?? 37.9)),
    patch: patchStr,
    isPatched: parsed.isPatched,
    patchUniverse: parsed.universe,
    patchAddress: parsed.address,
  };
}

export function computeAutoSmokeBounds(objects: SceneObject[]): {
  position: [number, number, number];
  width: number;
  height: number;
  depth: number;
} {
  const nonSmoke = objects.filter((o) => o.kind !== 'smoke-volume' && !o.hidden);
  if (nonSmoke.length === 0) {
    return {
      position: [0, 3.5, 0],
      width: 16,
      height: 7,
      depth: 12,
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const o of nonSmoke) {
    const halfX = (o.length ?? o.width ?? 1.2) * 0.5;
    const halfY = o.kind === 'stage-deck' ? 0.4 : 0.6;
    const halfZ = (o.width ?? 1.2) * 0.5;
    minX = Math.min(minX, o.position[0] - halfX);
    maxX = Math.max(maxX, o.position[0] + halfX);
    minY = Math.min(minY, Math.max(0, o.position[1] - halfY));
    maxY = Math.max(maxY, o.position[1] + halfY);
    minZ = Math.min(minZ, o.position[2] - halfZ);
    maxZ = Math.max(maxZ, o.position[2] + halfZ);
  }

  const padX = 5.0;
  const padY = 2.4;
  const padZ = 5.0;

  const width = Number(Math.max(10, maxX - minX + padX * 2).toFixed(1));
  const height = Number(Math.max(6, maxY - minY + padY).toFixed(1));
  const depth = Number(Math.max(10, maxZ - minZ + padZ * 2).toFixed(1));

  const cx = Number(((minX + maxX) * 0.5).toFixed(2));
  const cy = Number((height * 0.5).toFixed(2));
  const cz = Number(((minZ + maxZ) * 0.5).toFixed(2));

  return {
    position: [cx, cy, cz],
    width,
    height,
    depth,
  };
}

/**
 * Computes overall atmospheric fog & beam scatter boost from visible smoke volumes
 * exclusively for the 3D Live rendering viewport.
 */
export function computeLiveSmokeAtmosphere(
  objects: SceneObject[],
  layersVisibleMap: Map<string, boolean>,
  showHidden: boolean,
  dmxUniverses: DmxUniversesMap,
): {
  hasSmoke: boolean;
  fogDensity: number;
  beamBoost: number;
  legacyActive: boolean;
  maxSpeedPct: number;
  scatterColor: THREE.Color;
} {
  const activeSmokes = objects.filter((o) => {
    if (o.kind !== 'smoke-volume') return false;
    const layerOk = o.layerId ? (layersVisibleMap.get(o.layerId) ?? true) : true;
    if (!layerOk) return false;
    if (o.hidden && !showHidden) return false;
    return true;
  });

  // Compute dominant scatter tint from active lit fixtures
  const scatterColor = new THREE.Color(0x9ec5dc);
  const litFixtures = objects.filter(
    (o) =>
      (o.kind === 'moving-head' || o.kind === 'led-par' || o.kind === 'gdtf-fixture') &&
      !o.hidden &&
      (o.throwsLight ?? true) &&
      (o.intensity ?? 0) > 0.05,
  );
  if (litFixtures.length > 0) {
    let r = 0;
    let g = 0;
    let b = 0;
    let weightSum = 0;
    const tmp = new THREE.Color();
    for (const fx of litFixtures) {
      const w = fx.intensity ?? 0.5;
      tmp.set(fx.color ?? '#ffffff');
      r += tmp.r * w;
      g += tmp.g * w;
      b += tmp.b * w;
      weightSum += w;
    }
    if (weightSum > 0) {
      scatterColor.setRGB(
        THREE.MathUtils.lerp(0.65, r / weightSum, 0.55),
        THREE.MathUtils.lerp(0.76, g / weightSum, 0.55),
        THREE.MathUtils.lerp(0.86, b / weightSum, 0.55),
      );
    }
  }

  if (activeSmokes.length === 0) {
    return {
      hasSmoke: false,
      fogDensity: 0.012,
      beamBoost: 0.85,
      legacyActive: false,
      maxSpeedPct: 0,
      scatterColor,
    };
  }

  let maxDensity = 0;
  let maxSpeedPct = 0;
  let legacyActive = false;

  for (const s of activeSmokes) {
    const resolved = resolveSmokeParameters(s, dmxUniverses);
    maxDensity = Math.max(maxDensity, resolved.densityPct);
    maxSpeedPct = Math.max(maxSpeedPct, resolved.speedPct);
    if (resolved.legacyModel) legacyActive = true;
  }

  // Normalized effective density curve (1.3% is realistic theatrical haze; 10%+ is thick fog)
  const norm = THREE.MathUtils.clamp(maxDensity / 12.0, 0, 1.5);
  const fogDensity = legacyActive
    ? 0.014 + norm * 0.055
    : 0.008 + norm * 0.036;
  const beamBoost = THREE.MathUtils.clamp(0.75 + norm * 1.15, 0.65, 2.1);

  return {
    hasSmoke: true,
    fogDensity,
    beamBoost,
    legacyActive,
    maxSpeedPct,
    scatterColor,
  };
}

/**
 * Builds CAD center emitter icon and selection-only wireframe bounding cage.
 * The bounding box / helper cage is rendered strictly when isSelected === true
 * and is bound directly as a child of root (inheriting Position & Rotation matrices).
 */
export function buildSmokeCadGroup(
  root: THREE.Group,
  obj: SceneObject,
  renderMode: RenderMode,
  isSelected: boolean,
  strokeColorHex = SMOKE_WIRE_COLOR,
): void {
  const resolved = resolveSmokeParameters(obj);
  const w = resolved.width;
  const h = resolved.height;
  const d = resolved.depth;

  const wireColor = isSelected ? SELECTED_COLOR : strokeColorHex;

  // 1. Selection-only Bounding Box & Helper Cage (strictly hidden when deselected)
  if (isSelected) {
    const boxGeo = new THREE.BoxGeometry(w, h, d);
    const edgesGeo = new THREE.EdgesGeometry(boxGeo, 1);
    boxGeo.dispose();

    const lineMat = new THREE.LineBasicMaterial({
      color: 0xff9500,
      transparent: true,
      opacity: 0.94,
      toneMapped: false,
    });
    const boundsLines = new THREE.LineSegments(edgesGeo, lineMat);
    boundsLines.userData.isEdgeLine = true;
    boundsLines.userData.isSelectionHelper = true;
    root.add(boundsLines);

    // 8 small corner grips directly in root's local bounds space
    const cornerGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const cornerMat = new THREE.MeshBasicMaterial({
      color: SELECTED_COLOR,
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
    });
    const hw = w * 0.5;
    const hh = h * 0.5;
    const hd = d * 0.5;
    const signs = [-1, 1];
    for (const sx of signs) {
      for (const sy of signs) {
        for (const sz of signs) {
          const corner = new THREE.Mesh(cornerGeo, cornerMat);
          corner.position.set(sx * hw, sy * hh, sz * hd);
          root.add(corner);
        }
      }
    }
  }

  // 2. Clickable Center Haze Emitter Icon (visible in CAD views or when selected in Live)
  if (renderMode !== 'live' || isSelected) {
    const coreGeo = new THREE.OctahedronGeometry(0.28, 0);
    const coreMat = new THREE.MeshBasicMaterial({
      color: wireColor,
      wireframe: renderMode === 'wireframe',
      transparent: true,
      opacity: isSelected ? 0.95 : 0.8,
      toneMapped: false,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    root.add(core);

    const ringGeo = new THREE.RingGeometry(0.36, 0.44, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: wireColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    root.add(ring);
  }
}

export interface LiveSmokeHandle {
  objectId: string;
  root: THREE.Group;
  sliceMaterial: THREE.ShaderMaterial;
  particleMaterial: THREE.ShaderMaterial;
  sliceGroup: THREE.Group;
  particles: THREE.Points;
}

const VOLUMETRIC_SLICE_VERT = `
  varying vec3 vLocalPos;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vLocalPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VOLUMETRIC_SLICE_FRAG = `
  uniform float uTime;
  uniform float uDensity;
  uniform float uVariation;
  uniform float uEdgeSoftness;
  uniform float uLegacyModel;
  uniform vec3 uHalfBounds;
  uniform vec3 uScatterColor;

  varying vec3 vLocalPos;
  varying vec2 vUv;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise3D(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(
        mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x),
        f.y
      ),
      mix(
        mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x),
        f.y
      ),
      f.z
    );
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < 3; i++) {
      v += a * noise3D(p);
      p = p * 2.03 + vec3(1.7, 9.2, 4.1);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Normalized distance to outer 6 faces of the volume box [0 at boundary -> 1 at center]
    vec3 absNorm = abs(vLocalPos) / max(uHalfBounds, vec3(0.001));
    float maxAxis = max(absNorm.x, max(absNorm.y, absNorm.z));
    if (maxAxis > 1.0) discard;

    float edgeFade = 1.0;
    if (uLegacyModel < 0.5) {
      float soft = clamp(uEdgeSoftness, 0.01, 1.0);
      vec3 distFromEdge = max(vec3(0.0), 1.0 - absNorm);
      vec3 edgeAxes = smoothstep(0.0, soft, distFromEdge);
      edgeFade = edgeAxes.x * edgeAxes.y * edgeAxes.z;
    }

    vec3 driftPos = vLocalPos * 0.24 + vec3(uTime * 0.35, uTime * 0.14, -uTime * 0.22);
    float n = fbm(driftPos);

    // Variation blends between uniform smooth mist and swirling volumetric cloud pockets
    float cloudPattern = mix(0.68, smoothstep(0.22, 0.84, n), uVariation);

    // Legacy atmospheric rendering uses flatter uniform density without volumetric pockets
    float pattern = mix(cloudPattern, 0.52, uLegacyModel * 0.78);

    float alpha = clamp(uDensity * edgeFade * pattern * 0.16, 0.0, 0.42);
    if (alpha < 0.002) discard;

    vec3 tint = mix(vec3(0.55, 0.64, 0.72), uScatterColor, 0.65);
    gl_FragColor = vec4(tint, alpha);
  }
`;

const PARTICLE_VERT = `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uVariation;
  uniform vec3 uHalfBounds;
  uniform float uPointScale;

  attribute float aSeed;
  varying float vSeed;
  varying vec3 vNormPos;

  void main() {
    vSeed = aSeed;
    vec3 pos = position * uHalfBounds;

    // Smooth turbulent drift bounded smoothly inside the volume
    float phase = uTime * (0.4 + aSeed * 0.5);
    float amp = mix(0.04, 0.45, uVariation);
    if (uSpeed > 0.0001) {
      pos.x += sin(phase + aSeed * 19.1) * amp * uHalfBounds.x * 0.12;
      pos.y += cos(phase * 0.7 + aSeed * 11.7) * amp * uHalfBounds.y * 0.10;
      pos.z += sin(phase * 0.85 + aSeed * 29.3) * amp * uHalfBounds.z * 0.12;
    }

    vNormPos = pos / max(uHalfBounds, vec3(0.001));
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float dist = max(1.0, -mvPos.z);
    gl_PointSize = clamp((uPointScale * (0.7 + aSeed * 0.8)) / dist, 4.0, 120.0);
  }
`;

const PARTICLE_FRAG = `
  uniform float uDensity;
  uniform float uEdgeSoftness;
  uniform float uLegacyModel;
  uniform float uVariation;
  uniform vec3 uScatterColor;

  varying float vSeed;
  varying vec3 vNormPos;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float r = length(centered) * 2.0;
    if (r > 1.0) discard;

    float radial = pow(1.0 - r, mix(1.4, 2.2, 1.0 - uLegacyModel));

    float edgeFade = 1.0;
    if (uLegacyModel < 0.5) {
      float soft = clamp(uEdgeSoftness, 0.02, 1.0);
      vec3 distFromEdge = max(vec3(0.0), 1.0 - abs(vNormPos));
      vec3 edgeAxes = smoothstep(0.0, soft, distFromEdge);
      edgeFade = edgeAxes.x * edgeAxes.y * edgeAxes.z;
    }

    float seedAlpha = mix(0.75, 0.35 + vSeed * 0.65, uVariation);
    float alpha = clamp(radial * edgeFade * seedAlpha * uDensity * 0.24, 0.0, 0.55);
    if (alpha < 0.003) discard;

    vec3 col = mix(vec3(0.7, 0.78, 0.85), uScatterColor, 0.7);
    gl_FragColor = vec4(col, alpha);
  }
`;

/**
 * Creates a volumetric smoke/haze simulation rig visible exclusively in Live mode.
 */
export function createLiveSmokeRig(
  obj: SceneObject,
  dmxUniverses: DmxUniversesMap,
  scatterColor: THREE.Color,
  isSoftwareGl: boolean,
): LiveSmokeHandle {
  const resolved = resolveSmokeParameters(obj, dmxUniverses);
  const root = new THREE.Group();
  root.name = `live-smoke-${obj.id}`;
  root.userData.objectId = obj.id;
  root.position.set(obj.position[0], obj.position[1], obj.position[2]);
  root.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);

  const halfBounds = new THREE.Vector3(resolved.width * 0.5, resolved.height * 0.5, resolved.depth * 0.5);
  const densityNorm = THREE.MathUtils.clamp(resolved.densityPct / 8.0, 0, 2.2);

  const sliceMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDensity: { value: densityNorm },
      uVariation: { value: resolved.variationPct / 100 },
      uEdgeSoftness: { value: resolved.edgeSoftnessPct / 100 },
      uLegacyModel: { value: resolved.legacyModel ? 1.0 : 0.0 },
      uHalfBounds: { value: halfBounds.clone() },
      uScatterColor: { value: scatterColor.clone() },
    },
    vertexShader: VOLUMETRIC_SLICE_VERT,
    fragmentShader: VOLUMETRIC_SLICE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });

  // Layered orthogonal volumetric slices across X, Y, Z axes
  const sliceGroup = new THREE.Group();
  const sliceCount = isSoftwareGl ? 6 : 9;
  const planeGeo = new THREE.PlaneGeometry(1, 1);

  for (let i = 0; i < sliceCount; i++) {
    const t = (i / (sliceCount - 1 || 1)) * 2 - 1; // -1..1
    const mz = new THREE.Mesh(planeGeo, sliceMaterial);
    mz.scale.set(resolved.width, resolved.height, 1);
    mz.position.set(0, 0, t * halfBounds.z * 0.85);
    mz.renderOrder = 3;
    mz.userData.isVolumetricBeam = true;
    sliceGroup.add(mz);

    const mx = new THREE.Mesh(planeGeo, sliceMaterial);
    mx.rotation.y = Math.PI / 2;
    mx.scale.set(resolved.depth, resolved.height, 1);
    mx.position.set(t * halfBounds.x * 0.85, 0, 0);
    mx.renderOrder = 3;
    mx.userData.isVolumetricBeam = true;
    sliceGroup.add(mx);
  }
  root.add(sliceGroup);

  // Volumetric GPU haze particles
  const particleCount = isSoftwareGl ? 220 : 420;
  const positions = new Float32Array(particleCount * 3);
  const seeds = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    // Deterministic quasi-random distribution inside [-1, 1]^3 normalized box
    const h1 = Math.sin(i * 12.9898 + 1.2) * 43758.5453;
    const h2 = Math.sin(i * 78.233 + 3.4) * 29183.1234;
    const h3 = Math.sin(i * 45.164 + 7.8) * 19472.7312;
    positions[i * 3] = (h1 - Math.floor(h1)) * 2 - 1;
    positions[i * 3 + 1] = (h2 - Math.floor(h2)) * 2 - 1;
    positions[i * 3 + 2] = (h3 - Math.floor(h3)) * 2 - 1;
    const hs = Math.sin(i * 91.321) * 51234.11;
    seeds[i] = hs - Math.floor(hs);
  }

  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: resolved.speedPct / 100 },
      uDensity: { value: densityNorm },
      uVariation: { value: resolved.variationPct / 100 },
      uEdgeSoftness: { value: resolved.edgeSoftnessPct / 100 },
      uLegacyModel: { value: resolved.legacyModel ? 1.0 : 0.0 },
      uHalfBounds: { value: halfBounds.clone() },
      uScatterColor: { value: scatterColor.clone() },
      uPointScale: { value: isSoftwareGl ? 620.0 : 780.0 },
    },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(pGeo, particleMaterial);
  particles.renderOrder = 4;
  particles.frustumCulled = false;
  particles.userData.isVolumetricBeam = true;
  root.add(particles);

  return {
    objectId: obj.id,
    root,
    sliceMaterial,
    particleMaterial,
    sliceGroup,
    particles,
  };
}

export function updateLiveSmokeRig(
  handle: LiveSmokeHandle,
  obj: SceneObject,
  dmxUniverses: DmxUniversesMap,
  scatterColor: THREE.Color,
  driftPhaseSec: number,
): void {
  const resolved = resolveSmokeParameters(obj, dmxUniverses);
  const densityNorm = THREE.MathUtils.clamp(resolved.densityPct / 8.0, 0, 2.2);

  handle.root.position.set(obj.position[0], obj.position[1], obj.position[2]);
  handle.root.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);

  const hb = new THREE.Vector3(resolved.width * 0.5, resolved.height * 0.5, resolved.depth * 0.5);
  const halfSliceCount = handle.sliceGroup.children.length / 2;
  for (let i = 0; i < halfSliceCount; i++) {
    const t = (i / (halfSliceCount - 1 || 1)) * 2 - 1;
    const mz = handle.sliceGroup.children[i * 2] as THREE.Mesh;
    const mx = handle.sliceGroup.children[i * 2 + 1] as THREE.Mesh;
    mz.scale.set(resolved.width, resolved.height, 1);
    mz.position.set(0, 0, t * hb.z * 0.85);
    mx.scale.set(resolved.depth, resolved.height, 1);
    mx.position.set(t * hb.x * 0.85, 0, 0);
  }

  handle.sliceMaterial.uniforms.uTime.value = driftPhaseSec;
  handle.sliceMaterial.uniforms.uDensity.value = densityNorm;
  handle.sliceMaterial.uniforms.uVariation.value = resolved.variationPct / 100;
  handle.sliceMaterial.uniforms.uEdgeSoftness.value = resolved.edgeSoftnessPct / 100;
  handle.sliceMaterial.uniforms.uLegacyModel.value = resolved.legacyModel ? 1.0 : 0.0;
  (handle.sliceMaterial.uniforms.uHalfBounds.value as THREE.Vector3).copy(hb);
  (handle.sliceMaterial.uniforms.uScatterColor.value as THREE.Color).copy(scatterColor);

  handle.particleMaterial.uniforms.uTime.value = driftPhaseSec;
  handle.particleMaterial.uniforms.uSpeed.value = resolved.speedPct / 100;
  handle.particleMaterial.uniforms.uDensity.value = densityNorm;
  handle.particleMaterial.uniforms.uVariation.value = resolved.variationPct / 100;
  handle.particleMaterial.uniforms.uEdgeSoftness.value = resolved.edgeSoftnessPct / 100;
  handle.particleMaterial.uniforms.uLegacyModel.value = resolved.legacyModel ? 1.0 : 0.0;
  (handle.particleMaterial.uniforms.uHalfBounds.value as THREE.Vector3).copy(hb);
  (handle.particleMaterial.uniforms.uScatterColor.value as THREE.Color).copy(scatterColor);
}
