import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SceneObject } from '../types/visualizer';
import {
  attachSelectionBoundingBox,
  createStyledLineSegments,
  resolveEffectiveStyle,
  ViewportRenderStyleOptions,
} from '../three/fixtureFactory';
import { GdtfGeometryNode, GdtfModelDef, GdtfProfile, ResolvedGdtfState } from './types';
import { resolveVfsAsset } from './vfsAndCache';

const SELECTED_COLOR = 0xff3b30;

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

// Module-level texture cache keyed by objectUrl so gobos are never reloaded per-frame
const vfsTextureCache = new Map<string, THREE.Texture>();
const textureLoader = new THREE.TextureLoader();

// Shared 1x1 white fallback texture for shader uniform uGoboMap
let fallbackWhiteTex: THREE.DataTexture | null = null;
function getFallbackWhiteTexture(): THREE.DataTexture {
  if (fallbackWhiteTex) return fallbackWhiteTex;
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  fallbackWhiteTex = tex;
  return tex;
}

function loadVfsGoboTexture(
  profileId: string,
  mediaFileName: string | undefined,
  onLoaded: (tex: THREE.Texture | null) => void,
) {
  if (!mediaFileName) {
    onLoaded(null);
    return;
  }
  const entry = resolveVfsAsset(profileId, mediaFileName, ['.png', '.jpg', '.jpeg', '.webp', '.svg']);
  if (!entry) {
    onLoaded(null);
    return;
  }
  const cached = vfsTextureCache.get(entry.objectUrl);
  if (cached) {
    onLoaded(cached);
    return;
  }
  textureLoader.load(
    entry.objectUrl,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      vfsTextureCache.set(entry.objectUrl, tex);
      onLoaded(tex);
    },
    undefined,
    () => onLoaded(null),
  );
}

const VOLUMETRIC_BEAM_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying float vAlong;
  varying vec3 vLocalPos;
  varying vec3 vNormalView;
  varying vec3 vViewPos;

  void main() {
    vUv = uv;
    // ConeGeometry translated so tip is at y = 0 and base is at y = -6.2
    vAlong = clamp(-position.y / 6.2, 0.0, 1.0);
    vLocalPos = position;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mvPos.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const VOLUMETRIC_BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uDimmer;
  uniform float uHasGobo;
  uniform sampler2D uGoboMap;
  uniform float uBaseRadius;
  uniform float uRenderOpacity;
  uniform float uTime;

  varying vec2 vUv;
  varying float vAlong;
  varying vec3 vLocalPos;
  varying vec3 vNormalView;
  varying vec3 vViewPos;

  void main() {
    // Longitudinal inverse falloff from lens tip to beam end
    float longitudinal = pow(1.0 - vAlong, 1.55);

    // Grazing-angle rim attenuation so cone silhouettes stay soft and volumetric
    vec3 n = normalize(vNormalView);
    vec3 v = normalize(vViewPos);
    float fresnel = pow(abs(dot(n, v)), 1.18);

    // Subtle atmospheric haze shimmer
    float haze = 0.92 + 0.08 * sin(vAlong * 18.0 - uTime * 1.4);

    float goboMask = 1.0;
    if (uHasGobo > 0.5) {
      float sliceRadius = max(0.02, uBaseRadius * vAlong);
      vec2 projUv = (vLocalPos.xz / (sliceRadius * 2.15)) + vec2(0.5);
      if (projUv.x >= 0.0 && projUv.x <= 1.0 && projUv.y >= 0.0 && projUv.y <= 1.0) {
        vec4 gTex = texture2D(uGoboMap, projUv);
        goboMask = mix(0.18, 1.0, gTex.r);
      }
    }

    float alpha = uDimmer * uRenderOpacity * longitudinal * fresnel * haze * goboMask;
    if (alpha < 0.004) discard;

    gl_FragColor = vec4(uColor * (0.85 + 0.55 * (1.0 - vAlong)), alpha);
  }
`;

export interface GdtfBeamBinding {
  beamAnchor: THREE.Group;
  coneMesh: THREE.Mesh;
  coneMat: THREE.ShaderMaterial;
  plotLines: THREE.Object3D;
  spotLight: THREE.SpotLight;
  lensMat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  baseHalfRad: number;
  baseRadius: number;
}

export interface GdtfRigHandle {
  profileId: string;
  objectId: string;
  root: THREE.Group;
  yokeNode: THREE.Object3D | null;
  headNode: THREE.Object3D | null;
  beams: GdtfBeamBinding[];
  currentGoboMedia?: string;
}

function createEdgeLines(
  geometry: THREE.BufferGeometry,
  color: number,
  styleOpts: ViewportRenderStyleOptions,
): THREE.Object3D {
  const resolved = resolveEffectiveStyle(styleOpts);
  const edges = new THREE.EdgesGeometry(geometry, 24);
  return createStyledLineSegments(
    edges,
    color,
    resolved.baseMode === 'plot' ? resolved.lineStyle : 'Solid',
    resolved.baseMode === 'plot' ? resolved.lineWeightPt : 0.75,
  );
}

function createFallbackModelGeometry(modelDef: GdtfModelDef | undefined, node: GdtfGeometryNode): THREE.BufferGeometry {
  const l = Math.max(0.05, modelDef?.length ?? 0.24);
  const w = Math.max(0.05, modelDef?.width ?? 0.22);
  const h = Math.max(0.04, modelDef?.height ?? 0.18);
  const prim = (modelDef?.primitiveType || node.type).toLowerCase();

  if (prim.includes('head') || prim.includes('cylinder') || prim.includes('conventional')) {
    const rTop = Math.min(l, w) * 0.44;
    const rBot = Math.min(l, w) * 0.5;
    return new THREE.CylinderGeometry(rTop, rBot, h, 14);
  }
  if (prim.includes('yoke')) {
    return new THREE.BoxGeometry(l, h, Math.min(w, 0.11));
  }
  return new THREE.BoxGeometry(l, h, w);
}

function applyRenderModeToSubtree(
  target: THREE.Object3D,
  styleOpts: ViewportRenderStyleOptions,
  isSelected: boolean,
  isAccent: boolean,
  castsShadows: boolean,
) {
  const resolved = resolveEffectiveStyle(styleOpts);
  target.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = resolved.baseMode === 'live' && castsShadows;
    mesh.receiveShadow = resolved.baseMode === 'live';

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
    } else {
      mesh.material = new THREE.MeshStandardMaterial({
        color: isSelected ? (isAccent ? 0x992a24 : 0x6a1d19) : isAccent ? 0x4b515a : 0x1e2024,
        roughness: isAccent ? 0.26 : 0.42,
        metalness: isAccent ? 0.82 : 0.35,
      });
    }

    if (resolved.showEdges || isSelected) {
      const existingEdge = mesh.children.find((c) => c.userData.isEdgeLine);
      if (!existingEdge && mesh.geometry) {
        mesh.add(
          createEdgeLines(
            mesh.geometry,
            isSelected ? SELECTED_COLOR : resolved.strokeColorHex,
            styleOpts,
          ),
        );
      }
    }
  });
}

function resolveAxisRoles(profile: GdtfProfile, modeName?: string): { panGeomName: string; tiltGeomName: string } {
  const mode = (modeName ? profile.dmxModes.find((m) => m.name === modeName) : undefined) ?? profile.dmxModes[0];
  let panGeomName = 'yoke';
  let tiltGeomName = 'head';

  if (mode) {
    for (const ch of mode.dmxChannels) {
      for (const lc of ch.logicalChannels) {
        if (lc.attribute === 'Pan' && ch.geometry) {
          panGeomName = ch.geometry.toLowerCase();
        } else if (lc.attribute === 'Tilt' && ch.geometry) {
          tiltGeomName = ch.geometry.toLowerCase();
        }
      }
    }
  }
  return { panGeomName, tiltGeomName };
}

export function assembleGdtfRuntimeGroup(
  obj: SceneObject,
  profile: GdtfProfile,
  styleOpts: ViewportRenderStyleOptions,
  isSelected: boolean,
  resolved: ResolvedGdtfState,
  isSoftwareGl: boolean,
  onAsyncLoaded: () => void,
): GdtfRigHandle {
  const effStyle = resolveEffectiveStyle(styleOpts);
  const castsShadows = obj.castsShadows ?? true;
  const root = new THREE.Group();
  root.name = obj.id;
  root.userData.objectId = obj.id;
  root.position.set(obj.position[0], obj.position[1], obj.position[2]);
  root.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);

  const { panGeomName, tiltGeomName } = resolveAxisRoles(profile, obj.gdtfModeName);

  const rigHandle: GdtfRigHandle = {
    profileId: profile.id,
    objectId: obj.id,
    root,
    yokeNode: null,
    headNode: null,
    beams: [],
    currentGoboMedia: undefined,
  };

  // Mounting C-clamp visual cue at local (0,0,0)
  const clampGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10);
  const clampMesh = new THREE.Mesh(clampGeo);
  clampMesh.position.set(0, 0.04, 0);
  applyRenderModeToSubtree(clampMesh, styleOpts, isSelected, true, castsShadows);
  root.add(clampMesh);

  const buildNode = (node: GdtfGeometryNode, parent: THREE.Object3D) => {
    const group = new THREE.Group();
    group.name = node.name;
    _mat4.fromArray(node.matrix);
    _mat4.decompose(_pos, _quat, _scale);
    group.position.copy(_pos);
    group.quaternion.copy(_quat);
    group.scale.copy(_scale);
    parent.add(group);

    const lowerName = node.name.toLowerCase();
    if (!rigHandle.yokeNode && (lowerName === panGeomName || lowerName.includes('yoke') || lowerName.includes('pan'))) {
      rigHandle.yokeNode = group;
    } else if (!rigHandle.headNode && (lowerName === tiltGeomName || lowerName.includes('head') || lowerName.includes('tilt'))) {
      rigHandle.headNode = group;
    }

    const modelDef = node.model ? profile.models[node.model] : undefined;
    const isBeamNode = node.type === 'Beam';

    if (!isBeamNode) {
      const gltfAsset = modelDef?.file
        ? resolveVfsAsset(profile.id, modelDef.file, ['.gltf', '.glb'])
        : undefined;

      // Build immediate fallback/procedural mesh
      const placeholderHolder = new THREE.Group();
      const geo = createFallbackModelGeometry(modelDef, node);
      const mesh = new THREE.Mesh(geo);
      const isAccent = lowerName.includes('yoke') || lowerName.includes('clamp');
      applyRenderModeToSubtree(mesh, styleOpts, isSelected, isAccent, castsShadows);
      placeholderHolder.add(mesh);

      // For Yoke primitive, add twin side arms cleanly framing the Head
      if ((modelDef?.primitiveType || '').toLowerCase() === 'yoke' && modelDef) {
        const armGeo = new THREE.BoxGeometry(0.038, modelDef.height * 0.88, 0.08);
        const armOffset = Math.max(0.09, modelDef.length * 0.41);
        for (const sx of [-armOffset, armOffset]) {
          const arm = new THREE.Mesh(armGeo);
          arm.position.set(sx, -modelDef.height * 0.44, 0);
          applyRenderModeToSubtree(arm, styleOpts, isSelected, false, castsShadows);
          placeholderHolder.add(arm);
        }
      }

      group.add(placeholderHolder);

      if (gltfAsset) {
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
          const vfsMatch = resolveVfsAsset(profile.id, url);
          return vfsMatch ? vfsMatch.objectUrl : url;
        });
        const loader = new GLTFLoader(manager);
        loader.load(
          gltfAsset.objectUrl,
          (gltf) => {
            group.remove(placeholderHolder);
            applyRenderModeToSubtree(gltf.scene, styleOpts, isSelected, isAccent, castsShadows);
            gltf.scene.traverse((c) => {
              c.userData.objectId = obj.id;
            });
            group.add(gltf.scene);
            onAsyncLoaded();
          },
          undefined,
          () => {
            // Keep procedural fallback if GLTF parse fails
          },
        );
      }
    } else {
      // Terminal Beam Emitter Node: optical lens + Volumetric GLSL Shader Beam + SpotLight
      const lensRadius = Math.max(0.04, node.beamRadius ?? 0.075);
      const lensGeo = new THREE.CircleGeometry(lensRadius, 16);
      const fixtureColor = new THREE.Color(resolved.colorHex);
      const lensMat =
        effStyle.baseMode === 'live'
          ? new THREE.MeshStandardMaterial({
              color: fixtureColor,
              emissive: fixtureColor,
              emissiveIntensity: 0.4 + resolved.dimmer * 2.5,
              roughness: 0.1,
              metalness: 0.1,
            })
          : new THREE.MeshBasicMaterial({
              color: isSelected
                ? SELECTED_COLOR
                : effStyle.baseMode === 'plot'
                  ? effStyle.strokeColorHex
                  : 0xffffff,
              transparent: effStyle.baseMode === 'wireframe',
              opacity: effStyle.baseMode === 'wireframe' ? 0.32 : 0.78,
              side: THREE.DoubleSide,
              toneMapped: false,
            });
      const lensMesh = new THREE.Mesh(lensGeo, lensMat);
      lensMesh.rotation.x = Math.PI / 2;
      group.add(lensMesh);

      const beamAnchor = new THREE.Group();
      group.add(beamAnchor);

      const baseAngleDeg = resolved.beamAngleDeg || node.beamAngle || 20;
      const baseHalfRad = THREE.MathUtils.degToRad(baseAngleDeg * 0.5);
      const beamLength = 6.2;
      const baseRadius = Math.max(0.25, Math.tan(baseHalfRad) * beamLength);

      const coneGeo = new THREE.ConeGeometry(baseRadius, beamLength, 24, 1, true);
      coneGeo.translate(0, -beamLength / 2, 0);

      const coneMat = new THREE.ShaderMaterial({
        vertexShader: VOLUMETRIC_BEAM_VERTEX,
        fragmentShader: VOLUMETRIC_BEAM_FRAGMENT,
        uniforms: {
          uColor: { value: fixtureColor.clone() },
          uDimmer: { value: resolved.dimmer },
          uHasGobo: { value: 0.0 },
          uGoboMap: { value: getFallbackWhiteTexture() },
          uBaseRadius: { value: baseRadius },
          uRenderOpacity: { value: effStyle.baseMode === 'live' ? 0.48 : 0.2 },
          uTime: { value: 0.0 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const coneMesh = new THREE.Mesh(coneGeo, coneMat);
      coneMesh.renderOrder = 5;
      coneMesh.userData.isVolumetricBeam = true;
      coneMesh.visible = effStyle.baseMode === 'live' && resolved.dimmer > 0.01;
      beamAnchor.add(coneMesh);

      // Plot/Custom technical projection lines inheriting layer style
      const plotLen = 2.4;
      const plotR = Math.tan(baseHalfRad) * plotLen;
      const pts: number[] = [];
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2;
        const a1 = ((i + 1) / 8) * Math.PI * 2;
        const x0 = Math.cos(a0) * plotR;
        const z0 = Math.sin(a0) * plotR;
        const x1 = Math.cos(a1) * plotR;
        const z1 = Math.sin(a1) * plotR;
        if (i % 2 === 0) pts.push(0, 0, 0, x0, -plotLen, z0);
        pts.push(x0, -plotLen, z0, x1, -plotLen, z1);
      }
      const plotGeo = new THREE.BufferGeometry();
      plotGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const plotLines = createStyledLineSegments(
        plotGeo,
        isSelected ? SELECTED_COLOR : effStyle.baseMode === 'plot' ? effStyle.strokeColorHex : fixtureColor.getHex(),
        effStyle.baseMode === 'plot' ? effStyle.lineStyle : 'Solid',
        effStyle.baseMode === 'plot' ? effStyle.lineWeightPt : 0.75,
        effStyle.baseMode === 'plot' ? 0.85 : 0.45,
      );
      plotLines.visible =
        effStyle.baseMode === 'plot' || (styleOpts.renderMode === 'custom' && resolved.dimmer > 0.04);
      beamAnchor.add(plotLines);

      // Real SpotLight illuminating the stage
      const spotLight = new THREE.SpotLight(
        fixtureColor,
        resolved.dimmer * 28,
        20,
        baseHalfRad,
        0.55,
        1.55,
      );
      spotLight.position.set(0, 0, 0);
      spotLight.target.position.set(0, -5, 0);
      spotLight.castShadow = false;
      spotLight.visible = effStyle.baseMode === 'live' && resolved.dimmer > 0.01 && !isSoftwareGl;
      beamAnchor.add(spotLight);
      beamAnchor.add(spotLight.target);

      rigHandle.beams.push({
        beamAnchor,
        coneMesh,
        coneMat,
        plotLines,
        spotLight,
        lensMat,
        baseHalfRad,
        baseRadius,
      });
    }

    for (const child of node.children) {
      buildNode(child, group);
    }
  };

  for (const topNode of profile.geometries) {
    buildNode(topNode, root);
  }

  // Apply initial resolved DMX transforms & shader uniforms
  applyDmxToGdtfRig(rigHandle, resolved, styleOpts, isSelected, onAsyncLoaded);

  if (isSelected) {
    attachSelectionBoundingBox(root);
  }

  root.traverse((child) => {
    child.userData.objectId = obj.id;
  });

  return rigHandle;
}

export function applyDmxToGdtfRig(
  rigHandle: GdtfRigHandle,
  resolved: ResolvedGdtfState,
  styleOpts: ViewportRenderStyleOptions,
  isSelected: boolean,
  onAsyncLoaded: () => void,
  timeSec = 0,
): void {
  const effStyle = resolveEffectiveStyle(styleOpts);
  if (rigHandle.yokeNode) {
    rigHandle.yokeNode.rotation.y = THREE.MathUtils.degToRad(resolved.panDeg);
  }
  if (rigHandle.headNode) {
    rigHandle.headNode.rotation.x = THREE.MathUtils.degToRad(resolved.tiltDeg);
  }

  const col = new THREE.Color(resolved.colorHex);
  const halfRad = THREE.MathUtils.degToRad(Math.max(4, resolved.beamAngleDeg) * 0.5);

  const strobeFactor =
    resolved.strobeHz > 0
      ? Math.sin(timeSec * resolved.strobeHz * Math.PI * 2) > 0
        ? 1.0
        : 0.08
      : 1.0;
  const effDimmer = resolved.dimmer * strobeFactor;

  for (const beam of rigHandle.beams) {
    const scaleFactor = Math.tan(halfRad) / Math.max(0.05, Math.tan(beam.baseHalfRad));
    beam.coneMesh.scale.set(scaleFactor, 1, scaleFactor);
    beam.plotLines.scale.set(scaleFactor, 1, scaleFactor);

    beam.coneMat.uniforms.uColor.value.copy(col);
    beam.coneMat.uniforms.uDimmer.value = effDimmer;
    beam.coneMat.uniforms.uTime.value = timeSec;
    beam.coneMesh.visible = effStyle.baseMode === 'live' && effDimmer > 0.01;

    beam.plotLines.visible =
      effStyle.baseMode === 'plot' || (styleOpts.renderMode === 'custom' && effDimmer > 0.04);
    const plotColorHex = isSelected
      ? SELECTED_COLOR
      : effStyle.baseMode === 'plot'
        ? effStyle.strokeColorHex
        : col.getHex();
    beam.plotLines.traverse((child) => {
      const seg = child as THREE.LineSegments;
      if (seg.isLineSegments && seg.material instanceof THREE.LineBasicMaterial) {
        seg.material.color.set(plotColorHex);
      }
    });

    beam.spotLight.color.copy(col);
    beam.spotLight.intensity = effDimmer * 28;
    beam.spotLight.angle = Math.min(Math.PI / 2 - 0.05, halfRad);
    beam.spotLight.visible = effStyle.baseMode === 'live' && effDimmer > 0.01;

    if (beam.lensMat instanceof THREE.MeshStandardMaterial) {
      beam.lensMat.color.copy(col);
      beam.lensMat.emissive.copy(col);
      beam.lensMat.emissiveIntensity = 0.25 + effDimmer * 2.6;
    } else {
      beam.lensMat.color.set(
        isSelected
          ? SELECTED_COLOR
          : effStyle.baseMode === 'plot'
            ? effStyle.strokeColorHex
            : col.getHex(),
      );
    }
  }

  if (rigHandle.currentGoboMedia !== resolved.goboMediaFile) {
    rigHandle.currentGoboMedia = resolved.goboMediaFile;
    loadVfsGoboTexture(rigHandle.profileId, resolved.goboMediaFile, (tex) => {
      for (const beam of rigHandle.beams) {
        if (tex) {
          beam.coneMat.uniforms.uGoboMap.value = tex;
          beam.coneMat.uniforms.uHasGobo.value = 1.0;
        } else {
          beam.coneMat.uniforms.uGoboMap.value = getFallbackWhiteTexture();
          beam.coneMat.uniforms.uHasGobo.value = 0.0;
        }
      }
      onAsyncLoaded();
    });
  }
}
