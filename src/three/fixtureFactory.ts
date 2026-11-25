import * as THREE from 'three';
import { CustomFaceStyle, LayerLineStyle, RenderMode, SceneObject } from '../types/visualizer';
import { buildEffectJet } from './effectJets';
import { buildCaptureMeshMaterial } from './materialsLibrary';
import { buildSmokeCadGroup } from './smokeSimulation';

const SELECTED_COLOR = 0xff3b30;
const WIREFRAME_WHITE_COLOR = 0xffffff;
const PLOT_PAPER_WHITE = 0xf4f5f2;

export interface ViewportRenderStyleOptions {
  renderMode: RenderMode;
  customFaceStyle?: CustomFaceStyle;
  customWireframeOverlay?: boolean;
  layerColor?: string;
  lineWeightPt?: number;
  lineStyle?: LayerLineStyle;
}

export function resolveEffectiveStyle(opts: ViewportRenderStyleOptions): {
  baseMode: 'wireframe' | 'plot' | 'live';
  showEdges: boolean;
  strokeColorHex: number;
  plotFillHex: number;
  lineWeightPt: number;
  lineStyle: LayerLineStyle;
} {
  const baseMode: 'wireframe' | 'plot' | 'live' =
    opts.renderMode === 'custom'
      ? opts.customFaceStyle === 'Plot'
        ? 'plot'
        : opts.customFaceStyle === 'Wireframe'
          ? 'wireframe'
          : 'live'
      : opts.renderMode;

  const layerCol = new THREE.Color(opts.layerColor || '#2C3E50');
  const paperTint = layerCol.clone().lerp(new THREE.Color(0xffffff), 0.9);
  const showEdges =
    baseMode !== 'live' ||
    (opts.renderMode === 'custom' && (opts.customWireframeOverlay ?? true));

  const strokeColorHex =
    baseMode === 'plot' ? layerCol.getHex() : WIREFRAME_WHITE_COLOR;

  return {
    baseMode,
    showEdges,
    strokeColorHex,
    plotFillHex: paperTint.getHex(),
    lineWeightPt: opts.lineWeightPt ?? 0.75,
    lineStyle: opts.lineStyle ?? 'Solid',
  };
}

export function createStyledLineSegments(
  geometry: THREE.BufferGeometry,
  color: number,
  lineStyle: LayerLineStyle = 'Solid',
  lineWeightPt = 0.75,
  opacity = 1.0,
): THREE.Object3D {
  const makeMat = () => {
    if (lineStyle === 'Dashed' || lineStyle === 'Dotted') {
      return new THREE.LineDashedMaterial({
        color,
        dashSize: lineStyle === 'Dashed' ? 0.16 : 0.04,
        gapSize: lineStyle === 'Dashed' ? 0.09 : 0.07,
        transparent: opacity < 0.99,
        opacity,
        toneMapped: false,
      });
    }
    return new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 0.99,
      opacity,
      toneMapped: false,
    });
  };

  const primary = new THREE.LineSegments(geometry, makeMat());
  if (lineStyle === 'Dashed' || lineStyle === 'Dotted') {
    primary.computeLineDistances();
  }
  primary.userData.isEdgeLine = true;

  // Sub-pixel reinforcement pass for thicker drafting line weights (e.g. >= 1.25pt)
  if (lineWeightPt >= 1.25) {
    const grp = new THREE.Group();
    grp.userData.isEdgeLine = true;
    grp.add(primary);
    const thick = new THREE.LineSegments(geometry, makeMat());
    if (lineStyle === 'Dashed' || lineStyle === 'Dotted') {
      thick.computeLineDistances();
    }
    thick.position.set(0.008, 0.004, 0.008);
    thick.userData.isEdgeLine = true;
    grp.add(thick);
    return grp;
  }

  return primary;
}

// Shared procedural soft gradient texture for volumetric light beams & aperture glow
let sharedBeamTexture: THREE.CanvasTexture | null = null;
export function getSharedBeamTexture(): THREE.CanvasTexture {
  if (sharedBeamTexture) return sharedBeamTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.72)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.36)');
  grad.addColorStop(0.65, 'rgba(255,255,255,0.11)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedBeamTexture = tex;
  return tex;
}

let sharedLensGlowTexture: THREE.CanvasTexture | null = null;
function getSharedLensGlowTexture(): THREE.CanvasTexture {
  if (sharedLensGlowTexture) return sharedLensGlowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const rad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  rad.addColorStop(0.0, 'rgba(255,255,255,0.95)');
  rad.addColorStop(0.28, 'rgba(255,255,255,0.48)');
  rad.addColorStop(0.62, 'rgba(255,255,255,0.12)');
  rad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedLensGlowTexture = tex;
  return tex;
}

const VOLUMETRIC_SHAFT_VERT = /* glsl */ `
  uniform float uBeamLength;
  varying float vAlong;
  varying vec3 vNormalView;
  varying vec3 vViewPos;

  void main() {
    vAlong = clamp(-position.y / max(uBeamLength, 0.1), 0.0, 1.0);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mvPos.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const VOLUMETRIC_SHAFT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uSmokeBoost;

  varying float vAlong;
  varying vec3 vNormalView;
  varying vec3 vViewPos;

  void main() {
    vec3 n = normalize(vNormalView);
    vec3 v = normalize(vViewPos);
    float facing = abs(dot(n, v));

    // Silky edge falloff eliminates hard cone polygon edges
    float outerHalo = pow(facing, 1.55);
    float hotCore = pow(facing, 4.2) * 0.65;

    // Gentle entrance right at the lens + realistic inverse throw attenuation
    float gateFade = smoothstep(0.0, 0.035, vAlong);
    float throwDecay = pow(1.0 - vAlong, 1.38);

    float density = (0.11 + uIntensity * 0.24) * uSmokeBoost;
    float alpha = clamp((outerHalo + hotCore) * gateFade * throwDecay * density, 0.0, 0.72);
    if (alpha < 0.003) discard;

    // Hot white-tinted beam core near aperture transitioning to saturated beam color
    vec3 col = mix(uColor, vec3(1.0), hotCore * (0.25 + 0.35 * (1.0 - vAlong)));
    gl_FragColor = vec4(col * (0.95 + 0.45 * (1.0 - vAlong)), alpha);
  }
`;

// Procedural subtle phenolic deck grid texture
let sharedStageTexture: THREE.CanvasTexture | null = null;
export function getSharedStageTexture(): THREE.CanvasTexture {
  if (sharedStageTexture) return sharedStageTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1b1d20';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#272a2e';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 254);
  ctx.strokeStyle = '#212428';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedStageTexture = tex;
  return tex;
}

function createEdgeLines(
  geometry: THREE.BufferGeometry,
  color: number,
  thresholdAngle = 22,
  lineStyle: LayerLineStyle = 'Solid',
  lineWeightPt = 0.75,
): THREE.Object3D {
  const edges = new THREE.EdgesGeometry(geometry, thresholdAngle);
  return createStyledLineSegments(edges, color, lineStyle, lineWeightPt);
}

function addPartWithEdges(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  solidMat: THREE.Material,
  styleOpts: ViewportRenderStyleOptions,
  isSelected: boolean,
  castsShadows: boolean,
  thresholdAngle = 22,
): THREE.Mesh {
  const resolved = resolveEffectiveStyle(styleOpts);
  const mesh = new THREE.Mesh(geometry, solidMat);
  mesh.castShadow = resolved.baseMode === 'live' && castsShadows;
  mesh.receiveShadow = resolved.baseMode === 'live';
  mesh.userData.isChassisMesh = true;

  if (resolved.baseMode === 'wireframe') {
    mesh.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
  } else if (resolved.baseMode === 'plot') {
    mesh.material = new THREE.MeshBasicMaterial({
      color: isSelected ? 0xfde2e0 : resolved.plotFillHex,
      toneMapped: false,
    });
  }

  parent.add(mesh);

  if (resolved.showEdges || isSelected) {
    const strokeHex = isSelected ? SELECTED_COLOR : resolved.strokeColorHex;
    const lines = createEdgeLines(
      geometry,
      strokeHex,
      thresholdAngle,
      resolved.baseMode === 'plot' ? resolved.lineStyle : 'Solid',
      resolved.baseMode === 'plot' ? resolved.lineWeightPt : 0.75,
    );
    mesh.add(lines);
  }

  return mesh;
}

export function attachSelectionBoundingBox(root: THREE.Group): void {
  root.updateMatrixWorld(true);

  // Measure in world space, then convert the AABB corners back into the root's
  // local space. A THREE.Box3Helper would keep recomputing its transform from
  // the world box every frame, so parenting it to the root double-applied the
  // object transform and made the orange cage drift while orbiting/moving.
  const worldBox = new THREE.Box3();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && !child.userData.isSelectionHelper && !child.userData.isVolumetricBeam) {
      worldBox.expandByObject(mesh);
    }
  });
  if (worldBox.isEmpty()) return;
  worldBox.expandByScalar(0.05);

  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const localBox = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (const x of [worldBox.min.x, worldBox.max.x]) {
    for (const y of [worldBox.min.y, worldBox.max.y]) {
      for (const z of [worldBox.min.z, worldBox.max.z]) {
        corner.set(x, y, z).applyMatrix4(inv);
        localBox.expandByPoint(corner);
      }
    }
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  localBox.getSize(size);
  localBox.getCenter(center);

  const boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
  const edgesGeo = new THREE.EdgesGeometry(boxGeo, 1);
  boxGeo.dispose();

  const lineMat = new THREE.LineBasicMaterial({
    color: 0xff9500,
    toneMapped: false,
    transparent: true,
    opacity: 0.92,
  });
  const helper = new THREE.LineSegments(edgesGeo, lineMat);
  helper.position.copy(center);
  helper.userData.isSelectionHelper = true;
  root.add(helper);
}

export function buildSceneObjectGroup(
  obj: SceneObject,
  styleOpts: ViewportRenderStyleOptions,
  isSelected: boolean,
  isSoftwareGl: boolean,
  smokeBeamBoost = 1.0,
): THREE.Group {
  const root = new THREE.Group();
  root.name = obj.id;
  root.userData.objectId = obj.id;
  root.position.set(obj.position[0], obj.position[1], obj.position[2]);
  root.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);
  if (obj.scale) {
    root.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
  }

  const resolved = resolveEffectiveStyle(styleOpts);
  if (obj.kind === 'moving-head') {
    buildMovingHead(root, obj, styleOpts, isSelected, isSoftwareGl, smokeBeamBoost);
  } else if (obj.kind === 'led-par') {
    buildLedPar(root, obj, styleOpts, isSelected, isSoftwareGl, smokeBeamBoost);
  } else if (obj.kind === 'truss') {
    buildTruss(root, obj, styleOpts, isSelected);
  } else if (obj.kind === 'stage-deck') {
    buildStageDeck(root, obj, styleOpts, isSelected);
  } else if (obj.kind === 'smoke-volume') {
    buildSmokeCadGroup(root, obj, resolved.baseMode, isSelected, resolved.strokeColorHex);
  } else if (obj.kind === 'co2-jet' || obj.kind === 'flame-jet') {
    buildEffectJet(obj, resolved.baseMode, resolved.strokeColorHex, isSelected);
  }

  if (isSelected && obj.kind !== 'smoke-volume') {
    attachSelectionBoundingBox(root);
  }

  // Propagate objectId to all descendants for reliable raycasting
  root.traverse((child) => {
    child.userData.objectId = obj.id;
  });

  return root;
}

function buildMovingHead(
  root: THREE.Group,
  obj: SceneObject,
  styleOpts: ViewportRenderStyleOptions,
  isSelected: boolean,
  isSoftwareGl: boolean,
  smokeBeamBoost = 1.0,
) {
  const resolved = resolveEffectiveStyle(styleOpts);
  const castsShadows = obj.castsShadows ?? true;
  const bodyMat = obj.materialPreset
    ? buildCaptureMeshMaterial(
        obj.materialPreset,
        { color: 0x1e2024, roughness: 0.42, metalness: 0.35 },
        1,
        1,
        isSelected,
      )
    : new THREE.MeshStandardMaterial({
        color: isSelected ? 0x6a1d19 : 0x1e2024,
        roughness: 0.42,
        metalness: 0.35,
      });
  const metalAccentMat = new THREE.MeshStandardMaterial({
    color: isSelected ? 0x992a24 : 0x4b515a,
    roughness: 0.25,
    metalness: 0.85,
  });

  // 1. Base Chassis (hanging at top y=0 so clamp meets truss, body hangs down)
  const clampGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.09, 10);
  const clamp = addPartWithEdges(root, clampGeo, metalAccentMat, styleOpts, isSelected, castsShadows);
  clamp.position.set(0, 0.04, 0);

  const baseGeo = new THREE.BoxGeometry(0.32, 0.11, 0.24);
  const base = addPartWithEdges(root, baseGeo, bodyMat, styleOpts, isSelected, castsShadows);
  base.position.set(0, -0.055, 0);

  // Side carrying handles
  const handleGeo = new THREE.BoxGeometry(0.03, 0.05, 0.14);
  const leftHandle = addPartWithEdges(root, handleGeo, metalAccentMat, styleOpts, isSelected, castsShadows);
  leftHandle.position.set(-0.175, -0.055, 0);
  const rightHandle = addPartWithEdges(root, handleGeo, metalAccentMat, styleOpts, isSelected, castsShadows);
  rightHandle.position.set(0.175, -0.055, 0);

  // 2. Pan Yoke Assembly
  const yokeGroup = new THREE.Group();
  const panSign = obj.invertPan ? -1 : 1;
  const panRad = THREE.MathUtils.degToRad((obj.pan ?? 0) * panSign);
  yokeGroup.rotation.y = panRad;
  yokeGroup.position.set(0, -0.11, 0);
  root.add(yokeGroup);

  const yokeBridgeGeo = new THREE.BoxGeometry(0.28, 0.04, 0.11);
  const yokeBridge = addPartWithEdges(yokeGroup, yokeBridgeGeo, bodyMat, styleOpts, isSelected, castsShadows);
  yokeBridge.position.set(0, -0.02, 0);

  const armGeo = new THREE.BoxGeometry(0.042, 0.25, 0.085);
  const armL = addPartWithEdges(yokeGroup, armGeo, bodyMat, styleOpts, isSelected, castsShadows);
  armL.position.set(-0.12, -0.155, 0);
  const armR = addPartWithEdges(yokeGroup, armGeo, bodyMat, styleOpts, isSelected, castsShadows);
  armR.position.set(0.12, -0.155, 0);

  // 3. Tilt Optical Head Assembly
  const headGroup = new THREE.Group();
  const tiltSign = obj.invertTilt ? -1 : 1;
  const tiltRad = THREE.MathUtils.degToRad((obj.tilt ?? 25) * tiltSign);
  headGroup.position.set(0, -0.24, 0);
  headGroup.rotation.x = tiltRad;
  yokeGroup.add(headGroup);

  const headBarrelGeo = new THREE.CylinderGeometry(0.082, 0.095, 0.28, 12);
  addPartWithEdges(headGroup, headBarrelGeo, bodyMat, styleOpts, isSelected, castsShadows, 28);

  // Rear heatsink cap
  const capGeo = new THREE.CylinderGeometry(0.072, 0.082, 0.05, 12);
  const cap = addPartWithEdges(headGroup, capGeo, metalAccentMat, styleOpts, isSelected, castsShadows, 28);
  cap.position.set(0, 0.165, 0);

  // Front bezel ring
  const bezelGeo = new THREE.CylinderGeometry(0.098, 0.095, 0.035, 14);
  const bezel = addPartWithEdges(headGroup, bezelGeo, metalAccentMat, styleOpts, isSelected, castsShadows, 28);
  bezel.position.set(0, -0.15, 0);

  // Optical front lens
  const fixtureColor = new THREE.Color(obj.color || '#ffffff');
  const intensity = obj.shutter === false ? 0 : (obj.intensity ?? 0.8);
  const lensGeo = new THREE.CircleGeometry(0.078, 14);
  const lensMat =
    resolved.baseMode === 'live'
      ? new THREE.MeshStandardMaterial({
          color: fixtureColor,
          emissive: fixtureColor,
          emissiveIntensity: 0.75 + intensity * 3.1,
          roughness: 0.08,
          metalness: 0.1,
        })
      : new THREE.MeshBasicMaterial({
          color: isSelected
            ? SELECTED_COLOR
            : resolved.baseMode === 'plot'
              ? resolved.strokeColorHex
              : WIREFRAME_WHITE_COLOR,
          transparent: resolved.baseMode === 'wireframe',
          opacity: resolved.baseMode === 'wireframe' ? 0.28 : 0.78,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, -0.169, 0);
  headGroup.add(lens);

  addFixtureBeamAndLight(headGroup, obj, styleOpts, isSelected, isSoftwareGl, -0.17, smokeBeamBoost);
}

function buildLedPar(
  root: THREE.Group,
  obj: SceneObject,
  styleOpts: ViewportRenderStyleOptions,
  isSelected: boolean,
  isSoftwareGl: boolean,
  smokeBeamBoost = 1.0,
) {
  const resolved = resolveEffectiveStyle(styleOpts);
  const castsShadows = obj.castsShadows ?? true;
  const bodyMat = obj.materialPreset
    ? buildCaptureMeshMaterial(
        obj.materialPreset,
        { color: 0x1a1c20, roughness: 0.38, metalness: 0.65 },
        1,
        1,
        isSelected,
      )
    : new THREE.MeshStandardMaterial({
        color: isSelected ? 0x6a1d19 : 0x1a1c20,
        roughness: 0.38,
        metalness: 0.65,
      });
  const bracketMat = new THREE.MeshStandardMaterial({
    color: isSelected ? 0x992a24 : 0x525860,
    roughness: 0.28,
    metalness: 0.85,
  });

  // Yoke / bracket
  const panSign = obj.invertPan ? -1 : 1;
  const panRad = THREE.MathUtils.degToRad((obj.pan ?? 0) * panSign);
  const yokeGroup = new THREE.Group();
  yokeGroup.rotation.y = panRad;
  root.add(yokeGroup);

  const yokeTopGeo = new THREE.BoxGeometry(0.24, 0.025, 0.04);
  const yokeTop = addPartWithEdges(yokeGroup, yokeTopGeo, bracketMat, styleOpts, isSelected, castsShadows);
  yokeTop.position.set(0, 0.01, 0);

  const yokeSideGeo = new THREE.BoxGeometry(0.022, 0.18, 0.035);
  const sideL = addPartWithEdges(yokeGroup, yokeSideGeo, bracketMat, styleOpts, isSelected, castsShadows);
  sideL.position.set(-0.11, -0.08, 0);
  const sideR = addPartWithEdges(yokeGroup, yokeSideGeo, bracketMat, styleOpts, isSelected, castsShadows);
  sideR.position.set(0.11, -0.08, 0);

  // Canister tilted
  const headGroup = new THREE.Group();
  const tiltSign = obj.invertTilt ? -1 : 1;
  headGroup.position.set(0, -0.14, 0);
  headGroup.rotation.x = THREE.MathUtils.degToRad((obj.tilt ?? -30) * tiltSign);
  yokeGroup.add(headGroup);

  const canGeo = new THREE.CylinderGeometry(0.095, 0.082, 0.22, 10);
  addPartWithEdges(headGroup, canGeo, bodyMat, styleOpts, isSelected, castsShadows, 28);

  const rimGeo = new THREE.CylinderGeometry(0.102, 0.098, 0.035, 10);
  const rim = addPartWithEdges(headGroup, rimGeo, bracketMat, styleOpts, isSelected, castsShadows, 28);
  rim.position.set(0, -0.11, 0);

  const fixtureColor = new THREE.Color(obj.color || '#ffd166');
  const intensity = obj.shutter === false ? 0 : (obj.intensity ?? 0.7);
  const lensGeo = new THREE.CircleGeometry(0.085, 10);
  const lensMat =
    resolved.baseMode === 'live'
      ? new THREE.MeshStandardMaterial({
          color: fixtureColor,
          emissive: fixtureColor,
          emissiveIntensity: 0.7 + intensity * 2.8,
          roughness: 0.12,
        })
      : new THREE.MeshBasicMaterial({
          color: isSelected
            ? SELECTED_COLOR
            : resolved.baseMode === 'plot'
              ? resolved.strokeColorHex
              : WIREFRAME_WHITE_COLOR,
          transparent: resolved.baseMode === 'wireframe',
          opacity: resolved.baseMode === 'wireframe' ? 0.28 : 0.78,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, -0.128, 0);
  headGroup.add(lens);

  addFixtureBeamAndLight(headGroup, obj, styleOpts, isSelected, isSoftwareGl, -0.13, smokeBeamBoost);
}

function addFixtureBeamAndLight(
  headGroup: THREE.Group,
  obj: SceneObject,
  styleOpts: ViewportRenderStyleOptions,
  isSelected: boolean,
  isSoftwareGl: boolean,
  lensOffsetY: number,
  smokeBeamBoost = 1.0,
) {
  const resolved = resolveEffectiveStyle(styleOpts);
  const throwsLight = obj.throwsLight ?? true;
  const intensity = throwsLight && obj.shutter !== false ? (obj.intensity ?? 0.75) : 0;
  const beamAngleDeg = obj.beamAngle ?? 20;
  const beamHalfRad = THREE.MathUtils.degToRad(beamAngleDeg * 0.5);
  const fixtureColor = new THREE.Color(obj.color || '#ffffff');

  if (resolved.baseMode === 'live' && intensity > 0.01) {
    // Volumetric Fresnel light shaft pointing along -Y of headGroup
    const beamLength = 7.8;
    const bottomRadius = Math.max(0.18, Math.tan(beamHalfRad) * beamLength);
    const coneGeo = new THREE.ConeGeometry(bottomRadius, beamLength, 28, 1, true);
    coneGeo.translate(0, -beamLength / 2, 0);

    const coneMat = new THREE.ShaderMaterial({
      vertexShader: VOLUMETRIC_SHAFT_VERT,
      fragmentShader: VOLUMETRIC_SHAFT_FRAG,
      uniforms: {
        uBeamLength: { value: beamLength },
        uColor: { value: fixtureColor.clone() },
        uIntensity: { value: intensity },
        uSmokeBoost: { value: smokeBeamBoost },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(0, lensOffsetY, 0);
    cone.renderOrder = 5;
    cone.userData.isVolumetricBeam = true;
    headGroup.add(cone);

    // Soft additive optical lens flare halo right in front of emitter aperture
    const haloGeo = new THREE.PlaneGeometry(0.46, 0.46);
    const haloMat = new THREE.MeshBasicMaterial({
      color: fixtureColor,
      map: getSharedLensGlowTexture(),
      transparent: true,
      opacity: Math.min(0.82, 0.28 + intensity * 0.52),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, lensOffsetY - 0.02, 0);
    halo.renderOrder = 6;
    halo.userData.isVolumetricBeam = true;
    headGroup.add(halo);

    // Real SpotLight illuminating the stage deck & concert floor
    const spot = new THREE.SpotLight(
      fixtureColor,
      intensity * 36,
      24,
      Math.min(Math.PI * 0.46, beamHalfRad * 1.12),
      0.68,
      1.45,
    );
    spot.position.set(0, lensOffsetY, 0);
    spot.target.position.set(0, lensOffsetY - 6, 0);
    if (!isSoftwareGl && obj.kind === 'moving-head') {
      spot.castShadow = false; // Keep <= 3 shadow casters globally via key light
    }
    headGroup.add(spot);
    headGroup.add(spot.target);
  } else if (resolved.baseMode === 'plot') {
    // Technical drafting beam projection inheriting layer color, style & line weight
    const beamLen = 2.4;
    const r = Math.tan(beamHalfRad) * beamLen;
    const pts: number[] = [];
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const x0 = Math.cos(a0) * r;
      const z0 = Math.sin(a0) * r;
      const x1 = Math.cos(a1) * r;
      const z1 = Math.sin(a1) * r;
      if (i % 2 === 0) {
        pts.push(0, lensOffsetY, 0, x0, lensOffsetY - beamLen, z0);
      }
      pts.push(x0, lensOffsetY - beamLen, z0, x1, lensOffsetY - beamLen, z1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const beamLines = createStyledLineSegments(
      geo,
      isSelected ? SELECTED_COLOR : resolved.strokeColorHex,
      resolved.lineStyle,
      resolved.lineWeightPt,
      0.85,
    );
    headGroup.add(beamLines);
  } else if (isSelected) {
    // Subtle aiming vector when selected in wireframe mode
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, lensOffsetY, 0, 0, lensOffsetY - 1.5, 0], 3),
    );
    const mat = new THREE.LineBasicMaterial({
      color: SELECTED_COLOR,
      toneMapped: false,
    });
    headGroup.add(new THREE.LineSegments(geo, mat));
  }
}

function buildTruss(
  root: THREE.Group,
  obj: SceneObject,
  styleOpts: ViewportRenderStyleOptions,
  isSelected: boolean,
) {
  const resolved = resolveEffectiveStyle(styleOpts);
  const length = obj.length ?? 4.0;
  const halfL = length / 2;
  const halfW = (obj.sectionWidth ?? 0.29) / 2;
  const halfH = (obj.sectionHeight ?? 0.29) / 2;
  const edgeColor = isSelected ? SELECTED_COLOR : resolved.strokeColorHex;

  const metalMat = buildCaptureMeshMaterial(
    obj.materialPreset,
    {
      color: 0xb8c0c8,
      roughness: 0.28,
      metalness: 0.88,
    },
    length,
    0.5,
    isSelected,
  );

  // Hit-proxy bounding box for effortless raycasting in Wireframe / Plot modes
  const hitGeo = new THREE.BoxGeometry(length, halfH * 2 + 0.05, halfW * 2 + 0.05);
  const hitMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: resolved.baseMode === 'plot' ? 0.14 : 0,
    color: isSelected ? SELECTED_COLOR : resolved.plotFillHex,
    depthWrite: false,
  });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);
  root.add(hitMesh);

  // Chords based on Truss Type
  const isTri = obj.trussType === 'Triangular Section' || obj.subType === 'Triangular';
  const isLadder = obj.trussType === 'Ladder Section' || obj.subType === 'Ladder';
  const chordOffsets: [number, number][] = isLadder
    ? [
        [-halfH, 0],
        [halfH, 0],
      ]
    : isTri
      ? [
          [-halfH, -halfW],
          [-halfH, halfW],
          [halfH, 0],
        ]
      : [
          [-halfH, -halfW],
          [halfH, -halfW],
          [-halfH, halfW],
          [halfH, halfW],
        ];

  if (resolved.baseMode === 'live') {
    const chordR = Math.max(0.014, ((obj.pipeDiameterMm ?? 48) / 1000) * 0.5);
    const chordGeo = new THREE.CylinderGeometry(chordR, chordR, length, 8);
    chordGeo.rotateZ(Math.PI / 2);
    for (const [cy, cz] of chordOffsets) {
      const chord = new THREE.Mesh(chordGeo, metalMat);
      chord.position.set(0, cy, cz);
      chord.castShadow = obj.castsShadows ?? true;
      root.add(chord);
    }

    // 3D Diagonal Web Lacing Cylinders via InstancedMesh for realistic aluminum truss silhouette
    const liveBays = Math.max(4, Math.round(length / 0.5));
    const liveBayLen = length / liveBays;
    const braceCount = liveBays * chordOffsets.length;
    const unitBraceGeo = new THREE.CylinderGeometry(chordR * 0.42, chordR * 0.42, 1.0, 6);
    const braceInst = new THREE.InstancedMesh(unitBraceGeo, metalMat, braceCount);
    braceInst.castShadow = false;
    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const upAxis = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const mat4 = new THREE.Matrix4();
    let idx = 0;

    for (let i = 0; i < liveBays; i++) {
      const x0 = -halfL + i * liveBayLen;
      const x1 = x0 + liveBayLen;
      const flip = i % 2 === 0;
      for (let j = 0; j < chordOffsets.length; j++) {
        const c0 = chordOffsets[j];
        const c1 = chordOffsets[(j + 1) % chordOffsets.length];
        if (flip) {
          pA.set(x0, c0[0], c0[1]);
          pB.set(x1, c1[0], c1[1]);
        } else {
          pA.set(x0, c1[0], c1[1]);
          pB.set(x1, c0[0], c0[1]);
        }
        dir.subVectors(pB, pA);
        const segLen = dir.length();
        mid.addVectors(pA, pB).multiplyScalar(0.5);
        dir.normalize();
        q.setFromUnitVectors(upAxis, dir);
        sc.set(1, segLen, 1);
        mat4.compose(mid, q, sc);
        braceInst.setMatrixAt(idx++, mat4);
      }
    }
    braceInst.instanceMatrix.needsUpdate = true;
    root.add(braceInst);

    // End plates
    const endGeo = new THREE.BoxGeometry(0.03, halfH * 2 + 0.03, halfW * 2 + 0.03);
    const endL = new THREE.Mesh(endGeo, metalMat);
    endL.position.set(-halfL, 0, 0);
    const endR = new THREE.Mesh(endGeo, metalMat);
    endR.position.set(halfL, 0, 0);
    root.add(endL, endR);
  }

  // Vector truss chords + diagonal zig-zag lacing (rendered in Wireframe, Plot, Custom Overlay, or when selected)
  if (resolved.showEdges || isSelected) {
    const pts: number[] = [];
    for (const [cy, cz] of chordOffsets) {
      pts.push(-halfL, cy, cz, halfL, cy, cz);
    }
    const addEndFrame = (x: number) => {
      for (let i = 0; i < chordOffsets.length; i++) {
        const a = chordOffsets[i];
        const b = chordOffsets[(i + 1) % chordOffsets.length];
        pts.push(x, a[0], a[1], x, b[0], b[1]);
      }
    };
    addEndFrame(-halfL);
    addEndFrame(halfL);

    const bays = Math.max(4, Math.round(length / 0.5));
    const bayLen = length / bays;
    for (let i = 0; i < bays; i++) {
      const x0 = -halfL + i * bayLen;
      const x1 = x0 + bayLen;
      const flip = i % 2 === 0;
      for (let j = 0; j < chordOffsets.length; j++) {
        const a = chordOffsets[j];
        const b = chordOffsets[(j + 1) % chordOffsets.length];
        if (flip) {
          pts.push(x0, a[0], a[1], x1, b[0], b[1]);
        } else {
          pts.push(x0, b[0], b[1], x1, a[0], a[1]);
        }
      }
      if (i > 0) {
        addEndFrame(x0);
      }
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const trussLines = createStyledLineSegments(
      lineGeo,
      edgeColor,
      resolved.baseMode === 'plot' ? resolved.lineStyle : 'Solid',
      resolved.baseMode === 'plot' ? resolved.lineWeightPt : 0.75,
    );
    root.add(trussLines);
  }
}

function buildStageDeck(
  root: THREE.Group,
  obj: SceneObject,
  styleOpts: ViewportRenderStyleOptions,
  isSelected: boolean,
) {
  const resolved = resolveEffectiveStyle(styleOpts);
  const castsShadows = obj.castsShadows ?? true;
  const length = obj.length ?? 2.0;
  const width = obj.width ?? 2.0;
  const isFloor = obj.subType === 'Floor' || obj.materialPreset === 'floor-venue';

  if (isFloor) {
    const floorThick = 0.04;
    const isGlossy = obj.materialPreset === 'glossy-black' || obj.materialPreset === 'gloss-black';
    const floorGeo = new THREE.BoxGeometry(length, floorThick, width);
    const floorMat = buildCaptureMeshMaterial(
      obj.materialPreset,
      {
        color: isGlossy ? 0x161920 : 0x242830,
        map: getSharedStageTexture(),
        roughness: isGlossy ? 0.16 : 0.42,
        metalness: isGlossy ? 0.45 : 0.25,
      },
      length,
      width,
      isSelected,
    );
    const floorMesh = addPartWithEdges(
      root,
      floorGeo,
      floorMat,
      styleOpts,
      isSelected,
      false,
      25,
    );
    floorMesh.position.set(0, -floorThick / 2, 0);
    floorMesh.receiveShadow = resolved.baseMode === 'live';
    return;
  }

  const deckThick = 0.09;
  const deckElevation = 0.36;

  const deckMat = buildCaptureMeshMaterial(
    obj.materialPreset,
    {
      color: 0xd2d6dc,
      map: getSharedStageTexture(),
      roughness: 0.54,
      metalness: 0.18,
    },
    length,
    width,
    isSelected,
  );
  const legMat = new THREE.MeshStandardMaterial({
    color: isSelected ? 0x99302a : 0x767c84,
    roughness: 0.3,
    metalness: 0.85,
  });

  // Main deck platform (pivot bottom-center at y=0, deck sits at y=deckElevation)
  const deckGeo = new THREE.BoxGeometry(length, deckThick, width);
  const deck = addPartWithEdges(root, deckGeo, deckMat, styleOpts, isSelected, castsShadows);
  deck.position.set(0, deckElevation - deckThick / 2, 0);
  deck.receiveShadow = resolved.baseMode === 'live';

  // Brushed aluminum perimeter trim around stage deck in shaded Live mode
  if (resolved.baseMode === 'live') {
    const trimMat = new THREE.MeshStandardMaterial({
      color: isSelected ? 0x99302a : 0x4b515a,
      roughness: 0.32,
      metalness: 0.84,
    });
    const trimGeoF = new THREE.BoxGeometry(length + 0.03, 0.03, 0.025);
    const trimF = new THREE.Mesh(trimGeoF, trimMat);
    trimF.position.set(0, deckElevation - 0.015, width / 2 + 0.005);
    const trimB = new THREE.Mesh(trimGeoF, trimMat);
    trimB.position.set(0, deckElevation - 0.015, -(width / 2 + 0.005));
    const trimGeoS = new THREE.BoxGeometry(0.025, 0.03, width + 0.03);
    const trimL = new THREE.Mesh(trimGeoS, trimMat);
    trimL.position.set(-(length / 2 + 0.005), deckElevation - 0.015, 0);
    const trimR = new THREE.Mesh(trimGeoS, trimMat);
    trimR.position.set(length / 2 + 0.005, deckElevation - 0.015, 0);
    root.add(trimF, trimB, trimL, trimR);
  }

  // 4 corner legs (plus 2 center legs for wide stage)
  const legGeo = new THREE.CylinderGeometry(0.025, 0.025, deckElevation - deckThick, 8);
  const lx = length / 2 - 0.12;
  const lz = width / 2 - 0.12;
  const legPositions: [number, number][] = [
    [-lx, -lz],
    [lx, -lz],
    [-lx, lz],
    [lx, lz],
  ];
  if (length >= 4.0) {
    legPositions.push([0, -lz], [0, lz]);
  }
  for (const [px, pz] of legPositions) {
    const leg = addPartWithEdges(root, legGeo, legMat, styleOpts, isSelected, castsShadows, 30);
    leg.position.set(px, (deckElevation - deckThick) / 2, pz);
  }
}

export { PLOT_PAPER_WHITE };
