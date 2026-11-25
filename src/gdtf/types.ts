export interface GdtfFixtureMetadata {
  name: string;
  longName: string;
  shortName: string;
  manufacturer: string;
  description: string;
  fixtureTypeId: string;
  refFTES: string;
  thumbnail?: string;
}

export interface GdtfActivationGroup {
  name: string;
}

export interface GdtfFeatureGroup {
  name: string;
  pretty: string;
  features: Array<{ name: string }>;
}

export interface GdtfAttributeDef {
  name: string;
  pretty: string;
  activationGroup?: string;
  feature?: string;
  physicalUnit?: string;
  color?: string;
}

export interface GdtfModelDef {
  name: string;
  file?: string;
  primitiveType: string;
  length: number;
  width: number;
  height: number;
}

export interface GdtfWheelSlot {
  name: string;
  color?: string;
  mediaFileName?: string;
}

export interface GdtfWheel {
  name: string;
  slots: GdtfWheelSlot[];
}

export type GdtfGeometryType =
  | 'Geometry'
  | 'Axis'
  | 'Beam'
  | 'FilterBeam'
  | 'FilterColor'
  | 'FilterGobo'
  | 'FilterShaper'
  | 'Scanner'
  | 'Laser'
  | 'GeometryReference';

export interface GdtfGeometryNode {
  id: string;
  type: GdtfGeometryType;
  name: string;
  model?: string;
  /** 16-element column-major THREE.Matrix4 array */
  matrix: number[];
  /** Axis/Beam properties */
  beamType?: string;
  beamAngle?: number;
  fieldAngle?: number;
  beamRadius?: number;
  luminousFlux?: number;
  colorTemperature?: number;
  powerConsumption?: number;
  referencedGeometry?: string;
  children: GdtfGeometryNode[];
}

export interface GdtfChannelSet {
  name: string;
  dmxFrom: number;
  dmxTo?: number;
  physicalFrom?: number;
  physicalTo?: number;
  wheelSlotIndex?: number;
}

export interface GdtfChannelFunction {
  name: string;
  attribute: string;
  originalAttribute?: string;
  dmxFrom: number;
  dmxTo: number;
  defaultRaw: number;
  physicalFrom: number;
  physicalTo: number;
  realFade?: number;
  wheel?: string;
  modeMaster?: string;
  modeFrom?: number;
  modeTo?: number;
  channelSets: GdtfChannelSet[];
}

export interface GdtfLogicalChannel {
  attribute: string;
  snap?: string;
  master?: string;
  channelFunctions: GdtfChannelFunction[];
}

export interface GdtfDmxChannel {
  dmxBreak: number;
  /** 1-based byte offsets inside DMX mode footprint, e.g. [1] (8-bit), [1, 2] (16-bit), [1, 2, 3] (24-bit) */
  offset: number[];
  defaultRaw: number;
  initialFunction?: string;
  geometry: string;
  logicalChannels: GdtfLogicalChannel[];
}

export interface GdtfDmxMode {
  name: string;
  geometry: string;
  footprint: number;
  dmxChannels: GdtfDmxChannel[];
}

export interface GdtfVfsEntry {
  path: string;
  mimeType: string;
  size: number;
  objectUrl: string;
  data: ArrayBuffer;
}

export interface GdtfProfile {
  id: string;
  sourceFileName: string;
  metadata: GdtfFixtureMetadata;
  activationGroups: GdtfActivationGroup[];
  featureGroups: GdtfFeatureGroup[];
  attributes: Record<string, GdtfAttributeDef>;
  models: Record<string, GdtfModelDef>;
  wheels: Record<string, GdtfWheel>;
  geometries: GdtfGeometryNode[];
  dmxModes: GdtfDmxMode[];
  vfsFiles: string[];
  createdAt: number;
}

export interface ResolvedGdtfState {
  dimmer: number; // 0..1
  panDeg: number;
  tiltDeg: number;
  colorHex: string;
  beamAngleDeg: number;
  focus: number; // 0..1
  shutterOpen: boolean;
  strobeHz: number;
  goboSlotName: string;
  goboMediaFile?: string;
  zoomDeg: number;
}
