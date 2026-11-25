import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, Power } from 'lucide-react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { applyDmxToGdtfRig, assembleGdtfRuntimeGroup, GdtfRigHandle } from '../gdtf/runtimeAssembly';
import { resolveGdtfDmxState } from '../gdtf/dmxEngine';
import { GdtfProfile } from '../gdtf/types';
import { DmxUniversesMap } from '../gdtf/dmxEngine';
import { buildSkpSceneObjectGroup } from '../skp/skpRuntime';
import {
  buildSceneObjectGroup,
  PLOT_PAPER_WHITE,
  ViewportRenderStyleOptions,
} from '../three/fixtureFactory';
import {
  computeLiveSmokeAtmosphere,
  createLiveSmokeRig,
  LiveSmokeHandle,
  resolveSmokeParameters,
  updateLiveSmokeRig,
} from '../three/smokeSimulation';
import {
  GizmoAxis,
  intersectRayWithAxis,
  intersectRayWithConstraintPlane,
} from '../three/translationGizmo';
import {
  buildMoveGhostGroup,
  computeGhostBoxMetrics,
  TransformGhostItem,
} from '../three/ghostPreview';
import { buildSnapIndicator, findTrussSnap } from '../three/trussSnap';
import {
  CameraPreset,
  LayerItem,
  ObjectKind,
  ProjectionType,
  RenderMode,
  SceneObject,
  ViewportId,
  ViewportSettings,
} from '../types/visualizer';
import {
  DollyButtonIcon,
  MenuBarsButtonIcon,
  OrbitButtonIcon,
  OriginCloudIcon,
} from './Icons';
import { aimAt, FIXTURE_KINDS, LiveControlPane } from './LiveControlPane';
import { computeCubeMatrix3d, ViewCube, ViewCubeSnapTarget } from './ViewCube';

interface CadViewportProps {
  settings: ViewportSettings;
  objects: SceneObject[];
  layers: LayerItem[];
  selectedObjectIds: string[];
  gdtfProfiles: GdtfProfile[];
  dmxUniverses: DmxUniversesMap;
  cameraCommand?: {
    nonce: number;
    targetViewportId?: ViewportId;
    preset?: CameraPreset;
  } | null;
  transformGhostItems?: TransformGhostItem[] | null;
  onTransformGhostChange?: (items: TransformGhostItem[] | null) => void;
  onSelectObject: (id: string | null, mode?: 'replace' | 'toggle') => void;
  onSelectMultiple?: (ids: string[], additive: boolean) => void;
  onMoveObjects: (moves: Array<{ id: string; position: [number, number, number] }>) => void;
  onDropLibraryItem: (kind: ObjectKind, position: [number, number, number], catalogId?: string) => void;
  onDropGdtfProfile: (profileId: string, modeName: string | undefined, position: [number, number, number]) => void;
  onDropSkpModel: (skpModelId: string, position: [number, number, number]) => void;
  onDropMaterial?: (materialId: string, hitObjectId: string | null) => void;
  onDropExternalFiles: (files: FileList, position: [number, number, number]) => void;
  onUpdateSettings: (id: ViewportId, patch: Partial<ViewportSettings>) => void;
  onUpdateObjects: (ids: string[], patch: Partial<SceneObject>) => void;
  onDuplicateObjects: (ids: string[]) => void;
  onDeleteObjects: (ids: string[]) => void;
  onShowDetails: () => void;
  onStoreCameraPreset: (preset: Omit<CameraPreset, 'id'>) => void;
}

const PROJECTIONS: ProjectionType[] = ['Top', 'Front', 'Right', 'Back', 'Left', 'Bottom', 'Perspective'];

// Module-scope reusable math helpers (zero GC inside render/animation loops)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _gridRight = new THREE.Vector3();
const _gridUp = new THREE.Vector3();
const _gridForward = new THREE.Vector3();
const _plane = new THREE.Plane();
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _spherical = new THREE.Spherical();
const _invQuat = new THREE.Quaternion();

const PIXELS_PER_METER = 20; // Matches ~20px minor CAD grid spacing at zoom = 1
const MIN_ZOOM = 1e-6;
const MAX_ZOOM = 1e6;

const SNAP_ORTHO_AXES: Array<{
  projection: 'Front' | 'Top' | 'Left' | 'Right';
  unitDir: THREE.Vector3;
}> = [
  { projection: 'Front', unitDir: new THREE.Vector3(0, 0, 1) },
  { projection: 'Top', unitDir: new THREE.Vector3(0, 1, 0) },
  { projection: 'Left', unitDir: new THREE.Vector3(-1, 0, 0) },
  { projection: 'Right', unitDir: new THREE.Vector3(1, 0, 0) },
];

function findNearestOrthoSnap(
  offset: THREE.Vector3,
  thresholdDeg = 9.0,
): 'Front' | 'Top' | 'Left' | 'Right' | null {
  const len = offset.length();
  if (len < 1e-5) return null;
  const dir = _v1.copy(offset).divideScalar(len);
  let bestProj: 'Front' | 'Top' | 'Left' | 'Right' | null = null;
  let bestDot = Math.cos(THREE.MathUtils.degToRad(thresholdDeg));
  for (const ax of SNAP_ORTHO_AXES) {
    const dot = dir.dot(ax.unitDir);
    if (dot >= bestDot) {
      bestDot = dot;
      bestProj = ax.projection;
    }
  }
  return bestProj;
}

function isCameraAlignedToOrthoGridView(
  projection: ProjectionType,
  offset: THREE.Vector3,
): boolean {
  const ax = SNAP_ORTHO_AXES.find((a) => a.projection === projection);
  if (!ax) return false;
  const len = offset.length();
  if (len < 1e-5) return false;
  const dot = _v1.copy(offset).divideScalar(len).dot(ax.unitDir);
  return dot >= 0.9994; // Within ~2° of exact world axis
}

/** The single CAD grid is always the floor plane, in every view. */
function shouldShowGrid(
  settings: ViewportSettings,
  effectiveMode: 'wireframe' | 'plot' | 'live',
): boolean {
  return settings.showGrid && effectiveMode !== 'live';
}

function getDefaultCameraBasis(projection: ProjectionType): {
  offset: THREE.Vector3;
  target: THREE.Vector3;
} {
  switch (projection) {
    case 'Top':
      return { offset: new THREE.Vector3(0, 26, 0.002), target: new THREE.Vector3(0, 0, 0) };
    case 'Bottom':
      return { offset: new THREE.Vector3(0, -26, -0.002), target: new THREE.Vector3(0, 0, 0) };
    case 'Front':
      return { offset: new THREE.Vector3(0, 0, 26), target: new THREE.Vector3(0, 0, 0) };
    case 'Right':
      return { offset: new THREE.Vector3(26, 0, 0), target: new THREE.Vector3(0, 0, 0) };
    case 'Back':
      return { offset: new THREE.Vector3(0, 0, -26), target: new THREE.Vector3(0, 0, 0) };
    case 'Left':
      return { offset: new THREE.Vector3(-26, 0, 0), target: new THREE.Vector3(0, 0, 0) };
    case 'Perspective':
      return { offset: new THREE.Vector3(9.5, 6.2, 10.5), target: new THREE.Vector3(0, 1.5, -0.5) };
  }
}

function kelvinToRgb(kelvin: number): [number, number, number] {
  const temp = THREE.MathUtils.clamp(kelvin, 1800, 12000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }
  return [
    THREE.MathUtils.clamp(r / 255, 0, 1),
    THREE.MathUtils.clamp(g / 255, 0, 1),
    THREE.MathUtils.clamp(b / 255, 0, 1),
  ];
}

function parseAspectRatio(ratio: string): number | null {
  switch (ratio) {
    case '16:9':
      return 16 / 9;
    case '4:3':
      return 4 / 3;
    case '1:1':
      return 1;
    case '21:9':
      return 21 / 9;
    default:
      return null;
  }
}

function resolveViewportBaseMode(settings: ViewportSettings): 'wireframe' | 'plot' | 'live' {
  if (settings.renderMode === 'custom') {
    if (settings.customFaceStyle === 'Plot') return 'plot';
    if (settings.customFaceStyle === 'Wireframe') return 'wireframe';
    return 'live';
  }
  return settings.renderMode;
}

function buildObjectStyleOpts(
  settings: ViewportSettings,
  layer: LayerItem | undefined,
  effectiveBaseMode: 'wireframe' | 'plot' | 'live',
): ViewportRenderStyleOptions {
  return {
    renderMode: settings.renderMode,
    customFaceStyle: settings.customFaceStyle,
    customWireframeOverlay: settings.customWireframeOverlay,
    layerColor: layer?.color ?? (effectiveBaseMode === 'plot' ? '#1F2937' : '#FFFFFF'),
    lineWeightPt: layer?.lineWeightPt ?? 0.75,
    lineStyle: layer?.lineStyle ?? 'Solid',
  };
}

const GRID_VERTEX_SHADER = `
  varying vec2 vScreen;
  void main() {
    // Full-screen quad at the far depth plane; no finite world-space plate.
    vScreen = position.xy;
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`;

const GRID_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vScreen;
  uniform vec2 uSpacing;
  uniform vec3 uMinorColor;
  uniform vec3 uMajorColor;
  uniform vec3 uAxisColor;
  uniform vec3 uCameraPos;
  uniform vec3 uCamRight;
  uniform vec3 uCamUp;
  uniform vec3 uCamForward;
  uniform float uIsPerspective;
  uniform float uTanHalfFov;
  uniform float uAspect;
  uniform vec2 uOrthoHalf;

  float gridLine(vec2 coord, vec2 spacing, float thickness) {
    vec2 g = coord / spacing;
    vec2 w = fwidth(g);
    vec2 d = abs(fract(g - 0.5) - 0.5) / max(w * thickness, vec2(0.00001));
    float line = 1.0 - min(min(d.x, d.y), 1.0);
    float fade = 1.0 - smoothstep(1.5, 4.0, max(w.x, w.y) / thickness);
    return line * fade;
  }

  void main() {
    vec3 origin;
    vec3 dir;
    if (uIsPerspective > 0.5) {
      origin = uCameraPos;
      dir = normalize(
        uCamForward +
        uCamRight * vScreen.x * uTanHalfFov * uAspect +
        uCamUp * vScreen.y * uTanHalfFov
      );
    } else {
      origin = uCameraPos +
        uCamRight * vScreen.x * uOrthoHalf.x +
        uCamUp * vScreen.y * uOrthoHalf.y;
      dir = uCamForward;
    }

    // Ray/plane intersection with the world floor y = 0. No plane means no
    // visible edge: the grid extends as far as the camera ray reaches.
    if (abs(dir.y) < 1e-6) discard;
    float t = -origin.y / dir.y;
    if (t <= 0.0) discard;
    vec2 coord = (origin + dir * t).xz;

    // Minor spacing never changes with zoom: 1 m by default. Every tenth line
    // is only emphasised, never a new unit.
    float minor = gridLine(coord, uSpacing, 1.0);
    float major = gridLine(coord, uSpacing * 10.0, 1.8);
    vec2 w = max(fwidth(coord), vec2(0.00001));
    float axisX = 1.0 - smoothstep(0.0, w.x * 2.4, abs(coord.x));
    float axisY = 1.0 - smoothstep(0.0, w.y * 2.4, abs(coord.y));
    float axis = max(axisX, axisY);

    vec3 color = mix(uMinorColor, uMajorColor, major);
    color = mix(color, uAxisColor, axis);
    float alpha = max(max(minor * 0.8, major * 0.95), axis);
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

const gridColorVec = (hex: number) =>
  new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

/**
 * True infinite CAD grid: a full-screen quad intersects the camera ray with
 * the world floor plane, so there is no finite plate and no visible border at
 * any zoom or angle. A small cross-line keeps the floor readable edge-on.
 */
function buildCadGrid(
  gridWidth = 1,
  gridHeight = 1,
  effectiveMode: 'wireframe' | 'plot' | 'live' = 'wireframe',
): THREE.Group {
  const group = new THREE.Group();
  const gw = Math.max(0.25, gridWidth);
  const gh = Math.max(0.25, gridHeight);
  const isPlot = effectiveMode === 'plot';

  const uniforms = {
    uSpacing: { value: new THREE.Vector2(gw, gh) },
    uMinorColor: { value: gridColorVec(isPlot ? 0xd4dbd0 : 0x2f7d3c) },
    uMajorColor: { value: gridColorVec(isPlot ? 0xa7b3a4 : 0x55c566) },
    uAxisColor: { value: gridColorVec(isPlot ? 0x7f8d7c : 0x93ed9f) },
    uCameraPos: { value: new THREE.Vector3() },
    uCamRight: { value: new THREE.Vector3(1, 0, 0) },
    uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uCamForward: { value: new THREE.Vector3(0, 0, -1) },
    uIsPerspective: { value: 0 },
    uTanHalfFov: { value: 1 },
    uAspect: { value: 1 },
    uOrthoHalf: { value: new THREE.Vector2(10, 10) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: GRID_VERTEX_SHADER,
    fragmentShader: GRID_FRAGMENT_SHADER,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -3;
  group.add(mesh);

  // In exact side views the floor plane is edge-on, so the shader would draw
  // nothing. This cross at y=0 keeps the same floor grid visible as a line.
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 1], 3),
  );
  const edgeLine = new THREE.LineSegments(
    edgeGeometry,
    new THREE.LineBasicMaterial({
      color: isPlot ? 0xa7b3a4 : 0x55c566,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  edgeLine.name = 'FloorGridEdge';
  edgeLine.renderOrder = -2;
  edgeLine.visible = false;
  group.add(edgeLine);

  return group;
}

function disposeGroupResources(group: THREE.Object3D) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) {
      mat.forEach((m) => m.dispose());
    } else if (mat) {
      mat.dispose();
    }
  });
}

function clearSnapIndicator(st: {
  scene: THREE.Scene;
  snapGroup: THREE.Group | null;
  requestRender: () => void;
} | null): void {
  if (!st?.snapGroup) return;
  st.scene.remove(st.snapGroup);
  st.snapGroup.traverse((child) => {
    if (child instanceof THREE.Sprite) {
      child.material.dispose();
      return;
    }
    const line = child as THREE.Line;
    if (line.geometry) line.geometry.dispose();
    const mat = (child as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
  st.snapGroup = null;
  st.requestRender();
}

export const CadViewport: React.FC<CadViewportProps> = ({
  settings,
  objects,
  layers,
  selectedObjectIds,
  gdtfProfiles,
  dmxUniverses,
  cameraCommand,
  transformGhostItems,
  onTransformGhostChange,
  onSelectObject,
  onSelectMultiple,
  onMoveObjects,
  onDropLibraryItem,
  onDropGdtfProfile,
  onDropSkpModel,
  onDropMaterial,
  onDropExternalFiles,
  onUpdateSettings,
  onUpdateObjects,
  onDuplicateObjects,
  onDeleteObjects,
  onShowDetails,
  onStoreCameraPreset,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasMountRef = useRef<HTMLDivElement>(null);

  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [liveControlOpen, setLiveControlOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const focusModeRef = useRef(false);
  const [cameraSubmenuOpen, setCameraSubmenuOpen] = useState(false);
  const [storeSubmenuOpen, setStoreSubmenuOpen] = useState(false);
  const [hoveredMenuItem, setHoveredMenuItem] = useState<string | null>(null);
  const [cubeState, setCubeState] = useState<{
    matrix3d: string;
    viewDir: [number, number, number];
  }>({
    matrix3d: 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)',
    viewDir: [0, 0, 1],
  });
  const skipNextProjectionResetRef = useRef(false);
  const [hoveredGizmoAxis, setHoveredGizmoAxis] = useState<GizmoAxis | null>(null);
  const activeGizmoAxisRef = useRef<GizmoAxis | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
    additive: boolean;
  } | null>(null);
  const [dragDeltaHud, setDragDeltaHud] = useState<{
    x: number;
    y: number;
    modeLabel: string;
    dx: number;
    dy: number;
    dz: number;
    dist: number;
    pos: [number, number, number];
  } | null>(null);
  const [originScreenPos, setOriginScreenPos] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });
  const [fixtureLabels, setFixtureLabels] = useState<
    Array<{ id: string; text: string; x: number; y: number; selected: boolean; layerColor?: string }>
  >([]);
  const [lensNodes, setLensNodes] = useState<
    Array<{ id: string; x: number; y: number; color: string; intensity: number }>
  >([]);
  const [vpSize, setVpSize] = useState<{ w: number; h: number }>({ w: 600, h: 400 });
  const [flickerGain, setFlickerGain] = useState(1);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    focusModeRef.current = focusMode;
  }, [focusMode]);

  // Latest props in refs so WebGL lifecycle never tears down on UI updates
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const selectedIdsRef = useRef(selectedObjectIds);
  selectedIdsRef.current = selectedObjectIds;
  const gdtfProfilesRef = useRef(gdtfProfiles);
  gdtfProfilesRef.current = gdtfProfiles;
  const dmxUniversesRef = useRef(dmxUniverses);
  dmxUniversesRef.current = dmxUniverses;

  const onSelectRef = useRef(onSelectObject);
  onSelectRef.current = onSelectObject;
  const onSelectMultipleRef = useRef(onSelectMultiple);
  onSelectMultipleRef.current = onSelectMultiple;
  const onTransformGhostChangeRef = useRef(onTransformGhostChange);
  onTransformGhostChangeRef.current = onTransformGhostChange;
  const onMoveRef = useRef(onMoveObjects);
  onMoveRef.current = onMoveObjects;
  const onDropRef = useRef(onDropLibraryItem);
  onDropRef.current = onDropLibraryItem;
  const onDropGdtfRef = useRef(onDropGdtfProfile);
  onDropGdtfRef.current = onDropGdtfProfile;
  const onDropSkpRef = useRef(onDropSkpModel);
  onDropSkpRef.current = onDropSkpModel;
  const onDropMaterialRef = useRef(onDropMaterial);
  onDropMaterialRef.current = onDropMaterial;

  // Selecting fixtures in a Live view always brings their Control Pane back,
  // even if the user had closed it with the power button.
  useEffect(() => {
    if (resolveViewportBaseMode(settings) !== 'live') return;
    const hasSelectedFixture = objects.some(
      (o) => selectedObjectIds.includes(o.id) && FIXTURE_KINDS.has(o.kind),
    );
    if (hasSelectedFixture) setLiveControlOpen(true);
  }, [selectedObjectIds, objects, settings.renderMode, settings.customFaceStyle]);
  const onDropFilesRef = useRef(onDropExternalFiles);
  onDropFilesRef.current = onDropExternalFiles;
  const onUpdateObjectsRef = useRef(onUpdateObjects);
  onUpdateObjectsRef.current = onUpdateObjects;

  // Mutable Three.js state ref
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    orthoCam: THREE.OrthographicCamera;
    perspCam: THREE.PerspectiveCamera;
    activeCam: THREE.Camera;
    target: THREE.Vector3;
    camOffset: THREE.Vector3;
    zoom: number;
    gridGroup: THREE.Group;
    objectsGroup: THREE.Group;
    gizmoGroup: THREE.Group | null;
    ghostGroup: THREE.Group | null;
    snapGroup: THREE.Group | null;
    gdtfRigMap: Map<string, GdtfRigHandle>;
    smokeRigMap: Map<string, LiveSmokeHandle>;
    smokeDriftPhase: number;
    liveRigGroup: THREE.Group;
    ambientLight: THREE.AmbientLight;
    hemiLight: THREE.HemisphereLight;
    keyLight: THREE.DirectionalLight;
    rimLight: THREE.DirectionalLight;
    envTexture: THREE.Texture | null;
    isSoftwareGl: boolean;
    requestRender: () => void;
    width: number;
    height: number;
    spaceDown: boolean;
    snapAnim: {
      active: boolean;
      goalOffset: THREE.Vector3;
      goalTarget: THREE.Vector3 | null;
      lastTime: number;
    };
  } | null>(null);

  // Initialize Three.js WebGLRenderer & Scene once
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 1);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    mount.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Procedural Studio RoomEnvironment for Live PBR metallic highlights
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Live Mode 3-Point Studio + Stage Floor Rig (hidden in Wireframe/Plot)
    const liveRigGroup = new THREE.Group();
    // True omni-directional ambient light: no position, no shadow, uniform on every surface.
    const ambientLight = new THREE.AmbientLight(0xffffff, 0);
    const hemiLight = new THREE.HemisphereLight(0xaec8ff, 0x1b1612, 0.42);
    const keyLight = new THREE.DirectionalLight(0xfff1dc, 0.72);
    keyLight.position.set(6, 12, 8);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -10;
      keyLight.shadow.camera.right = 10;
      keyLight.shadow.camera.top = 10;
      keyLight.shadow.camera.bottom = -10;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    const rimLight = new THREE.DirectionalLight(0x7ca2ff, 0.32);
    rimLight.position.set(-7, 8, -9);
    liveRigGroup.add(ambientLight, hemiLight, keyLight, rimLight);
    scene.add(liveRigGroup);

    const initW = Math.max(mount.clientWidth, 100);
    const initH = Math.max(mount.clientHeight, 100);

    const orthoCam = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 400);
    const perspCam = new THREE.PerspectiveCamera(settingsRef.current.fov, initW / initH, 0.1, 300);

    const basis = getDefaultCameraBasis(settingsRef.current.projection);
    const target = basis.target.clone();
    const camOffset = basis.offset.clone();
    const zoom = 1;

    const initBaseMode = resolveViewportBaseMode(settingsRef.current);
    const gridGroup = buildCadGrid(
      settingsRef.current.gridWidth,
      settingsRef.current.gridHeight,
      initBaseMode,
    );
    gridGroup.visible = shouldShowGrid(settingsRef.current, initBaseMode);
    scene.add(gridGroup);

    const objectsGroup = new THREE.Group();
    scene.add(objectsGroup);

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      gl.flush();
      const poll = () => {
        if (disposed) {
          gl.deleteSync(sync);
          return;
        }
        const status = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const syncCamerasAndOverlays = () => {
      const st = threeRef.current;
      if (!st) return;
      const s = settingsRef.current;
      const isPersp = s.projection === 'Perspective';
      const cam = isPersp ? st.perspCam : st.orthoCam;
      st.activeCam = cam;

      if (isPersp) {
        st.perspCam.fov = s.fov;
        st.perspCam.aspect = st.width / Math.max(st.height, 1);
        const perspDist = st.camOffset.length() / Math.max(st.zoom, MIN_ZOOM);
        const scaledOffset = st.camOffset.clone().divideScalar(Math.max(st.zoom, MIN_ZOOM));
        st.perspCam.position.copy(st.target).add(scaledOffset);
        st.perspCam.lookAt(st.target);
        // Keep clipping usable across the full, effectively unlimited zoom range.
        st.perspCam.near = Math.max(0.01, perspDist * 0.001);
        st.perspCam.far = Math.max(1000, perspDist * 100);
        st.perspCam.updateProjectionMatrix();
      } else {
        const halfW = st.width / (2 * PIXELS_PER_METER * st.zoom);
        const halfH = st.height / (2 * PIXELS_PER_METER * st.zoom);
        st.orthoCam.left = -halfW;
        st.orthoCam.right = halfW;
        st.orthoCam.top = halfH;
        st.orthoCam.bottom = -halfH;
        st.orthoCam.position.copy(st.target).add(st.camOffset);
        st.orthoCam.lookAt(st.target);
        st.orthoCam.updateProjectionMatrix();
      }
      cam.updateMatrixWorld(true);

      // The shader ray-casts every pixel onto the floor, so the grid itself has
      // no finite border. These extents only size the edge-on cross-line.
      let viewHalfW = st.width / (2 * PIXELS_PER_METER * Math.max(st.zoom, MIN_ZOOM));
      let viewHalfH = st.height / (2 * PIXELS_PER_METER * Math.max(st.zoom, MIN_ZOOM));
      if (isPersp) {
        const dist = st.camOffset.length() / Math.max(st.zoom, MIN_ZOOM);
        viewHalfH = Math.tan(THREE.MathUtils.degToRad(s.fov) / 2) * dist;
        viewHalfW = viewHalfH * (st.width / Math.max(st.height, 1));
      }
      const gridHalf = Math.max(viewHalfW, viewHalfH) * 3 + 4;
      const gridEdge = st.gridGroup.children.find(
        (child) => child.name === 'FloorGridEdge',
      ) as THREE.LineSegments | undefined;
      if (gridEdge) gridEdge.scale.setScalar(gridHalf);

      const gridMesh = st.gridGroup.children[0] as THREE.Mesh | undefined;
      const gridUniforms = gridMesh
        ? (gridMesh.material as THREE.ShaderMaterial).uniforms
        : undefined;
      if (gridUniforms) {
        const e = cam.matrixWorld.elements;
        _gridRight.set(e[0], e[1], e[2]).normalize();
        _gridUp.set(e[4], e[5], e[6]).normalize();
        _gridForward.set(-e[8], -e[9], -e[10]).normalize();
        gridUniforms.uIsPerspective.value = isPersp ? 1 : 0;
        gridUniforms.uCameraPos.value.copy(cam.position);
        gridUniforms.uCamRight.value.copy(_gridRight);
        gridUniforms.uCamUp.value.copy(_gridUp);
        gridUniforms.uCamForward.value.copy(_gridForward);
        gridUniforms.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(s.fov) / 2);
        gridUniforms.uAspect.value = st.width / Math.max(st.height, 1);
        gridUniforms.uOrthoHalf.value.set(
          (st.orthoCam.right - st.orthoCam.left) / 2,
          (st.orthoCam.top - st.orthoCam.bottom) / 2,
        );
      }

      // The full-screen quad ignores group transforms; the group only anchors
      // the edge-on cross-line to the camera target on the floor.
      st.gridGroup.quaternion.identity();
      const t = st.target;
      st.gridGroup.position.set(t.x, 0, t.z);

      // Sync 3D ViewCube orientation & view direction
      const nextMatrix = computeCubeMatrix3d(cam.quaternion);
      _v1.copy(st.camOffset).normalize();
      const nextDir: [number, number, number] = [_v1.x, _v1.y, _v1.z];
      setCubeState((prev) =>
        prev.matrix3d === nextMatrix ? prev : { matrix3d: nextMatrix, viewDir: nextDir },
      );

      const effBaseMode = resolveViewportBaseMode(s);

      // The floor grid is always visible in every view. In exact side views
      // the plane is edge-on, so the cross-line keeps its floor level readable.
      st.gridGroup.visible = shouldShowGrid(s, effBaseMode);
      if (gridEdge) {
        const floorDot = Math.abs(st.camOffset.y) / Math.max(st.camOffset.length(), 1e-9);
        gridEdge.visible = st.gridGroup.visible && floorDot < 0.25;
      }

      // Update Alpha center origin marker screen position (hidden in Live mode)
      if (s.id === 'alpha' && s.showWidgets && effBaseMode !== 'live') {
        _v1.set(0, 0, 0).project(cam);
        const visible = _v1.z >= -1 && _v1.z <= 1;
        setOriginScreenPos({
          x: ((_v1.x + 1) / 2) * st.width,
          y: ((-_v1.y + 1) / 2) * st.height,
          visible,
        });
      } else {
        setOriginScreenPos((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      }

      // Update Fixture Information labels if enabled
      if (s.showFixtureInfo) {
        const labels: Array<{
          id: string;
          text: string;
          x: number;
          y: number;
          selected: boolean;
          layerColor?: string;
        }> = [];
        const selSet = new Set(selectedIdsRef.current);
        const layerMap = new Map(layersRef.current.map((l) => [l.id, l]));
        for (const obj of objectsRef.current) {
          if (obj.kind !== 'moving-head' && obj.kind !== 'led-par' && obj.kind !== 'gdtf-fixture') continue;
          const layer = obj.layerId ? layerMap.get(obj.layerId) : undefined;
          if (layer && !layer.visible) continue;
          if (
            s.renderMode === 'custom' &&
            s.customIsolatedLayerId &&
            s.customIsolatedLayerId !== 'all' &&
            obj.layerId !== s.customIsolatedLayerId
          ) {
            continue;
          }
          if (obj.hidden && !s.showHiddenObjects) continue;
          _v1.set(obj.position[0], obj.position[1], obj.position[2]).project(cam);
          if (_v1.z >= -1 && _v1.z <= 1) {
            labels.push({
              id: obj.id,
              text: `${obj.channel ?? ''} · ${obj.dmxUniverse ?? 1}.${String(obj.dmxAddress ?? 1).padStart(3, '0')}`,
              x: ((_v1.x + 1) / 2) * st.width,
              y: ((-_v1.y + 1) / 2) * st.height,
              selected: selSet.has(obj.id),
              layerColor: layer?.color,
            });
          }
        }
        setFixtureLabels(labels);
      } else {
        setFixtureLabels((prev) => (prev.length > 0 ? [] : prev));
      }

      // Update projected Lens Effects (Bloom & Anamorphic Flare nodes) in Live mode
      if (effBaseMode === 'live' && (s.bloom > 0 || s.flare > 0)) {
        const nodes: Array<{ id: string; x: number; y: number; color: string; intensity: number }> = [];
        for (const obj of objectsRef.current) {
          if (obj.kind !== 'moving-head' && obj.kind !== 'led-par' && obj.kind !== 'gdtf-fixture') continue;
          if (obj.hidden && !s.showHiddenObjects) continue;
          const intensity = obj.intensity ?? 0;
          if (intensity <= 0.05) continue;
          const yOffset = obj.kind === 'led-par' ? -0.18 : -0.34;
          _v1.set(obj.position[0], obj.position[1] + yOffset, obj.position[2]).project(cam);
          if (_v1.z >= -1 && _v1.z <= 1) {
            nodes.push({
              id: obj.id,
              x: ((_v1.x + 1) / 2) * st.width,
              y: ((-_v1.y + 1) / 2) * st.height,
              color: obj.color ?? '#ffffff',
              intensity,
            });
          }
        }
        setLensNodes(nodes);
      } else {
        setLensNodes((prev) => (prev.length > 0 ? [] : prev));
      }
    };

    const requestRender = () => {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        if (disposed) return;
        renderDirty = false;
        const st = threeRef.current;
        if (st) {
          let animNeedsMore = false;
          if (st.snapAnim.active) {
            const dt = Math.min(0.05, Math.max(0.001, (now - st.snapAnim.lastTime) / 1000));
            st.snapAnim.lastTime = now;
            const alpha = 1 - Math.exp(-16 * dt);

            // Smooth spherical direction slerp + radius damp
            const currLen = st.camOffset.length() || 1;
            const goalLen = st.snapAnim.goalOffset.length() || 1;
            _v1.copy(st.camOffset).divideScalar(currLen);
            _v2.copy(st.snapAnim.goalOffset).divideScalar(goalLen);
            const dot = THREE.MathUtils.clamp(_v1.dot(_v2), -1, 1);

            if (dot > 0.9999 && Math.abs(currLen - goalLen) < 0.01) {
              st.camOffset.copy(st.snapAnim.goalOffset);
              if (st.snapAnim.goalTarget) {
                st.target.copy(st.snapAnim.goalTarget);
              }
              st.snapAnim.active = false;
            } else {
              // Handle antipodal 180-deg flip smoothly by nudging perpendicular axis
              if (dot < -0.999) {
                _v1.x += 0.01;
                _v1.normalize();
              }
              _v1.lerp(_v2, alpha).normalize();
              const nextLen = THREE.MathUtils.lerp(currLen, goalLen, alpha);
              st.camOffset.copy(_v1).multiplyScalar(nextLen);
              if (st.snapAnim.goalTarget) {
                st.target.lerp(st.snapAnim.goalTarget, alpha);
              }
              animNeedsMore = true;
            }
          }

          syncCamerasAndOverlays();
          renderer.render(scene, st.activeCam);

          const done = () => {
            renderBusy = false;
            if ((renderDirty || animNeedsMore) && !disposed) requestRender();
          };
          if (isSoftwareGl) afterDraw(done);
          else done();
          return;
        }
        renderBusy = false;
      });
    };

    threeRef.current = {
      renderer,
      scene,
      orthoCam,
      perspCam,
      activeCam: settingsRef.current.projection === 'Perspective' ? perspCam : orthoCam,
      target,
      camOffset,
      zoom,
      gridGroup,
      objectsGroup,
      gizmoGroup: null,
      ghostGroup: null,
      snapGroup: null,
      gdtfRigMap: new Map<string, GdtfRigHandle>(),
      smokeRigMap: new Map<string, LiveSmokeHandle>(),
      smokeDriftPhase: 0,
      liveRigGroup,
      ambientLight,
      hemiLight,
      keyLight,
      rimLight,
      envTexture,
      isSoftwareGl,
      requestRender,
      width: initW,
      height: initH,
      spaceDown: false,
      snapAnim: {
        active: false,
        goalOffset: new THREE.Vector3(),
        goalTarget: null,
        lastTime: 0,
      },
    };

    const handleResize = () => {
      if (!mount || !threeRef.current) return;
      const w = Math.max(mount.clientWidth, 1);
      const h = Math.max(mount.clientHeight, 1);
      threeRef.current.width = w;
      threeRef.current.height = h;
      setVpSize({ w, h });
      renderer.setSize(w, h, false);
      requestRender();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(mount);
    handleResize();

    const abortActiveTransform = () => {
      const ps = pointerStateRef.current;
      const currSt = threeRef.current;
      if (ps.mode === 'gizmo-drag' || ps.mode === 'select-or-drag') {
        if (ps.moved && ps.draggedItems.length > 0) {
          onMoveRef.current(
            ps.draggedItems.map((item) => ({
              id: item.id,
              position: [...item.startPos] as [number, number, number],
            })),
          );
        }
        ps.mode = 'none';
        ps.moved = false;
        ps.draggedItems = [];
        ps.dragStartWorld = null;
        ps.gizmoAxis = null;
        ps.gizmoOrigin = null;
        activeGizmoAxisRef.current = null;
        setDragDeltaHud(null);
        onTransformGhostChangeRef.current?.(null);
        if (currSt?.ghostGroup) {
          currSt.scene.remove(currSt.ghostGroup);
          disposeGroupResources(currSt.ghostGroup);
          currSt.ghostGroup = null;
        }
        clearSnapIndicator(currSt);
        currSt?.requestRender();
      } else if (ps.mode === 'marquee') {
        ps.mode = 'none';
        ps.moved = false;
        setMarqueeRect(null);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && threeRef.current) {
        threeRef.current.spaceDown = true;
      } else if (e.key === 'Escape') {
        abortActiveTransform();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && threeRef.current) {
        threeRef.current.spaceDown = false;
      }
    };
    const onWindowBlur = () => {
      if (threeRef.current) threeRef.current.spaceDown = false;
      const ps = pointerStateRef.current;
      if (ps.mode === 'gizmo-drag' || ps.mode === 'select-or-drag' || ps.mode === 'marquee') {
        ps.mode = 'none';
        activeGizmoAxisRef.current = null;
        setDragDeltaHud(null);
        setMarqueeRect(null);
        onTransformGhostChangeRef.current?.(null);
        clearSnapIndicator(threeRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      disposeGroupResources(scene);
      envTexture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      threeRef.current = null;
    };
  }, []);

  // Rebuild only when the metric spacing or render style changes; the floor
  // plane itself stays identical in every projection.
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;
    const effectiveMode = resolveViewportBaseMode(settings);
    st.scene.remove(st.gridGroup);
    disposeGroupResources(st.gridGroup);
    st.gridGroup = buildCadGrid(
      settings.gridWidth,
      settings.gridHeight,
      effectiveMode,
    );
    st.gridGroup.visible = shouldShowGrid(settings, effectiveMode);
    st.scene.add(st.gridGroup);
    st.requestRender();
  }, [settings.gridWidth, settings.gridHeight, settings.renderMode, settings.customFaceStyle]);

  // Reset camera basis only when projection changes directly (unless driven by smooth ViewCube snap)
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;
    if (skipNextProjectionResetRef.current) {
      skipNextProjectionResetRef.current = false;
    } else {
      st.snapAnim.active = false;
      const basis = getDefaultCameraBasis(settings.projection);
      st.target.copy(basis.target);
      st.camOffset.copy(basis.offset);
      st.zoom = 1;
    }
    st.requestRender();
  }, [settings.projection]);

  // Toggle grid visibility without resetting camera (Top view only, hidden in Live)
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;
    const effectiveMode = resolveViewportBaseMode(settings);
    st.gridGroup.visible = shouldShowGrid(settings, effectiveMode);
    st.requestRender();
  }, [settings.showGrid, settings.renderMode, settings.customFaceStyle, settings.projection]);

  // Update Camera FOV, Environment Lights, White Balance & Exposure
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;

    const [wr, wg, wb] = kelvinToRgb(settings.whiteBalance);
    const ambientAmount = settings.ambientLighting / 100;
    st.keyLight.color.setRGB(wr, wg, wb);
    // Ambient Light = white, source-less fill that lifts every surface evenly.
    st.ambientLight.color.set(settings.ambientLightingColor);
    st.ambientLight.intensity = ambientAmount * 2.6;
    // RoomEnvironment is already a source-less PBR fill; tie it to the same slider
    // so the change is visible on metallic and non-metallic surfaces alike.
    st.scene.environmentIntensity =
      resolveViewportBaseMode(settings) === 'live' ? 0.35 + ambientAmount * 1.3 : 1;
    // Keep a subtle sky/ground gradient for depth.
    st.hemiLight.color.set(settings.ambientLightingColor);
    st.hemiLight.intensity = ambientAmount * 0.45;
    st.rimLight.intensity = (settings.fillLighting / 100) * 1.1;

    let exposure = 1.05;
    if (settings.autoExposure) {
      const fxList = objects.filter(
        (o) => (o.kind === 'moving-head' || o.kind === 'led-par') && !o.hidden,
      );
      const avgInt =
        fxList.length > 0
          ? fxList.reduce((sum, f) => sum + (f.intensity ?? 0), 0) / fxList.length
          : 0.5;
      exposure = THREE.MathUtils.clamp(1.38 - avgInt * 0.52, 0.65, 1.55);
    }
    exposure *= Math.pow(2, settings.exposureAdjustment * 0.35);
    st.renderer.toneMappingExposure = exposure;

    st.requestRender();
  }, [
    objects,
    settings.fov,
    settings.whiteBalance,
    settings.autoExposure,
    settings.exposureAdjustment,
    settings.ambientLighting,
    settings.ambientLightingColor,
    settings.fillLighting,
    settings.bloom,
    settings.flare,
  ]);

  // Laser Flicker Effect modulation timer (only active in Live mode when enabled)
  useEffect(() => {
    if (!settings.laserFlicker || (settings.renderMode !== 'live' && settings.renderMode !== 'custom')) {
      setFlickerGain(1);
      return;
    }
    const intervalMs = threeRef.current?.isSoftwareGl ? 90 : 55;
    const id = window.setInterval(() => {
      setFlickerGain(0.74 + Math.random() * 0.34);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [settings.laserFlicker, settings.renderMode]);

  // Rebuild 3D objects & lighting rig whenever scene objects, layers, selection, or render mode changes
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;

    const effectiveMode = resolveViewportBaseMode(settings);
    const isLive = effectiveMode === 'live';
    const isPlot = effectiveMode === 'plot';
    const layerMap = new Map(layers.map((l) => [l.id, l]));
    const layerVisibleMap = new Map(layers.map((l) => [l.id, l.visible]));
    const smokeAtmosphere = isLive
      ? computeLiveSmokeAtmosphere(
          objects,
          layerVisibleMap,
          settings.showHiddenObjects,
          dmxUniversesRef.current,
        )
      : {
          hasSmoke: false,
          fogDensity: 0.012,
          beamBoost: 1.0,
          legacyActive: false,
          maxSpeedPct: 0,
          scatterColor: new THREE.Color(0x9ec5dc),
        };

    st.liveRigGroup.visible = isLive;
    st.scene.background = new THREE.Color(
      isPlot ? PLOT_PAPER_WHITE : isLive ? 0x04060b : 0x000000,
    );
    st.scene.environment = isLive ? st.envTexture : null;
    st.renderer.toneMapping = isLive ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    st.scene.fog =
      isLive && smokeAtmosphere.hasSmoke
        ? new THREE.FogExp2(0x04060b, smokeAtmosphere.fogDensity)
        : null;

    disposeGroupResources(st.objectsGroup);
    st.objectsGroup.clear();
    st.gdtfRigMap.clear();
    st.smokeRigMap.clear();

    const selectedSet = new Set(selectedObjectIds);
    const profileMap = new Map(gdtfProfiles.map((p) => [p.id, p]));

    for (const obj of objects) {
      const layer = obj.layerId ? layerMap.get(obj.layerId) : undefined;
      if (layer && !layer.visible) continue;
      if (
        settings.renderMode === 'custom' &&
        settings.customIsolatedLayerId &&
        settings.customIsolatedLayerId !== 'all' &&
        obj.layerId !== settings.customIsolatedLayerId
      ) {
        continue;
      }
      if (obj.hidden && !settings.showHiddenObjects) continue;
      const isSelected =
        obj.kind === 'smoke-volume'
          ? selectedSet.has(obj.id)
          : settings.showSelectionNavigator && selectedSet.has(obj.id);
      const styleOpts = buildObjectStyleOpts(settings, layer, effectiveMode);

      if (obj.kind === 'gdtf-fixture' && obj.gdtfProfileId) {
        const profile = profileMap.get(obj.gdtfProfileId);
        if (profile) {
          const buf = dmxUniversesRef.current[obj.dmxUniverse ?? 1] ?? new Uint8Array(512);
          const resolved = resolveGdtfDmxState(profile, obj.gdtfModeName, buf, obj.dmxAddress ?? 1, {
            dimmer: obj.shutter === false ? 0 : obj.intensity,
            panDeg: obj.pan,
            tiltDeg: obj.tilt,
            colorHex: obj.color,
            beamAngleDeg: obj.beamAngle,
          });
          const rig = assembleGdtfRuntimeGroup(
            obj,
            profile,
            styleOpts,
            isSelected,
            resolved,
            st.isSoftwareGl,
            () => st.requestRender(),
          );
          st.gdtfRigMap.set(obj.id, rig);
          st.objectsGroup.add(rig.root);
          continue;
        }
      }

      if (obj.kind === 'skp-model') {
        const skpGroup = buildSkpSceneObjectGroup(obj, styleOpts, isSelected);
        st.objectsGroup.add(skpGroup);
        continue;
      }

      const group = buildSceneObjectGroup(
        obj,
        styleOpts,
        isSelected,
        st.isSoftwareGl,
        isLive ? smokeAtmosphere.beamBoost : 1.0,
      );
      st.objectsGroup.add(group);

      // Volumetric Smoke particle simulation is mounted exclusively in Live mode
      if (obj.kind === 'smoke-volume' && isLive) {
        const smokeRig = createLiveSmokeRig(
          obj,
          dmxUniversesRef.current,
          smokeAtmosphere.scatterColor,
          st.isSoftwareGl,
        );
        updateLiveSmokeRig(
          smokeRig,
          obj,
          dmxUniversesRef.current,
          smokeAtmosphere.scatterColor,
          st.smokeDriftPhase,
        );
        st.smokeRigMap.set(obj.id, smokeRig);
        st.objectsGroup.add(smokeRig.root);
      }
    }

    st.requestRender();
  }, [
    objects,
    layers,
    selectedObjectIds,
    gdtfProfiles,
    settings.renderMode,
    settings.customFaceStyle,
    settings.customWireframeOverlay,
    settings.customIsolatedLayerId,
    settings.showHiddenObjects,
    settings.showSelectionNavigator,
    settings.showFixtureInfo,
    settings.showWidgets,
  ]);

  // Selection Navigator highlights selected objects; the XYZ translation gizmo arrows
  // are intentionally not mounted in the viewport.
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;

    if (st.gizmoGroup) {
      st.scene.remove(st.gizmoGroup);
      disposeGroupResources(st.gizmoGroup);
      st.gizmoGroup = null;
    }
    st.requestRender();
  }, []);

  // Render transient source-position ghost outline while objects are being dragged, and clear immediately on drop/ESC
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;

    if (st.ghostGroup) {
      st.scene.remove(st.ghostGroup);
      disposeGroupResources(st.ghostGroup);
      st.ghostGroup = null;
    }

    if (transformGhostItems && transformGhostItems.length > 0) {
      const ghost = buildMoveGhostGroup(transformGhostItems);
      st.scene.add(ghost);
      st.ghostGroup = ghost;
    }
    st.requestRender();
  }, [transformGhostItems]);

  // Zero-rebuild real-time DMX stream update for mounted GDTF fixtures & Patched Smoke Volumes
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;
    if (st.gdtfRigMap.size === 0 && st.smokeRigMap.size === 0) return;

    const profileMap = new Map(gdtfProfiles.map((p) => [p.id, p]));
    const layerMap = new Map(layers.map((l) => [l.id, l]));
    const selectedSet = new Set(selectedObjectIds);
    const nowSec = performance.now() / 1000;
    const effectiveMode = resolveViewportBaseMode(settings);

    for (const obj of objects) {
      if (obj.kind !== 'gdtf-fixture' || !obj.gdtfProfileId) continue;
      const rig = st.gdtfRigMap.get(obj.id);
      const profile = profileMap.get(obj.gdtfProfileId);
      if (!rig || !profile) continue;

      const buf = dmxUniverses[obj.dmxUniverse ?? 1] ?? new Uint8Array(512);
      const resolved = resolveGdtfDmxState(profile, obj.gdtfModeName, buf, obj.dmxAddress ?? 1, {
        dimmer: obj.shutter === false ? 0 : obj.intensity,
        panDeg: obj.pan,
        tiltDeg: obj.tilt,
        colorHex: obj.color,
        beamAngleDeg: obj.beamAngle,
      });
      const layer = obj.layerId ? layerMap.get(obj.layerId) : undefined;
      const styleOpts = buildObjectStyleOpts(settings, layer, effectiveMode);
      applyDmxToGdtfRig(
        rig,
        resolved,
        styleOpts,
        settings.showSelectionNavigator && selectedSet.has(obj.id),
        () => st.requestRender(),
        nowSec,
      );
    }

    if (effectiveMode === 'live' && st.smokeRigMap.size > 0) {
      const layerVisibleMap = new Map(layers.map((l) => [l.id, l.visible]));
      const smokeAtmosphere = computeLiveSmokeAtmosphere(
        objects,
        layerVisibleMap,
        settings.showHiddenObjects,
        dmxUniverses,
      );
      if (st.scene.fog instanceof THREE.FogExp2) {
        st.scene.fog.density = smokeAtmosphere.fogDensity;
      }
      for (const obj of objects) {
        if (obj.kind !== 'smoke-volume') continue;
        const smokeRig = st.smokeRigMap.get(obj.id);
        if (!smokeRig) continue;
        updateLiveSmokeRig(
          smokeRig,
          obj,
          dmxUniverses,
          smokeAtmosphere.scatterColor,
          st.smokeDriftPhase,
        );
      }
    }

    st.requestRender();
  }, [
    dmxUniverses,
    objects,
    layers,
    gdtfProfiles,
    selectedObjectIds,
    settings.renderMode,
    settings.customFaceStyle,
    settings.customWireframeOverlay,
    settings.showHiddenObjects,
    settings.showSelectionNavigator,
  ]);

  // Continuous paced particle drift loop exclusively in Live mode when Smoke Speed > 0%
  useEffect(() => {
    const st = threeRef.current;
    if (!st || resolveViewportBaseMode(settings) !== 'live') return;

    const layerVisibleMap = new Map(layers.map((l) => [l.id, l.visible]));
    const activeSmokes = objects.filter((o) => {
      if (o.kind !== 'smoke-volume') return false;
      if (o.layerId && layerVisibleMap.get(o.layerId) === false) return false;
      if (o.hidden && !settings.showHiddenObjects) return false;
      const resolved = resolveSmokeParameters(o, dmxUniversesRef.current);
      return resolved.speedPct > 0;
    });
    const activeEffects = objects.filter((o) => {
      if (o.kind !== 'co2-jet' && o.kind !== 'flame-jet') return false;
      if (o.layerId && layerVisibleMap.get(o.layerId) === false) return false;
      if (o.hidden && !settings.showHiddenObjects) return false;
      return true;
    });

    if (activeSmokes.length === 0 && activeEffects.length === 0) return;

    let cancelled = false;
    let timerId = 0;
    let lastTime = performance.now();

    const stepSmoke = () => {
      if (cancelled || !threeRef.current) return;
      const currSt = threeRef.current;
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const atmo = computeLiveSmokeAtmosphere(
        objectsRef.current,
        layerVisibleMap,
        settingsRef.current.showHiddenObjects,
        dmxUniversesRef.current,
      );
      const speedFactor = Math.max(0.05, atmo.maxSpeedPct / 100);
      currSt.smokeDriftPhase += dt * speedFactor;

      for (const obj of objectsRef.current) {
        if (obj.kind !== 'smoke-volume') continue;
        const rig = currSt.smokeRigMap.get(obj.id);
        if (!rig) continue;
        updateLiveSmokeRig(
          rig,
          obj,
          dmxUniversesRef.current,
          atmo.scatterColor,
          currSt.smokeDriftPhase,
        );
      }

      for (const child of currSt.objectsGroup.children) {
        const update = child.userData.effectJetUpdate as
          | ((phase: number, level: number) => void)
          | undefined;
        if (!update) continue;
        const obj = objectsRef.current.find((o) => o.id === child.userData.objectId);
        if (!obj) continue;
        const buffer = dmxUniversesRef.current[obj.dmxUniverse ?? 1];
        const dmxLevel =
          buffer && obj.dmxAddress ? (buffer[obj.dmxAddress - 1] ?? 0) / 255 : undefined;
        const shutter = obj.shutter === false ? 0 : 1;
        update(
          currSt.smokeDriftPhase,
          shutter * (dmxLevel ?? obj.intensity ?? 1) * (obj.intensity ?? 1),
        );
      }

      currSt.requestRender();

      if (currSt.isSoftwareGl) {
        timerId = window.setTimeout(stepSmoke, 85);
      } else {
        timerId = requestAnimationFrame(stepSmoke);
      }
    };

    if (st.isSoftwareGl) {
      timerId = window.setTimeout(stepSmoke, 85);
    } else {
      timerId = requestAnimationFrame(stepSmoke);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(timerId);
      clearTimeout(timerId);
    };
  }, [objects, layers, settings.renderMode, settings.showHiddenObjects, dmxUniverses]);

  // Respond to external CameraPreset recall commands
  useEffect(() => {
    const st = threeRef.current;
    if (!st || !cameraCommand?.preset) return;
    if (cameraCommand.targetViewportId && cameraCommand.targetViewportId !== settings.id) return;
    const p = cameraCommand.preset;
    st.target.set(p.target[0], p.target[1], p.target[2]);
    st.camOffset.set(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2]);
    st.zoom = THREE.MathUtils.clamp(Number(p.zoom) || 1, MIN_ZOOM, MAX_ZOOM);
    st.requestRender();
  }, [cameraCommand, settings.id]);

  // Helper: Pan camera in screen space
  const panByPixels = useCallback((dx: number, dy: number) => {
    const st = threeRef.current;
    if (!st) return;
    st.snapAnim.active = false;
    const cam = st.activeCam;
    cam.updateMatrixWorld(true);
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    _up.setFromMatrixColumn(cam.matrixWorld, 1);

    let worldPerPixel: number;
    if (settingsRef.current.projection === 'Perspective') {
      const dist = st.camOffset.length() / st.zoom;
      worldPerPixel = (2 * dist * Math.tan(THREE.MathUtils.degToRad(22.5))) / Math.max(st.height, 1);
    } else {
      worldPerPixel = 1 / (PIXELS_PER_METER * st.zoom);
    }

    _v1.copy(_right).multiplyScalar(-dx * worldPerPixel);
    _v2.copy(_up).multiplyScalar(dy * worldPerPixel);
    st.target.add(_v1).add(_v2);
    st.requestRender();
  }, []);

  // Helper: Orbit 360 degrees (automatically unlocks into Perspective when rotated off an ortho axis)
  const orbitByPixels = useCallback(
    (dx: number, dy: number) => {
      const st = threeRef.current;
      if (!st) return;
      st.snapAnim.active = false;
      _spherical.setFromVector3(st.camOffset);
      _spherical.theta -= dx * 0.008;
      _spherical.phi = THREE.MathUtils.clamp(_spherical.phi - dy * 0.008, 0.001, Math.PI - 0.001);
      st.camOffset.setFromSpherical(_spherical);

      const s = settingsRef.current;
      if (s.projection !== 'Perspective' && !isCameraAlignedToOrthoGridView(s.projection, st.camOffset)) {
        skipNextProjectionResetRef.current = true;
        onUpdateSettings(s.id, { projection: 'Perspective' });
      }
      st.requestRender();
    },
    [onUpdateSettings],
  );

  // Snap smoothly to exact Front, Top, Left, or Right projection when orbit stops near an orthogonal axis
  const snapOrbitToOrthogonalIfClose = useCallback(() => {
    const st = threeRef.current;
    if (!st) return;
    const nearest = findNearestOrthoSnap(st.camOffset, 9.0);
    if (!nearest) return;

    const basis = getDefaultCameraBasis(nearest);
    const goalOffset = basis.offset.clone();
    // Preserve current zoom scale cleanly when snapping back into orthogonal drafting
    st.snapAnim = {
      active: true,
      goalOffset,
      goalTarget: null, // keep user's panned target
      lastTime: performance.now(),
    };
    if (settingsRef.current.projection !== nearest) {
      skipNextProjectionResetRef.current = true;
      onUpdateSettings(settingsRef.current.id, { projection: nearest });
    }
    st.requestRender();
  }, [onUpdateSettings]);

  // Helper: Smoothly animate & snap camera to ViewCube face/edge/corner
  const handleViewCubeSnap = useCallback(
    (snap: ViewCubeSnapTarget) => {
      const st = threeRef.current;
      if (!st) return;

      const isOrthoFace = snap.projection !== 'Perspective';
      const dist = isOrthoFace ? 26 : 15.5;
      const goalOffset = new THREE.Vector3(
        snap.direction[0] * dist,
        snap.direction[1] * dist,
        snap.direction[2] * dist,
      );
      // Avoid exact gimbal singularity on Top/Bottom
      if (snap.projection === 'Top') {
        goalOffset.z = 0.002;
      } else if (snap.projection === 'Bottom') {
        goalOffset.z = -0.002;
      }

      st.snapAnim = {
        active: true,
        goalOffset,
        goalTarget: isOrthoFace ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(0, 1.4, -0.5),
        lastTime: performance.now(),
      };
      if (!isOrthoFace) {
        st.zoom = 1;
      }

      if (settingsRef.current.projection !== snap.projection) {
        skipNextProjectionResetRef.current = true;
        onUpdateSettings(settingsRef.current.id, { projection: snap.projection });
      }
      st.requestRender();
    },
    [onUpdateSettings],
  );

  // Helper: Zoom centered on a canvas pixel coordinate
  const zoomAtPoint = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const st = threeRef.current;
    const mount = canvasMountRef.current;
    if (!st || !mount) return;

    const newZoom = THREE.MathUtils.clamp(st.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(newZoom - st.zoom) < Math.max(1e-12, st.zoom * 1e-9)) return;

    if (
      clientX !== undefined &&
      clientY !== undefined &&
      settingsRef.current.projection !== 'Perspective'
    ) {
      const rect = mount.getBoundingClientRect();
      const offsetX = clientX - rect.left - rect.width / 2;
      const offsetY = -(clientY - rect.top - rect.height / 2);

      st.activeCam.updateMatrixWorld(true);
      _right.setFromMatrixColumn(st.activeCam.matrixWorld, 0);
      _up.setFromMatrixColumn(st.activeCam.matrixWorld, 1);

      const scaleDiff = 1 / (PIXELS_PER_METER * st.zoom) - 1 / (PIXELS_PER_METER * newZoom);
      _v1.copy(_right).multiplyScalar(offsetX * scaleDiff);
      _v2.copy(_up).multiplyScalar(offsetY * scaleDiff);
      st.target.add(_v1).add(_v2);
    }

    st.zoom = newZoom;
    st.requestRender();
  }, []);

  // World point on active CAD plane from client coordinates
  const screenToActivePlane = useCallback((clientX: number, clientY: number, planePoint?: THREE.Vector3): THREE.Vector3 | null => {
    const st = threeRef.current;
    const mount = canvasMountRef.current;
    if (!st || !mount) return null;
    const rect = mount.getBoundingClientRect();
    _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_ndc, st.activeCam);

    st.activeCam.getWorldDirection(_v3);
    const anchor = planePoint ?? _v2.set(0, 0, 0);
    _plane.setFromNormalAndCoplanarPoint(_v3, anchor);
    const out = new THREE.Vector3();
    const hit = _raycaster.ray.intersectPlane(_plane, out);
    return hit ? out : null;
  }, []);

  const sampleGizmoWorldPoint = useCallback(
    (clientX: number, clientY: number, origin: THREE.Vector3, axis: GizmoAxis): THREE.Vector3 | null => {
      const st = threeRef.current;
      const mount = canvasMountRef.current;
      if (!st || !mount) return null;
      const rect = mount.getBoundingClientRect();
      _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_ndc, st.activeCam);
      if (axis === 'x' || axis === 'y' || axis === 'z') {
        return intersectRayWithAxis(_raycaster.ray, origin, axis);
      }
      return intersectRayWithConstraintPlane(_raycaster.ray, origin, axis);
    },
    [],
  );

  // Canvas pointer interaction (Gizmo Axis Drag, Marquee Drag-Box, Multi-Select Cmd/Ctrl+Click, Move, Pan, Orbit)
  const pointerStateRef = useRef<{
    mode: 'none' | 'pan' | 'orbit' | 'select-or-drag' | 'gizmo-drag' | 'marquee';
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    hitObjectId: string | null;
    modifierMulti: boolean;
    gizmoAxis: GizmoAxis | null;
    gizmoOrigin: THREE.Vector3 | null;
    dragStartWorld: THREE.Vector3 | null;
    draggedItems: Array<{ id: string; startPos: [number, number, number] }>;
  }>({
    mode: 'none',
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    hitObjectId: null,
    modifierMulti: false,
    gizmoAxis: null,
    gizmoOrigin: null,
    dragStartWorld: null,
    draggedItems: [],
  });

  const resolveSnappedMove = useCallback(
    (
      draggedItems: Array<{ id: string; startPos: [number, number, number] }>,
      rawPositions: Array<[number, number, number]>,
    ): Array<[number, number, number]> => {
      const st = threeRef.current;
      const snap = findTrussSnap(
        draggedItems.map((item, i) => ({
          id: item.id,
          startPos: item.startPos,
          position: rawPositions[i] ?? item.startPos,
        })),
        objectsRef.current,
      );

      if (!snap || rawPositions.length === 0) {
        clearSnapIndicator(st);
        return rawPositions;
      }

      const anchorRaw = rawPositions[0];
      const shift: [number, number, number] = [
        snap.position[0] - anchorRaw[0],
        snap.position[1] - anchorRaw[1],
        snap.position[2] - anchorRaw[2],
      ];
      const positions = rawPositions.map(
        (p) =>
          [
            Number((p[0] + shift[0]).toFixed(2)),
            Number((p[1] + shift[1]).toFixed(2)),
            Number((p[2] + shift[2]).toFixed(2)),
          ] as [number, number, number],
      );
      // Keep the snapped anchor mathematically exact; only secondary objects are rounded.
      positions[0] = [snap.position[0], snap.position[1], snap.position[2]];

      const anchor = objectsRef.current.find((o) => o.id === draggedItems[0]?.id);
      if (
        anchor &&
        anchor.rotation.some((r, i) => Math.abs(r - snap.rotation[i]) > 1e-4)
      ) {
        onUpdateObjectsRef.current([anchor.id], { rotation: snap.rotation });
      }

      clearSnapIndicator(st);
      if (st) {
        st.snapGroup = buildSnapIndicator(snap.snapPoint, snap.draggedPoint);
        st.scene.add(st.snapGroup);
        st.requestRender();
      }
      return positions;
    },
    [],
  );

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setSettingsMenuOpen(false);

    const st = threeRef.current;
    const mount = canvasMountRef.current;
    if (!st || !mount) return;

    e.currentTarget.setPointerCapture(e.pointerId);

    const isOrbit = e.button === 2 || (e.button === 0 && e.altKey);
    const isPan = e.button === 1 || (e.button === 0 && st.spaceDown);

    if (isOrbit) {
      pointerStateRef.current = {
        mode: 'orbit',
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
        hitObjectId: null,
        modifierMulti: false,
        gizmoAxis: null,
        gizmoOrigin: null,
        dragStartWorld: null,
        draggedItems: [],
      };
      return;
    }

    if (isPan) {
      pointerStateRef.current = {
        mode: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
        hitObjectId: null,
        modifierMulti: false,
        gizmoAxis: null,
        gizmoOrigin: null,
        dragStartWorld: null,
        draggedItems: [],
      };
      return;
    }

    if (e.button === 0) {
      const rect = mount.getBoundingClientRect();
      _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_ndc, st.activeCam);

      const selectedSet = new Set(selectedIdsRef.current);
      const modifierMulti = e.metaKey || e.ctrlKey || e.shiftKey;

      // 1. Prioritize Translation Gizmo Axis / Planar Handle picking
      if (!modifierMulti && st.gizmoGroup) {
        const gizmoHits = _raycaster.intersectObjects(st.gizmoGroup.children, true);
        const axisHit = gizmoHits.find((h) => Boolean(h.object.userData.gizmoAxis));
        const gizmoAxis = axisHit?.object.userData.gizmoAxis as GizmoAxis | undefined;

        if (gizmoAxis) {
          const gizmoOrigin = st.gizmoGroup.position.clone();
          const dragStartWorld = sampleGizmoWorldPoint(e.clientX, e.clientY, gizmoOrigin, gizmoAxis);
          const draggedItems = objectsRef.current
            .filter((o) => selectedSet.has(o.id))
            .filter((o) => {
              const l = layersRef.current.find((ly) => ly.id === o.layerId);
              return !l || (!l.locked && l.visible);
            })
            .map((o) => ({ id: o.id, startPos: [...o.position] as [number, number, number] }));

          if (dragStartWorld && draggedItems.length > 0) {
            activeGizmoAxisRef.current = gizmoAxis;
            setHoveredGizmoAxis(gizmoAxis);
            setDragDeltaHud({
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
              modeLabel: `Move ${gizmoAxis.toUpperCase()}`,
              dx: 0,
              dy: 0,
              dz: 0,
              dist: 0,
              pos: [...draggedItems[0].startPos],
            });
            pointerStateRef.current = {
              mode: 'gizmo-drag',
              startX: e.clientX,
              startY: e.clientY,
              lastX: e.clientX,
              lastY: e.clientY,
              moved: false,
              hitObjectId: null,
              modifierMulti: false,
              gizmoAxis,
              gizmoOrigin,
              dragStartWorld,
              draggedItems,
            };
            return;
          }
        }
      }

      // 2. Raycast Scene Objects (trusses, fixtures, models, smoke)
      const rawHits = _raycaster.intersectObjects(st.objectsGroup.children, true);
      const hits = rawHits.filter(
        (h) => !h.object.userData.isVolumetricBeam && !h.object.userData.isSelectionHelper,
      );
      const hitId = hits.length > 0 ? (hits[0].object.userData.objectId as string | undefined) ?? null : null;
      const hitObj = hitId ? objectsRef.current.find((o) => o.id === hitId) : undefined;
      const layer = hitObj ? layersRef.current.find((l) => l.id === hitObj.layerId) : undefined;

      // Focus mode: clicking geometry aims the selected fixtures without changing the selection.
      // Clicking an unselected fixture still selects it, as in the Capture manual.
      if (focusModeRef.current && hits.length > 0) {
        const clickedFixture = hitObj && FIXTURE_KINDS.has(hitObj.kind);
        if (!clickedFixture || selectedSet.has(hitObj!.id)) {
          const target: [number, number, number] = [
            hits[0].point.x,
            hits[0].point.y,
            hits[0].point.z,
          ];
          for (const obj of objectsRef.current) {
            if (!selectedSet.has(obj.id) || !FIXTURE_KINDS.has(obj.kind)) continue;
            const solved = aimAt(obj, target);
            onUpdateObjects([obj.id], solved);
          }
          return;
        }
      }

      const isLiveView = resolveViewportBaseMode(settings) === 'live';
      // In Live view a drag that starts on a fixture is a rubber-band selection,
      // even when that fixture is already selected. Cmd/Ctrl+click still toggles.
      const isLiveFixtureDrag = Boolean(
        isLiveView && !modifierMulti && hitObj && FIXTURE_KINDS.has(hitObj.kind),
      );
      const keepDirectSelect = !isLiveFixtureDrag;

      if (hitObj && keepDirectSelect) {
        const canMove = Boolean(!modifierMulti && (!layer || !layer.locked) && selectedSet.has(hitObj.id));
        const dragStartWorld = canMove
          ? screenToActivePlane(
              e.clientX,
              e.clientY,
              new THREE.Vector3(hitObj.position[0], hitObj.position[1], hitObj.position[2]),
            )
          : null;

        const draggedItems = canMove
          ? objectsRef.current
              .filter((o) => selectedSet.has(o.id))
              .filter((o) => {
                const l = layersRef.current.find((ly) => ly.id === o.layerId);
                return !l || (!l.locked && l.visible);
              })
              .map((o) => ({ id: o.id, startPos: [...o.position] as [number, number, number] }))
          : [];

        pointerStateRef.current = {
          mode: 'select-or-drag',
          startX: e.clientX,
          startY: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
          hitObjectId: hitId,
          modifierMulti,
          gizmoAxis: null,
          gizmoOrigin: null,
          dragStartWorld,
          draggedItems,
        };
        return;
      }

      // 3. Empty space — or an unselected object in Live view — starts a marquee.
      // Keeping the hit id lets a clean click still select that object.
      pointerStateRef.current = {
        mode: 'marquee',
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
        hitObjectId: hitObj?.id ?? null,
        modifierMulti,
        gizmoAxis: null,
        gizmoOrigin: null,
        dragStartWorld: null,
        draggedItems: [],
      };
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ps = pointerStateRef.current;
    const st = threeRef.current;
    const mount = canvasMountRef.current;

    if (ps.mode === 'none') {
      if (st && mount && st.gizmoGroup) {
        const rect = mount.getBoundingClientRect();
        _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        _raycaster.setFromCamera(_ndc, st.activeCam);
        const gizmoHits = _raycaster.intersectObjects(st.gizmoGroup.children, true);
        const axisHit = gizmoHits.find((h) => Boolean(h.object.userData.gizmoAxis));
        const nextAxis = (axisHit?.object.userData.gizmoAxis as GizmoAxis | undefined) ?? null;
        setHoveredGizmoAxis((prev) => (prev === nextAxis ? prev : nextAxis));
      } else if (hoveredGizmoAxis !== null) {
        setHoveredGizmoAxis(null);
      }
      return;
    }

    const dx = e.clientX - ps.lastX;
    const dy = e.clientY - ps.lastY;
    if (Math.hypot(e.clientX - ps.startX, e.clientY - ps.startY) > 4) {
      ps.moved = true;
    }
    ps.lastX = e.clientX;
    ps.lastY = e.clientY;

    if (ps.mode === 'orbit') {
      orbitByPixels(dx, dy);
    } else if (ps.mode === 'pan') {
      panByPixels(dx, dy);
    } else if (
      ps.mode === 'gizmo-drag' &&
      ps.gizmoAxis &&
      ps.gizmoOrigin &&
      ps.dragStartWorld &&
      ps.draggedItems.length > 0 &&
      mount
    ) {
      const currWorld = sampleGizmoWorldPoint(e.clientX, e.clientY, ps.gizmoOrigin, ps.gizmoAxis);
      if (currWorld) {
        const rawDelta = currWorld.clone().sub(ps.dragStartWorld);
        const dX = Number(rawDelta.x.toFixed(2));
        const dY = Number(rawDelta.y.toFixed(2));
        const dZ = Number(rawDelta.z.toFixed(2));
        const anchorStart = ps.draggedItems[0].startPos;
        const rawPositions = ps.draggedItems.map(
          (item) =>
            [
              Number((item.startPos[0] + dX).toFixed(2)),
              Number((item.startPos[1] + dY).toFixed(2)),
              Number((item.startPos[2] + dZ).toFixed(2)),
            ] as [number, number, number],
        );
        const positions = resolveSnappedMove(ps.draggedItems, rawPositions);
        const anchorPos = positions[0] ?? anchorStart;
        onMoveRef.current(
          ps.draggedItems.map((item, i) => ({
            id: item.id,
            position: positions[i] ?? rawPositions[i],
          })),
        );
        if (onTransformGhostChangeRef.current) {
          const objMap = new Map(objectsRef.current.map((o) => [o.id, o]));
          const ghostPayload: TransformGhostItem[] = [];
          for (const [i, item] of ps.draggedItems.entries()) {
            const obj = objMap.get(item.id);
            if (!obj) continue;
            const metrics = computeGhostBoxMetrics(obj);
            ghostPayload.push({
              id: item.id,
              kind: obj.kind,
              startPos: [...item.startPos],
              currentPos: positions[i] ?? rawPositions[i],
              rotation: [...obj.rotation],
              ...metrics,
            });
          }
          onTransformGhostChangeRef.current(ghostPayload);
        }
        const rect = mount.getBoundingClientRect();
        setDragDeltaHud({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          modeLabel: `Move ${ps.gizmoAxis.toUpperCase()}`,
          dx: anchorPos[0] - anchorStart[0],
          dy: anchorPos[1] - anchorStart[1],
          dz: anchorPos[2] - anchorStart[2],
          dist: Math.hypot(
            anchorPos[0] - anchorStart[0],
            anchorPos[1] - anchorStart[1],
            anchorPos[2] - anchorStart[2],
          ),
          pos: anchorPos,
        });
      }
    } else if (
      ps.mode === 'select-or-drag' &&
      ps.moved &&
      ps.draggedItems.length > 0 &&
      ps.dragStartWorld &&
      mount
    ) {
      const anchorStart = ps.draggedItems[0].startPos;
      const currWorld = screenToActivePlane(
        e.clientX,
        e.clientY,
        new THREE.Vector3(anchorStart[0], anchorStart[1], anchorStart[2]),
      );
      if (currWorld) {
        const delta = currWorld.clone().sub(ps.dragStartWorld);
        const dX = Number(delta.x.toFixed(2));
        const dY = Number(delta.y.toFixed(2));
        const dZ = Number(delta.z.toFixed(2));
        const rawPositions = ps.draggedItems.map(
          (item) =>
            [
              Number((item.startPos[0] + dX).toFixed(2)),
              Number((item.startPos[1] + dY).toFixed(2)),
              Number((item.startPos[2] + dZ).toFixed(2)),
            ] as [number, number, number],
        );
        const positions = resolveSnappedMove(ps.draggedItems, rawPositions);
        const anchorPos = positions[0] ?? anchorStart;
        onMoveRef.current(
          ps.draggedItems.map((item, i) => ({
            id: item.id,
            position: positions[i] ?? rawPositions[i],
          })),
        );
        if (onTransformGhostChangeRef.current) {
          const objMap = new Map(objectsRef.current.map((o) => [o.id, o]));
          const ghostPayload: TransformGhostItem[] = [];
          for (const [i, item] of ps.draggedItems.entries()) {
            const obj = objMap.get(item.id);
            if (!obj) continue;
            const metrics = computeGhostBoxMetrics(obj);
            ghostPayload.push({
              id: item.id,
              kind: obj.kind,
              startPos: [...item.startPos],
              currentPos: positions[i] ?? rawPositions[i],
              rotation: [...obj.rotation],
              ...metrics,
            });
          }
          onTransformGhostChangeRef.current(ghostPayload);
        }
        const rect = mount.getBoundingClientRect();
        setDragDeltaHud({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          modeLabel: 'Move Free',
          dx: anchorPos[0] - anchorStart[0],
          dy: anchorPos[1] - anchorStart[1],
          dz: anchorPos[2] - anchorStart[2],
          dist: Math.hypot(
            anchorPos[0] - anchorStart[0],
            anchorPos[1] - anchorStart[1],
            anchorPos[2] - anchorStart[2],
          ),
          pos: anchorPos,
        });
      }
    } else if (ps.mode === 'marquee' && ps.moved && mount) {
      const rect = mount.getBoundingClientRect();
      const x1 = Math.min(ps.startX, e.clientX) - rect.left;
      const y1 = Math.min(ps.startY, e.clientY) - rect.top;
      const x2 = Math.max(ps.startX, e.clientX) - rect.left;
      const y2 = Math.max(ps.startY, e.clientY) - rect.top;
      setMarqueeRect({
        x: Math.max(0, x1),
        y: Math.max(0, y1),
        w: Math.max(0, x2 - Math.max(0, x1)),
        h: Math.max(0, y2 - Math.max(0, y1)),
        additive: ps.modifierMulti,
      });
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const ps = pointerStateRef.current;
    const st = threeRef.current;
    const mount = canvasMountRef.current;

    if (ps.mode === 'orbit') {
      snapOrbitToOrthogonalIfClose();
    } else if (ps.mode === 'gizmo-drag') {
      activeGizmoAxisRef.current = null;
      setDragDeltaHud(null);
      onTransformGhostChangeRef.current?.(null);
      if (st?.ghostGroup) {
        st.scene.remove(st.ghostGroup);
        disposeGroupResources(st.ghostGroup);
        st.ghostGroup = null;
      }
      clearSnapIndicator(st);
      st?.requestRender();
    } else if (ps.mode === 'select-or-drag') {
      setDragDeltaHud(null);
      onTransformGhostChangeRef.current?.(null);
      if (st?.ghostGroup) {
        st.scene.remove(st.ghostGroup);
        disposeGroupResources(st.ghostGroup);
        st.ghostGroup = null;
      }
      clearSnapIndicator(st);
      st?.requestRender();
      if (!ps.moved) {
        if (ps.modifierMulti) {
          if (ps.hitObjectId) {
            onSelectRef.current(ps.hitObjectId, 'toggle');
          }
        } else {
          onSelectRef.current(ps.hitObjectId, 'replace');
        }
      }
    } else if (ps.mode === 'marquee') {
      if (ps.moved && st && mount) {
        const rect = mount.getBoundingClientRect();
        const x1 = Math.min(ps.startX, e.clientX) - rect.left;
        const x2 = Math.max(ps.startX, e.clientX) - rect.left;
        const y1 = Math.min(ps.startY, e.clientY) - rect.top;
        const y2 = Math.max(ps.startY, e.clientY) - rect.top;

        const layerMap = new Map(layersRef.current.map((l) => [l.id, l]));
        const matchedIds: string[] = [];

        st.activeCam.updateMatrixWorld(true);
        for (const obj of objectsRef.current) {
          const layer = obj.layerId ? layerMap.get(obj.layerId) : undefined;
          if (layer && (!layer.visible || layer.locked)) continue;
          if (obj.hidden && !settingsRef.current.showHiddenObjects) continue;

          _v1.set(obj.position[0], obj.position[1], obj.position[2]).project(st.activeCam);
          if (_v1.z < -1 || _v1.z > 1) continue;
          const sx = ((_v1.x + 1) / 2) * st.width;
          const sy = ((-_v1.y + 1) / 2) * st.height;
          if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
            matchedIds.push(obj.id);
          }
        }

        // A marquee started directly on an unselected lamp must not lose it.
        if (ps.hitObjectId && !matchedIds.includes(ps.hitObjectId)) {
          const startObj = objectsRef.current.find((o) => o.id === ps.hitObjectId);
          const startLayer = startObj?.layerId
            ? layerMap.get(startObj.layerId)
            : undefined;
          if (
            startObj &&
            (!startLayer || startLayer.visible) &&
            (!startLayer || !startLayer.locked) &&
            (!startObj.hidden || settingsRef.current.showHiddenObjects)
          ) {
            matchedIds.push(startObj.id);
          }
        }

        if (onSelectMultipleRef.current) {
          onSelectMultipleRef.current(matchedIds, ps.modifierMulti);
        } else if (matchedIds.length > 0) {
          onSelectRef.current(matchedIds[0], 'replace');
        } else if (!ps.modifierMulti) {
          onSelectRef.current(null, 'replace');
        }
      } else if (!ps.moved) {
        if (ps.hitObjectId) {
          onSelectRef.current(ps.hitObjectId, ps.modifierMulti ? 'toggle' : 'replace');
        } else if (!ps.modifierMulti) {
          onSelectRef.current(null, 'replace');
        }
      }
      setMarqueeRect(null);
    }

    pointerStateRef.current.mode = 'none';
    pointerStateRef.current.draggedItems = [];
    pointerStateRef.current.dragStartWorld = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Native non-passive wheel listener for smooth Trackpad Two-Finger Pan & Pinch-to-Zoom
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // Trackpad pinch-to-zoom or Ctrl+wheel
        const zoomFactor = Math.exp(-e.deltaY * 0.012);
        zoomAtPoint(zoomFactor, e.clientX, e.clientY);
        return;
      }

      const isDiscreteMouseWheel =
        e.deltaMode !== 0 ||
        (e.deltaX === 0 &&
          Math.abs(e.deltaY) >= 96 &&
          Number.isInteger(e.deltaY) &&
          (Math.abs(e.deltaY) % 100 === 0 || Math.abs(e.deltaY) % 120 === 0));

      if (isDiscreteMouseWheel) {
        const zoomFactor = Math.exp(-e.deltaY * 0.0014);
        zoomAtPoint(zoomFactor, e.clientX, e.clientY);
      } else {
        // Trackpad two-finger swipe -> smooth CAD pan
        panByPixels(-e.deltaX, -e.deltaY);
      }
    };

    mount.addEventListener('wheel', onWheel, { passive: false });
    return () => mount.removeEventListener('wheel', onWheel);
  }, [panByPixels, zoomAtPoint]);

  // Green Orbit Button drag
  const orbitBtnDragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });

  // Green Dolly Button drag
  const dollyBtnDragRef = useRef<{ active: boolean; lastY: number }>({
    active: false,
    lastY: 0,
  });

  // Close menus on outside click
  useEffect(() => {
    if (!settingsMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSettingsMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [settingsMenuOpen]);

  // Save Image... PNG export
  const handleSaveImage = () => {
    const st = threeRef.current;
    if (!st) return;
    st.renderer.render(st.scene, st.activeCam);
    const dataUrl = st.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `capture-${settings.id}-${settings.projection.toLowerCase()}.png`;
    a.click();
    setSettingsMenuOpen(false);
  };

  // HTML5 Drag & Drop from Library tab or OS Files (.gdtf, .skp, .glb, .gltf, .obj)
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const t = e.dataTransfer.types;
    if (
      t.includes('application/x-capture-fixture') ||
      t.includes('application/x-capture-library-item') ||
      t.includes('application/x-capture-gdtf') ||
      t.includes('application/x-capture-skp') ||
      t.includes('application/x-capture-material') ||
      t.includes('Files')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragLeave = () => {
    // No visual drop overlay — keep the view unobstructed while dragging.
  };

  const computeDropWorldPos = (clientX: number, clientY: number, defaultY: number): [number, number, number] => {
    // Half-metre grid keeps drops predictable instead of leaving fixtures at
    // arbitrary sub-centimetre coordinates under the cursor.
    const snap = (v: number) => Math.round(v * 2) / 2;
    const st = threeRef.current;
    const mount = canvasMountRef.current;
    if (!st || !mount) return [0, defaultY, 0];

    const rect = mount.getBoundingClientRect();
    _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_ndc, st.activeCam);

    const dropPlane =
      settings.projection === 'Front' || settings.projection === 'Back'
        ? new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
        : settings.projection === 'Left' || settings.projection === 'Right'
          ? new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)
          : new THREE.Plane(new THREE.Vector3(0, 1, 0), -defaultY);

    const hit = new THREE.Vector3();
    if (_raycaster.ray.intersectPlane(dropPlane, hit)) {
      const isPlanView = settings.projection === 'Top' || settings.projection === 'Perspective';
      return [
        Number(snap(hit.x).toFixed(2)),
        Number((isPlanView ? defaultY : snap(hit.y)).toFixed(2)),
        Number(snap(hit.z).toFixed(2)),
      ];
    }
    return [0, defaultY, 0];
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const pos = computeDropWorldPos(e.clientX, e.clientY, 0);
      onDropFilesRef.current(e.dataTransfer.files, pos);
      return;
    }

    const gdtfPayload = e.dataTransfer.getData('application/x-capture-gdtf');
    if (gdtfPayload) {
      try {
        const { profileId, modeName } = JSON.parse(gdtfPayload) as { profileId: string; modeName?: string };
        onDropGdtfRef.current(profileId, modeName, computeDropWorldPos(e.clientX, e.clientY, 4.42));
      } catch {
        // ignore invalid payload
      }
      return;
    }

    const skpModelId = e.dataTransfer.getData('application/x-capture-skp');
    if (skpModelId) {
      onDropSkpRef.current(skpModelId, computeDropWorldPos(e.clientX, e.clientY, 0));
      return;
    }

    const materialId = e.dataTransfer.getData('application/x-capture-material');
    if (materialId) {
      const st = threeRef.current;
      const mount = canvasMountRef.current;
      let hitObjectId: string | null = null;
      if (st && mount) {
        const rect = mount.getBoundingClientRect();
        _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        _raycaster.setFromCamera(_ndc, st.activeCam);
        const rawHits = _raycaster.intersectObjects(st.objectsGroup.children, true);
        const hits = rawHits.filter(
          (h) => !h.object.userData.isVolumetricBeam && !h.object.userData.isSelectionHelper,
        );
        hitObjectId =
          hits.length > 0 ? ((hits[0].object.userData.objectId as string | undefined) ?? null) : null;
      }
      onDropMaterialRef.current?.(materialId, hitObjectId);
      return;
    }

    const catalogId = e.dataTransfer.getData('application/x-capture-library-item');
    const kind = (e.dataTransfer.getData('application/x-capture-fixture') as ObjectKind) || 'moving-head';
    if (!catalogId && !e.dataTransfer.getData('application/x-capture-fixture')) return;

    const defaultY =
      kind === 'stage-deck'
        ? 0
        : kind === 'truss'
          ? 4.6
          : kind === 'moving-head'
            ? 4.42
            : kind === 'smoke-volume'
              ? 3.2
              : 0.38;
    onDropRef.current(kind, computeDropWorldPos(e.clientX, e.clientY, defaultY), catalogId || undefined);
  };

  // Compute Aspect Ratio letterbox/pillarbox mask bounds
  const targetRatio = parseAspectRatio(settings.aspectRatio);
  let maskTopBottom = 0;
  let maskLeftRight = 0;
  if (targetRatio && vpSize.w > 0 && vpSize.h > 0) {
    const currentRatio = vpSize.w / vpSize.h;
    if (currentRatio > targetRatio) {
      const targetW = vpSize.h * targetRatio;
      maskLeftRight = Math.max(0, (vpSize.w - targetW) / 2);
    } else if (currentRatio < targetRatio) {
      const targetH = vpSize.w / targetRatio;
      maskTopBottom = Math.max(0, (vpSize.h - targetH) / 2);
    }
  }

  const maskColor =
    settings.aspectMasking === 'Black'
      ? '#000000'
      : settings.aspectMasking === 'Opaque'
        ? '#1A1A1A'
        : 'rgba(0, 0, 0, 0.45)';

  // Image Adjustments + Exposure CSS Filter (only applied when adjusted from neutral defaults)
  const effectiveSat = settings.saturation * (1 - (settings.hueClamp - 25) * 0.0025);
  const needsFilter =
    Math.abs(effectiveSat - 100) > 0.5 ||
    settings.contrast !== 100 ||
    (settings.renderMode !== 'live' && settings.exposureAdjustment !== 0);
  const canvasFilter = needsFilter
    ? `saturate(${Math.max(0, effectiveSat).toFixed(1)}%) contrast(${settings.contrast}%) brightness(${
        settings.renderMode !== 'live'
          ? Math.pow(2, settings.exposureAdjustment * 0.2).toFixed(2)
          : 1
      })`
    : undefined;

  const effectiveBaseMode = resolveViewportBaseMode(settings);
  const isPlotView = effectiveBaseMode === 'plot';

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none ${
        isPlotView ? 'bg-[#F4F5F2]' : 'bg-[#000000]'
      }`}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Dedicated WebGL mount container */}
      <div
        ref={canvasMountRef}
        className={`w-full h-full ${hoveredGizmoAxis ? 'cursor-pointer' : 'cursor-crosshair'}`}
        style={canvasFilter ? { filter: canvasFilter } : undefined}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
      />

      {/* Marquee Drag-Box Selection Rectangle */}
      {marqueeRect && marqueeRect.w > 2 && marqueeRect.h > 2 && (
        <div
          className="pointer-events-none absolute z-[15] border border-[#6BC938] bg-[#6BC938]/15"
          style={{
            left: `${marqueeRect.x}px`,
            top: `${marqueeRect.y}px`,
            width: `${marqueeRect.w}px`,
            height: `${marqueeRect.h}px`,
          }}
        />
      )}

      {/* Real-time Gizmo / Drag Delta Readout Tooltip */}
      {dragDeltaHud && (
        <div
          className="pointer-events-none absolute z-30 px-2 py-1.5 bg-[#161616]/95 border border-[#4D8C2A] shadow-lg text-[10px] leading-[14px] text-[#E5E5EA] tabular-nums whitespace-nowrap"
          style={{
            left: `${Math.min(Math.max(8, vpSize.w - 190), Math.max(8, dragDeltaHud.x + 14))}px`,
            top: `${Math.min(Math.max(8, vpSize.h - 74), Math.max(8, dragDeltaHud.y + 14))}px`,
          }}
        >
          <div className="flex items-center justify-between gap-3 text-[#6BC938] font-medium mb-0.5">
            <span>{dragDeltaHud.modeLabel}</span>
            <span>{dragDeltaHud.dist.toFixed(2)}m</span>
          </div>
          <div className="flex items-center gap-2 text-[#CCCCCC]">
            <span className="text-[#FF6961]">
              ΔX {dragDeltaHud.dx >= 0 ? '+' : ''}
              {dragDeltaHud.dx.toFixed(2)}
            </span>
            <span className="text-[#62D97B]">
              ΔY {dragDeltaHud.dy >= 0 ? '+' : ''}
              {dragDeltaHud.dy.toFixed(2)}
            </span>
            <span className="text-[#5AC8FA]">
              ΔZ {dragDeltaHud.dz >= 0 ? '+' : ''}
              {dragDeltaHud.dz.toFixed(2)}
            </span>
          </div>
          <div className="text-[#8E8E93] mt-0.5">
            Pos ({dragDeltaHud.pos[0].toFixed(2)}, {dragDeltaHud.pos[1].toFixed(2)},{' '}
            {dragDeltaHud.pos[2].toFixed(2)})m
          </div>
        </div>
      )}

      {/* Optical Lens Effects (Bloom & Anamorphic Flare Streaks in Live/Custom mode) */}
      {(settings.renderMode === 'live' || settings.renderMode === 'custom') &&
        lensNodes.map((node) => {
          const bloomSize = 18 + (settings.bloom / 100) * 56 * node.intensity * flickerGain;
          const bloomOpacity = Math.min(0.85, (settings.bloom / 100) * 0.55 * node.intensity * flickerGain);
          const streakLen = (24 + (settings.flare / 100) * 84 * node.intensity) * (settings.flareSize / 100) * flickerGain;
          const flareOpacity = Math.min(0.9, (settings.flare / 100) * 0.72 * node.intensity * flickerGain);
          const streakCount = Math.max(0, Math.min(8, Math.round(settings.flareStreaks)));

          return (
            <div
              key={`lens-${node.id}`}
              className="pointer-events-none absolute z-10"
              style={{
                left: `${node.x}px`,
                top: `${node.y}px`,
                transform: 'translate(-50%, -50%)',
                mixBlendMode: 'screen',
              }}
            >
              {settings.bloom > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: `${bloomSize}px`,
                    height: `${bloomSize}px`,
                    transform: 'translate(-50%, -50%)',
                    borderRadius: '50%',
                    background: `radial-gradient(circle, ${node.color} 0%, rgba(0,0,0,0) 70%)`,
                    opacity: bloomOpacity,
                  }}
                />
              )}
              {settings.flare > 0 &&
                streakCount > 0 &&
                Array.from({ length: streakCount }, (_, i) => {
                  const angle = settings.flareAngle + (i * 180) / streakCount;
                  return (
                    <div
                      key={i}
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: `${streakLen}px`,
                        height: '2px',
                        transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                        background: `linear-gradient(90deg, rgba(0,0,0,0) 0%, ${node.color} 50%, rgba(0,0,0,0) 100%)`,
                        opacity: flareOpacity,
                      }}
                    />
                  );
                })}
            </div>
          );
        })}

      {/* Aspect Ratio Masking (Letterbox / Pillarbox) */}
      {targetRatio && (maskTopBottom > 0 || maskLeftRight > 0) && (
        <div className="pointer-events-none absolute inset-0 z-10">
          {maskTopBottom > 0 && (
            <>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: `${maskTopBottom}px`,
                  backgroundColor: maskColor,
                  borderBottom: '1px solid rgba(107, 201, 56, 0.35)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: `${maskTopBottom}px`,
                  backgroundColor: maskColor,
                  borderTop: '1px solid rgba(107, 201, 56, 0.35)',
                }}
              />
            </>
          )}
          {maskLeftRight > 0 && (
            <>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: `${maskLeftRight}px`,
                  backgroundColor: maskColor,
                  borderRight: '1px solid rgba(107, 201, 56, 0.35)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  right: 0,
                  width: `${maskLeftRight}px`,
                  backgroundColor: maskColor,
                  borderLeft: '1px solid rgba(107, 201, 56, 0.35)',
                }}
              />
            </>
          )}
        </div>
      )}

      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#000000] text-[#8E8E93] text-[12px]">
          WebGL rendering context suspended. Restoring viewport...
        </div>
      )}

      {/* Alpha View Center Origin Cloud Marker at (0,0,0) */}
      {settings.id === 'alpha' && settings.showWidgets && originScreenPos.visible && (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            left: `${originScreenPos.x}px`,
            top: `${originScreenPos.y}px`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <OriginCloudIcon className="w-[18px] h-[12px]" />
        </div>
      )}

      {/* Fixture Information HUD labels (when toggled in Viewport Settings) */}
      {settings.showFixtureInfo &&
        fixtureLabels.map((lbl) => (
          <div
            key={lbl.id}
            className="pointer-events-none absolute z-10 text-[10px] leading-none px-1 py-0.5 rounded-[2px] tabular-nums whitespace-nowrap"
            style={
              isPlotView
                ? {
                    left: `${lbl.x + 8}px`,
                    top: `${lbl.y - 8}px`,
                    color: lbl.selected ? '#D92D20' : '#1A1A1A',
                    backgroundColor: 'rgba(255,255,255,0.9)',
                    border: `1px solid ${lbl.selected ? '#D92D20' : lbl.layerColor || '#9CA3AF'}`,
                  }
                : {
                    left: `${lbl.x + 8}px`,
                    top: `${lbl.y - 8}px`,
                    color: lbl.selected ? '#FF3B30' : '#B5D98C',
                    backgroundColor: 'rgba(0,0,0,0.72)',
                  }
            }
          >
            {lbl.text}
          </div>
        ))}

      {/* Live Control Pane — opens from the middle button of the selection navigator. */}
      {effectiveBaseMode === 'live' &&
        (liveControlOpen ? (
          <LiveControlPane
            settings={settings}
            objects={objects}
            selectedObjectIds={selectedObjectIds}
            gdtfProfiles={gdtfProfiles}
            focusMode={focusMode}
            onToggleFocusMode={() => setFocusMode((v) => !v)}
            onToggleOpen={() => setLiveControlOpen(false)}
            onUpdateSettings={onUpdateSettings}
            onUpdateObjects={onUpdateObjects}
            onMoveObjects={onMoveObjects}
            onSelectMultiple={onSelectMultiple ?? (() => {})}
            onClearSelection={() => onSelectObject(null)}
            onDuplicateObjects={onDuplicateObjects}
            onDeleteObjects={onDeleteObjects}
            onShowDetails={onShowDetails}
          />
        ) : (
          <div className="absolute bottom-[42px] left-[8px] z-30 flex gap-1">
            <button
              type="button"
              title="Open Live Control Pane"
              onClick={() => setLiveControlOpen(true)}
              className="w-[26px] h-[26px] rounded-full bg-[#3B6E1C] border border-[#569A2D] flex items-center justify-center text-[#FFFFFF] hover:bg-[#498723] cursor-pointer"
            >
              <Power className="w-[13px] h-[13px]" />
            </button>
            {focusMode && (
              <button
                type="button"
                title="Exit focus mode"
                onClick={() => setFocusMode(false)}
                className="h-[26px] px-2 flex items-center gap-1 rounded-full bg-[#4A1E1B] border border-[#D92D20] text-[#FF8A80] text-[10px] cursor-pointer"
              >
                <Crosshair className="w-[12px] h-[12px]" /> Focus ON
              </button>
            )}
          </div>
        ))}

      {/* Bottom-Right Viewport Navigation Overlay */}
      {settings.showViewNavigator && (
        <div className="absolute bottom-[8px] right-[8px] z-20 flex flex-col items-center gap-[3px]">
          {/* Interactive 3D View Navigator (View Cube) directly above the three green buttons */}
          <ViewCube
            matrix3d={cubeState.matrix3d}
            viewDir={cubeState.viewDir}
            activeProjection={settings.projection}
            onSnapTo={handleViewCubeSnap}
            onOrbitDrag={orbitByPixels}
            onOrbitEnd={snapOrbitToOrthogonalIfClose}
          />

          {/* Three Circular Green Control Buttons (22px diameter, #3B6E1C fill, 4px apart) */}
          <div className="flex items-center gap-[4px]">
            {/* 1. Left Button: 360° Orbit / Rotate */}
            <button
              type="button"
              title="Drag to 360° Orbit"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                orbitBtnDragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
              }}
              onPointerMove={(e) => {
                if (!orbitBtnDragRef.current.active) return;
                const dx = e.clientX - orbitBtnDragRef.current.lastX;
                const dy = e.clientY - orbitBtnDragRef.current.lastY;
                orbitBtnDragRef.current.lastX = e.clientX;
                orbitBtnDragRef.current.lastY = e.clientY;
                orbitByPixels(dx, dy);
              }}
              onPointerUp={(e) => {
                const wasActive = orbitBtnDragRef.current.active;
                orbitBtnDragRef.current.active = false;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
                if (wasActive) {
                  snapOrbitToOrthogonalIfClose();
                }
              }}
              className="w-[22px] h-[22px] rounded-full bg-[#3B6E1C] border border-[#569A2D] flex items-center justify-center hover:bg-[#498723] active:scale-95 transition-transform cursor-grab active:cursor-grabbing"
            >
              <OrbitButtonIcon className="w-[14px] h-[14px]" />
            </button>

            {/* 2. Middle Button: Dolly / Forward-Backward Zoom */}
            <button
              type="button"
              title="Drag up/down to Zoom / Dolly"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                dollyBtnDragRef.current = { active: true, lastY: e.clientY };
              }}
              onPointerMove={(e) => {
                if (!dollyBtnDragRef.current.active) return;
                const dy = e.clientY - dollyBtnDragRef.current.lastY;
                dollyBtnDragRef.current.lastY = e.clientY;
                zoomAtPoint(Math.exp(-dy * 0.01));
              }}
              onPointerUp={(e) => {
                dollyBtnDragRef.current.active = false;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              }}
              className="w-[22px] h-[22px] rounded-full bg-[#3B6E1C] border border-[#569A2D] flex items-center justify-center hover:bg-[#498723] active:scale-95 transition-transform cursor-ns-resize"
            >
              <DollyButtonIcon className="w-[14px] h-[14px]" />
            </button>

            {/* 3. Right Button: Viewport Settings Dropdown */}
            <div className="relative">
              <button
                type="button"
                title="Viewport Settings"
                onClick={(e) => {
                  e.stopPropagation();
                  setCameraSubmenuOpen(false);
                  setStoreSubmenuOpen(false);
                  setSettingsMenuOpen((v) => !v);
                }}
                className="w-[22px] h-[22px] rounded-full bg-[#3B6E1C] border border-[#569A2D] flex items-center justify-center hover:bg-[#498723] active:scale-95 transition-transform cursor-pointer"
              >
                <MenuBarsButtonIcon className="w-[12px] h-[12px]" />
              </button>

              {/* Exact macOS Dark Frosted-Glass Viewport Context Menu */}
              {settingsMenuOpen && (
                <div
                  className="absolute bottom-[28px] right-0 w-[238px] py-[5px] rounded-[8px] border border-[#4A4A4A] shadow-[0_12px_36px_rgba(0,0,0,0.75)] z-40 text-[12px] leading-[18px]"
                  style={{
                    backgroundColor: 'rgba(38, 38, 38, 0.92)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                  }}
                >
                  {/* Render Modes */}
                  {(
                    [
                      { key: 'wireframe', label: 'Wireframe', shortcut: '⌘ W' },
                      { key: 'plot', label: 'Plot', shortcut: '⌘ E' },
                      { key: 'live', label: 'Live', shortcut: '⌘ R' },
                      { key: 'custom', label: 'Custom', shortcut: '⇧ ⌘ X' },
                    ] as Array<{ key: RenderMode; label: string; shortcut: string }>
                  ).map((item) => {
                    const checked = settings.renderMode === item.key;
                    const isHighlighted =
                      hoveredMenuItem === item.key || (hoveredMenuItem === null && item.key === 'plot');
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onMouseEnter={() => setHoveredMenuItem(item.key)}
                        onMouseLeave={() => setHoveredMenuItem(null)}
                        onClick={() => {
                          onUpdateSettings(settings.id, { renderMode: item.key });
                          setSettingsMenuOpen(false);
                        }}
                        className="w-full px-[10px] py-[2px] flex items-center justify-between text-left text-[#FFFFFF] cursor-pointer"
                        style={{
                          backgroundColor: isHighlighted ? '#6B6032' : 'transparent',
                        }}
                      >
                        <span className="flex items-center gap-[6px]">
                          <span className="w-[12px] text-[11px] text-center">{checked ? '✔' : ''}</span>
                          <span>{item.label}</span>
                        </span>
                        <span className="text-[11px] text-[#8E8E93] tabular-nums">{item.shortcut}</span>
                      </button>
                    );
                  })}

                  <div className="my-[4px] border-t border-[#484848]" />

                  {/* Camera Submenu */}
                  <div
                    className="relative"
                    onMouseEnter={() => {
                      setHoveredMenuItem('camera');
                      setCameraSubmenuOpen(true);
                      setStoreSubmenuOpen(false);
                    }}
                    onMouseLeave={() => {
                      setHoveredMenuItem(null);
                      setCameraSubmenuOpen(false);
                    }}
                  >
                    <button
                      type="button"
                      className="w-full px-[10px] py-[2px] flex items-center justify-between text-left text-[#FFFFFF] cursor-pointer"
                      style={{
                        backgroundColor: hoveredMenuItem === 'camera' ? '#6B6032' : 'transparent',
                      }}
                    >
                      <span className="flex items-center gap-[6px]">
                        <span className="w-[12px]" />
                        <span>Camera</span>
                      </span>
                      <span className="text-[13px] text-[#8E8E93]">›</span>
                    </button>

                    {cameraSubmenuOpen && (
                      <div
                        className="absolute right-[234px] top-[-4px] w-[140px] py-[4px] rounded-[8px] border border-[#4A4A4A] shadow-2xl"
                        style={{
                          backgroundColor: 'rgba(38, 38, 38, 0.94)',
                          backdropFilter: 'blur(16px)',
                          WebkitBackdropFilter: 'blur(16px)',
                        }}
                      >
                        {PROJECTIONS.map((proj) => (
                          <button
                            key={proj}
                            type="button"
                            onClick={() => {
                              onUpdateSettings(settings.id, { projection: proj });
                              setSettingsMenuOpen(false);
                              setCameraSubmenuOpen(false);
                            }}
                            className="w-full px-[10px] py-[2px] flex items-center gap-[6px] text-left text-[#FFFFFF] hover:bg-[#6B6032] cursor-pointer"
                          >
                            <span className="w-[12px] text-[11px]">
                              {settings.projection === proj ? '✔' : ''}
                            </span>
                            <span>{proj}</span>
                          </button>
                        ))}
                        <div className="my-[3px] border-t border-[#484848]" />
                        <button
                          type="button"
                          onClick={() => {
                            const st = threeRef.current;
                            if (st) {
                              const basis = getDefaultCameraBasis(settings.projection);
                              st.target.copy(basis.target);
                              st.camOffset.copy(basis.offset);
                              st.zoom = 1;
                              st.requestRender();
                            }
                            setSettingsMenuOpen(false);
                            setCameraSubmenuOpen(false);
                          }}
                          className="w-full px-[10px] py-[2px] text-left text-[#FFFFFF] hover:bg-[#6B6032] cursor-pointer pl-[28px]"
                        >
                          Reset View
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Store Camera Submenu */}
                  <div
                    className="relative"
                    onMouseEnter={() => {
                      setHoveredMenuItem('store-camera');
                      setStoreSubmenuOpen(true);
                      setCameraSubmenuOpen(false);
                    }}
                    onMouseLeave={() => {
                      setHoveredMenuItem(null);
                      setStoreSubmenuOpen(false);
                    }}
                  >
                    <button
                      type="button"
                      className="w-full px-[10px] py-[2px] flex items-center justify-between text-left text-[#FFFFFF] cursor-pointer"
                      style={{
                        backgroundColor: hoveredMenuItem === 'store-camera' ? '#6B6032' : 'transparent',
                      }}
                    >
                      <span className="flex items-center gap-[6px]">
                        <span className="w-[12px]" />
                        <span>Store Camera</span>
                      </span>
                      <span className="text-[13px] text-[#8E8E93]">›</span>
                    </button>

                    {storeSubmenuOpen && (
                      <div
                        className="absolute right-[234px] top-[-4px] w-[160px] py-[4px] rounded-[8px] border border-[#4A4A4A] shadow-2xl"
                        style={{
                          backgroundColor: 'rgba(38, 38, 38, 0.94)',
                          backdropFilter: 'blur(16px)',
                          WebkitBackdropFilter: 'blur(16px)',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const st = threeRef.current;
                            if (st) {
                              const pos: [number, number, number] = [
                                Number((st.target.x + st.camOffset.x).toFixed(2)),
                                Number((st.target.y + st.camOffset.y).toFixed(2)),
                                Number((st.target.z + st.camOffset.z).toFixed(2)),
                              ];
                              onStoreCameraPreset({
                                name: `${settings.title} (${settings.projection})`,
                                projection: settings.projection,
                                position: pos,
                                target: [
                                  Number(st.target.x.toFixed(2)),
                                  Number(st.target.y.toFixed(2)),
                                  Number(st.target.z.toFixed(2)),
                                ],
                                zoom: st.zoom,
                              });
                            }
                            setSettingsMenuOpen(false);
                            setStoreSubmenuOpen(false);
                          }}
                          className="w-full px-[10px] py-[3px] text-left text-[#FFFFFF] hover:bg-[#6B6032] cursor-pointer"
                        >
                          Save Current Camera...
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="my-[4px] border-t border-[#484848]" />

                  {/* Display Toggles */}
                  <button
                    type="button"
                    onMouseEnter={() => setHoveredMenuItem('grid')}
                    onMouseLeave={() => setHoveredMenuItem(null)}
                    onClick={() => onUpdateSettings(settings.id, { showGrid: !settings.showGrid })}
                    className="w-full px-[10px] py-[2px] flex items-center justify-between text-left text-[#FFFFFF] cursor-pointer"
                    style={{ backgroundColor: hoveredMenuItem === 'grid' ? '#6B6032' : 'transparent' }}
                  >
                    <span className="flex items-center gap-[6px]">
                      <span className="w-[12px] text-[11px] text-center">{settings.showGrid ? '✔' : ''}</span>
                      <span>Grid</span>
                    </span>
                    <span className="text-[11px] text-[#8E8E93] tabular-nums">⇧ ⌘ G</span>
                  </button>

                  <button
                    type="button"
                    onMouseEnter={() => setHoveredMenuItem('widgets')}
                    onMouseLeave={() => setHoveredMenuItem(null)}
                    onClick={() => onUpdateSettings(settings.id, { showWidgets: !settings.showWidgets })}
                    className="w-full px-[10px] py-[2px] flex items-center justify-between text-left text-[#FFFFFF] cursor-pointer"
                    style={{ backgroundColor: hoveredMenuItem === 'widgets' ? '#6B6032' : 'transparent' }}
                  >
                    <span className="flex items-center gap-[6px]">
                      <span className="w-[12px] text-[11px] text-center">{settings.showWidgets ? '✔' : ''}</span>
                      <span>Widgets</span>
                    </span>
                    <span className="text-[11px] text-[#8E8E93] tabular-nums">⇧ ⌘ W</span>
                  </button>

                  <button
                    type="button"
                    onMouseEnter={() => setHoveredMenuItem('hidden')}
                    onMouseLeave={() => setHoveredMenuItem(null)}
                    onClick={() =>
                      onUpdateSettings(settings.id, { showHiddenObjects: !settings.showHiddenObjects })
                    }
                    className="w-full px-[10px] py-[2px] flex items-center justify-between text-left text-[#FFFFFF] cursor-pointer"
                    style={{ backgroundColor: hoveredMenuItem === 'hidden' ? '#6B6032' : 'transparent' }}
                  >
                    <span className="flex items-center gap-[6px]">
                      <span className="w-[12px] text-[11px] text-center">
                        {settings.showHiddenObjects ? '✔' : ''}
                      </span>
                      <span>Hidden Objects</span>
                    </span>
                    <span className="text-[11px] text-[#8E8E93] tabular-nums">⇧ ⌘ H</span>
                  </button>

                  {/* Disabled Project Information */}
                  <div className="w-full px-[10px] py-[2px] flex items-center justify-between text-left text-[#777777] cursor-default">
                    <span className="flex items-center gap-[6px]">
                      <span className="w-[12px] text-[11px] text-center text-[#777777]/65">✔</span>
                      <span>Project Information</span>
                    </span>
                    <span className="text-[11px] text-[#666666] tabular-nums">⇧ ⌘ P</span>
                  </div>

                  <button
                    type="button"
                    onMouseEnter={() => setHoveredMenuItem('fixture-info')}
                    onMouseLeave={() => setHoveredMenuItem(null)}
                    onClick={() =>
                      onUpdateSettings(settings.id, { showFixtureInfo: !settings.showFixtureInfo })
                    }
                    className="w-full px-[10px] py-[2px] flex items-center justify-between text-left text-[#FFFFFF] cursor-pointer"
                    style={{ backgroundColor: hoveredMenuItem === 'fixture-info' ? '#6B6032' : 'transparent' }}
                  >
                    <span className="flex items-center gap-[6px]">
                      <span className="w-[12px] text-[11px] text-center">
                        {settings.showFixtureInfo ? '✔' : ''}
                      </span>
                      <span>Fixture Information</span>
                    </span>
                    <span className="text-[11px] text-[#8E8E93] tabular-nums">⇧ ⌘ I</span>
                  </button>

                  <button
                    type="button"
                    onMouseEnter={() => setHoveredMenuItem('sel-nav')}
                    onMouseLeave={() => setHoveredMenuItem(null)}
                    onClick={() =>
                      onUpdateSettings(settings.id, {
                        showSelectionNavigator: !settings.showSelectionNavigator,
                      })
                    }
                    className="w-full px-[10px] py-[2px] flex items-center justify-between text-left text-[#FFFFFF] cursor-pointer"
                    style={{ backgroundColor: hoveredMenuItem === 'sel-nav' ? '#6B6032' : 'transparent' }}
                  >
                    <span className="flex items-center gap-[6px]">
                      <span className="w-[12px] text-[11px] text-center">
                        {settings.showSelectionNavigator ? '✔' : ''}
                      </span>
                      <span>Selection Navigator</span>
                    </span>
                    <span className="text-[11px] text-[#8E8E93] tabular-nums">⇧ ⌘ N</span>
                  </button>

                  <button
                    type="button"
                    onMouseEnter={() => setHoveredMenuItem('view-nav')}
                    onMouseLeave={() => setHoveredMenuItem(null)}
                    onClick={() => {
                      onUpdateSettings(settings.id, { showViewNavigator: !settings.showViewNavigator });
                      setSettingsMenuOpen(false);
                    }}
                    className="w-full px-[10px] py-[2px] flex items-center justify-between text-left text-[#FFFFFF] cursor-pointer"
                    style={{ backgroundColor: hoveredMenuItem === 'view-nav' ? '#6B6032' : 'transparent' }}
                  >
                    <span className="flex items-center gap-[6px]">
                      <span className="w-[12px] text-[11px] text-center">
                        {settings.showViewNavigator ? '✔' : ''}
                      </span>
                      <span>View Navigator</span>
                    </span>
                    <span className="text-[11px] text-[#8E8E93] tabular-nums">⇧ ⌘ E</span>
                  </button>

                  <div className="my-[4px] border-t border-[#484848]" />

                  {/* Save Image & Render Image */}
                  <button
                    type="button"
                    onMouseEnter={() => setHoveredMenuItem('save-img')}
                    onMouseLeave={() => setHoveredMenuItem(null)}
                    onClick={handleSaveImage}
                    className="w-full px-[10px] py-[2px] flex items-center justify-between text-left text-[#FFFFFF] cursor-pointer"
                    style={{ backgroundColor: hoveredMenuItem === 'save-img' ? '#6B6032' : 'transparent' }}
                  >
                    <span className="flex items-center gap-[6px]">
                      <span className="w-[12px]" />
                      <span>Save Image...</span>
                    </span>
                  </button>

                  <div className="w-full px-[10px] py-[2px] flex items-center justify-between text-left text-[#777777] cursor-default">
                    <span className="flex items-center gap-[6px]">
                      <span className="w-[12px]" />
                      <span>Render Image...</span>
                    </span>
                    <span className="text-[11px] text-[#666666] tabular-nums">⌘ I</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Subtle restore View Navigator button if user toggled it off */}
      {!settings.showViewNavigator && (
        <button
          type="button"
          onClick={() => onUpdateSettings(settings.id, { showViewNavigator: true })}
          className="absolute bottom-[8px] right-[8px] z-20 px-2 py-0.5 text-[10px] bg-[#1B3311]/75 border border-[#4D8C2A]/60 text-[#6BC938] hover:bg-[#234416] cursor-pointer"
        >
          Show Navigator
        </button>
      )}
    </div>
  );
};
