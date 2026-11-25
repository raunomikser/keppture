export type ViewportId = 'alpha' | 'beta' | 'gamma';
export type PaneId = ViewportId | 'project';

export type RenderMode = 'wireframe' | 'plot' | 'live' | 'custom';

export type ProjectionType =
  | 'Top'
  | 'Front'
  | 'Right'
  | 'Back'
  | 'Left'
  | 'Bottom'
  | 'Perspective';

export type CustomFaceStyle = 'Solid' | 'Wireframe' | 'Plot';
export type CustomModelSpace = 'Screen' | 'World';
export type LayerLineStyle = 'Solid' | 'Dashed' | 'Dotted';
export type AspectRatioOption = 'View Controlled' | '16:9' | '4:3' | '1:1' | '21:9';
export type AspectMaskingOption = 'Transparent' | 'Opaque' | 'Black';

export type ProjectTab =
  | 'Design'
  | 'Fixtures'
  | 'Universes'
  | 'Media'
  | 'Snapshots'
  | 'Library';

export type DesignCategory =
  | 'Project'
  | 'Selected Items'
  | 'Views'
  | 'Layers'
  | 'Filters'
  | 'Fixture Groups'
  | 'Camera Positions';

export type LibraryCategory =
  | 'Built-In'
  | 'Recent'
  | 'Objects'
  | 'Materials'
  | 'Truss'
  | 'Fixtures'
  | 'Fixture Symbols'
  | 'Symbols'
  | 'Filters'
  | 'Gobos';

export type ObjectKind =
  | 'moving-head'
  | 'led-par'
  | 'truss'
  | 'stage-deck'
  | 'gdtf-fixture'
  | 'skp-model'
  | 'smoke-volume'
  | 'co2-jet'
  | 'flame-jet';

export type BuiltInGroup =
  | 'Dimensioning'
  | 'Snapping'
  | 'Reporting'
  | 'Rigging'
  | 'Motion'
  | 'Effects'
  | 'Visualisation';

export interface SceneObject {
  id: string;
  name: string;
  kind: ObjectKind;
  position: [number, number, number];
  rotation: [number, number, number]; // radians [x, y, z]
  scale?: [number, number, number];
  layerId?: string;
  groupId?: string;
  hidden?: boolean;
  // Lighting fixture properties (for moving-head, led-par & gdtf-fixture)
  dmxUniverse?: number; // 1-based (A=1, B=2)
  dmxAddress?: number; // 1..512
  dmxFootprint?: number;
  channel?: number;
  intensity?: number; // 0..1
  /** Opens/closes the mechanical shutter. `undefined` means open. */
  shutter?: boolean;
  color?: string; // hex
  beamAngle?: number; // degrees
  pan?: number; // degrees (-270..270)
  tilt?: number; // degrees (-120..120)
  gobo?: string;
  // GDTF runtime fields
  gdtfProfileId?: string;
  gdtfModeName?: string;
  goboMediaFile?: string;
  // SketchUp / 3D Model runtime fields
  skpModelId?: string;
  skpCatalogId?: string;
  /** Local-space truss connector positions, normalized to the local X axis. */
  trussEndpoints?: Array<[number, number, number]>;
  // Truss / deck / prop dimensions & sub-type metadata
  length?: number;
  width?: number;
  height?: number;
  subType?: string;
  materialPreset?: string;
  // Detailed Lighting Fixture & General Inspector properties
  includeInScenes?: boolean;
  castsShadows?: boolean;
  make?: string;
  modelName?: string;
  version?: string;
  weightKg?: number;
  circuit?: string;
  purpose?: string;
  /** Fixture-table patch location/unit/filter labels (schedule-style columns). */
  location?: string;
  unit?: string;
  filter?: string;
  consoleId?: string;
  externalId?: string;
  note?: string;
  correction?: string;
  invertPan?: boolean;
  invertTilt?: boolean;
  panRange?: number;
  tiltRange?: number;
  limitPanStart?: number;
  limitPanEnd?: number;
  simulateFocus?: boolean;
  opticsSummary?: string;
  throwsLight?: boolean;
  spillLighting?: boolean;
  effectWheel?: string;
  staticGobo?: string;
  rotatingGobo?: string;
  prism1?: string;
  prism2?: string;
  beamShaper?: string;
  symbolName?: string;
  symbolScale?: number;
  symbolUsage?: 'Top Views Only' | 'All Views' | 'Plot Only';
  colourByFilter?: boolean;
  focusLabel?: string;
  // Detailed Truss Segment properties
  series?: string;
  subseries?: string;
  part?: string;
  trussType?: 'Rectangular Section' | 'Triangular Section' | 'Ladder Section' | 'Flat Section' | 'Circle Section' | 'Corner';
  pipeDiameterMm?: number;
  braceDiameterMm?: number;
  sectionWidth?: number;
  sectionHeight?: number;
  circleAngle?: number;
  circleDiameter?: number;
  plotText?: string;
  showType?: boolean;
  showDimensions?: boolean;
  showTrimHeight?: boolean;
  trimHeightPrecision?: string;
  measurementUnit?: string;
  // Smoke / Haze Volume properties (visible exclusively in Live mode)
  smokeLegacyModel?: boolean;
  smokeSpeed?: number; // percentage (0 - 200%, e.g. 0%)
  smokeAutoSize?: boolean;
  smokeWidth?: number; // meters (X-axis, e.g. 200m)
  smokeHeight?: number; // meters (Y-axis, e.g. 50m)
  smokeDepth?: number; // meters (Z-axis, e.g. 60m)
  smokeDensity?: number; // percentage (0 - 100%, e.g. 1.3%)
  smokeVariation?: number; // percentage (0 - 100%, e.g. 100%)
  smokeEdgeSoftness?: number; // percentage (0 - 100%, e.g. 37.9%)
  smokePatch?: string; // 'Unpatched' or 'Univ.Addr' (e.g. '1.150')
}

export interface ViewportSettings {
  id: ViewportId;
  title: string;
  projection: ProjectionType;
  lastOrthoProjection?: Exclude<ProjectionType, 'Perspective'>;
  renderMode: RenderMode;
  showGrid: boolean;
  showWidgets: boolean;
  showHiddenObjects: boolean;
  showFixtureInfo: boolean;
  showSelectionNavigator: boolean;
  showViewNavigator: boolean;
  // 1. View Settings
  customFaceStyle?: CustomFaceStyle;
  customWireframeOverlay?: boolean;
  customIsolatedLayerId?: string;
  customModelSpace: CustomModelSpace;
  gridWidth: number; // meters
  gridHeight: number; // meters
  // 2. Camera Settings
  fov: number; // vertical FOV degrees
  aspectRatio: AspectRatioOption;
  aspectMasking: AspectMaskingOption;
  whiteBalance: number; // Kelvin (2000 - 10000)
  autoExposure: boolean;
  exposureAdjustment: number; // EV (-3 to +3)
  // 3. Environment Settings
  laserFlicker: boolean;
  ambientLighting: number; // 0 - 100%
  ambientLightingColor: string; // hex
  fillLighting: number; // 0 - 100%
  // 4. Lens Effects (Post-Processing)
  bloom: number; // 20 - 100%
  flare: number; // 0 - 100%
  flareStreaks: number; // integer count
  flareAngle: number; // degrees
  flareSize: number; // percentage
  // 5. Image Adjustments
  hueClamp: number; // percentage
  saturation: number; // percentage
  contrast: number; // percentage
}

export interface ProjectMetadata {
  project: string;
  projectLocation: string;
  projectDate: string;
  lightingDesigner: string;
  setDesigner: string;
  director: string;
  technicalDirector: string;
  masterElectrician: string;
  client: string;
  drawingLogo: string | null;
  drawingAuthor: string;
  drawingVersion: string;
}

export interface LayerItem {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: string;
  lineWeightPt?: number;
  lineStyle?: LayerLineStyle;
}

export interface FixtureGroup {
  id: string;
  name: string;
  color: string;
}

export interface LightingSnapshot {
  id: string;
  name: string;
  description: string;
  fixtureStates: Record<
    string,
    {
      intensity: number;
      color: string;
      pan: number;
      tilt: number;
      beamAngle: number;
    }
  >;
}

export interface CameraPreset {
  id: string;
  name: string;
  projection: ProjectionType;
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

export interface GdtfLibraryMode {
  name: string;
  channels: number;
  default?: boolean;
}

/** Lightweight index entry for a real .gdtf archive in public/gdtf-library. */
export interface GdtfLibraryEntry {
  id: string;
  name: string;
  manufacturer: string;
  description: string;
  category: string;
  modes: GdtfLibraryMode[];
  defaultMode: string | null;
  file: string | null;
  image: string | null;
  beamAngle: string | null;
}

/** Lightweight index entry for a packaged SketchUp/GLB truss model. */
export interface SkpLibraryEntry {
  id: string;
  name: string;
  manufacturer: 'Eurotruss' | 'Prolyte' | 'Alutruss' | 'Milos';
  folder: string;
  fileName: string;
  sourceUrl: string;
  fileSize: number;
  /** Real GLB bounds in meters, normalized so X is the long axis. */
  dimensions: [number, number, number];
  sectionWidth: number;
  sectionHeight: number;
  /** Local-space connector endpoints, normalized to the local X axis. */
  endpoints: Array<[number, number, number]>;
  connectorSeries?: string;
}

export interface SkpLibraryCatalog {
  version: number;
  generatedAt: string;
  entries: SkpLibraryEntry[];
}

export interface LibraryCatalogItem {
  id: string;
  kind: ObjectKind;
  name: string;
  manufacturer: string;
  folder: string;
  libraryCategory: LibraryCategory;
  filterTags: string[];
  dmxFootprint?: number;
  defaultColor?: string;
  defaultBeamAngle?: number;
  defaultHeight: number;
  defaultLength?: number;
  defaultWidth?: number;
  subType?: string;
  materialPreset?: string;
  goboName?: string;
  builtInGroup?: BuiltInGroup;
  builtInIcon?: string;
  description: string;
}

/** Serializable core of a project document, shared by legacy JSON and .kptr files. */
export interface ProjectDocument {
  version: number;
  metadata: ProjectMetadata;
  objects: SceneObject[];
  layers: LayerItem[];
  viewports: Record<ViewportId, ViewportSettings>;
  snapshots: LightingSnapshot[];
  cameraPresets: CameraPreset[];
}
