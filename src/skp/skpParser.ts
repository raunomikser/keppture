import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildScene, create, parseSkp } from 'openskp';
import type { GlbPrimitive, SkpScene } from 'openskp';

export interface SkpMeshPrimitive {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices?: Uint32Array;
  colorHex: string;
  opacity: number;
  roughness: number;
  metalness: number;
  hasCheckerTexture?: boolean;
  /** Base64 PNG/JPEG image used by the original SketchUp material. */
  textureData?: string;
  textureMimeType?: 'image/png' | 'image/jpeg';
  textureName?: string;
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  doubleSided?: boolean;
}

export interface SkpGroupNode {
  id: string;
  name: string;
  isComponentInstance: boolean;
  /** 16-element column-major THREE.Matrix4 */
  matrix: number[];
  primitives: SkpMeshPrimitive[];
  children: SkpGroupNode[];
}

export interface SkpParsedModel {
  id: string;
  fileName: string;
  format: 'skp' | 'glb' | 'gltf' | 'obj';
  sketchUpVersion: string;
  componentCount: number;
  vertexCount: number;
  faceCount: number;
  rootNode: SkpGroupNode;
  createdAt: number;
}

const skpRegistry = new Map<string, SkpParsedModel>();

export function registerSkpModel(model: SkpParsedModel): void {
  skpRegistry.set(model.id, model);
}

export function getSkpModel(id?: string): SkpParsedModel | undefined {
  if (!id) return undefined;
  return skpRegistry.get(id);
}

export function getAllSkpModels(): SkpParsedModel[] {
  return Array.from(skpRegistry.values());
}

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

interface GltfMaterialLike {
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: { index?: number };
    metallicFactor?: number;
    roughnessFactor?: number;
  };
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  doubleSided?: boolean;
}

function linearColorToHex(factor: readonly number[] | undefined): string {
  if (!factor || factor.length < 3) return '#808080';
  const color = new THREE.Color().setRGB(
    THREE.MathUtils.clamp(factor[0], 0, 1),
    THREE.MathUtils.clamp(factor[1], 0, 1),
    THREE.MathUtils.clamp(factor[2], 0, 1),
    THREE.LinearSRGBColorSpace,
  );
  return `#${color.getHexString()}`;
}

function materialProperties(
  scene: SkpScene,
  primitive: GlbPrimitive,
): Pick<
  SkpMeshPrimitive,
  | 'colorHex'
  | 'opacity'
  | 'roughness'
  | 'metalness'
  | 'textureData'
  | 'textureMimeType'
  | 'textureName'
  | 'alphaMode'
  | 'doubleSided'
> {
  const material = scene.gltfMaterials[primitive.materialIndex] as GltfMaterialLike | undefined;
  const pbr = material?.pbrMetallicRoughness;
  const opacity = pbr?.baseColorFactor?.[3] ?? 1;
  const alphaMode =
    material?.alphaMode === 'MASK' || material?.alphaMode === 'BLEND' ? material.alphaMode : 'OPAQUE';

  let textureData: string | undefined;
  let textureMimeType: 'image/png' | 'image/jpeg' | undefined;
  let textureName: string | undefined;
  const textureIndex = pbr?.baseColorTexture?.index;
  const texture = typeof textureIndex === 'number' ? scene.textures[textureIndex] : undefined;
  if (
    texture &&
    (texture.mimeType === 'image/png' || texture.mimeType === 'image/jpeg') &&
    texture.data?.length
  ) {
    textureData = bytesToBase64(texture.data);
    textureMimeType = texture.mimeType;
    textureName = texture.filename;
  }

  return {
    colorHex: linearColorToHex(pbr?.baseColorFactor),
    opacity,
    roughness: pbr?.roughnessFactor ?? 0.8,
    metalness: pbr?.metallicFactor ?? 0,
    textureData,
    textureMimeType,
    textureName,
    alphaMode,
    doubleSided: material?.doubleSided === true,
  };
}

function collectStats(node: SkpGroupNode): { vertices: number; faces: number } {
  let vertices = 0;
  let faces = 0;
  for (const prim of node.primitives) {
    vertices += prim.positions.length / 3;
    faces += prim.indices ? prim.indices.length / 3 : prim.positions.length / 9;
  }
  for (const child of node.children) {
    const childStats = collectStats(child);
    vertices += childStats.vertices;
    faces += childStats.faces;
  }
  return { vertices, faces };
}

/** Parse a real SketchUp .skp archive with openskp's native binary reader. */
export async function parseSketchUpBytes(bytes: Uint8Array, fileName: string): Promise<SkpParsedModel> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  let sketchUpVersion = 'SketchUp';
  try {
    const rawVersion = (parseSkp(buffer) as unknown as { version?: unknown }).version;
    if (typeof rawVersion === 'string' && rawVersion.trim()) {
      sketchUpVersion = rawVersion.startsWith('{') ? `SketchUp ${rawVersion}` : `SketchUp ${rawVersion}`;
    }
  } catch {
    // buildScene below reports the real parsing error with more context.
  }

  let scene: SkpScene;
  try {
    scene = buildScene(buffer);
  } catch (err) {
    throw new Error(
      `Could not read SketchUp file "${fileName}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const primitives: SkpMeshPrimitive[] = scene.glbPrimitives.map((primitive, index) => ({
    name: primitive.geomName || `${fileName}_mesh_${index}`,
    positions: new Float32Array(primitive.positions),
    normals: new Float32Array(primitive.normals),
    uvs: new Float32Array(primitive.uvs),
    indices: new Uint32Array(primitive.indices),
    ...materialProperties(scene, primitive),
  }));

  if (primitives.length === 0) {
    throw new Error(`No drawable geometry found in "${fileName}".`);
  }

  const baseName = fileName.replace(/\.skp$/i, '');
  const rootNode: SkpGroupNode = {
    id: 'skp-root',
    name: baseName,
    isComponentInstance: false,
    matrix: [...IDENTITY_MATRIX],
    primitives,
    children: [],
  };
  const stats = collectStats(rootNode);
  const componentCount = Math.max(1, Object.keys(scene.meshIndex ?? {}).length);

  return {
    id: `skp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    format: 'skp',
    sketchUpVersion,
    componentCount,
    vertexCount: stats.vertices,
    faceCount: stats.faces,
    rootNode,
    createdAt: Date.now(),
  };
}

/** Generate a real .skp file with openskp's writer and read it back through the same parser. */
export async function generateAndImportSampleSkp(): Promise<SkpParsedModel> {
  const builder = create();
  const steel = builder.addMaterial('Sample Steel', [112, 124, 136]);
  const accent = builder.addMaterial('Sample Accent', [214, 142, 44]);

  const addBox = (name: string, length: number, width: number, height: number, material: number) =>
    builder.addComponentDefinition(name, (def) => {
      def.addFace([[0, 0, 0], [length, 0, 0], [length, width, 0], [0, width, 0]], { material });
      def.addFace([[0, 0, height], [length, 0, height], [length, width, height], [0, width, height]], { material });
      def.addFace([[0, 0, 0], [length, 0, 0], [length, 0, height], [0, 0, height]], { material });
      def.addFace([[0, width, 0], [length, width, 0], [length, width, height], [0, width, height]], { material });
      def.addFace([[0, 0, 0], [0, width, 0], [0, width, height], [0, 0, height]], { material });
      def.addFace([[length, 0, 0], [length, width, 0], [length, width, height], [length, 0, height]], { material });
    });

  const beam = addBox('Sample_Truss_Beam', 48, 4, 4, steel);
  const post = addBox('Sample_Truss_Post', 4, 4, 60, steel);
  const brace = addBox('Sample_Truss_Brace', 48, 2, 2, accent);

  builder.addInstance(post, { translation: [-24, -24, 0] });
  builder.addInstance(post, { translation: [-24, 24, 0] });
  builder.addInstance(beam, { translation: [-24, -24, 60] });
  builder.addInstance(beam, { translation: [-24, 24, 60] });
  builder.addInstance(brace, { translation: [-24, -24, 28] });

  const model = await parseSketchUpBytes(builder.toBytes(), 'Sample_Truss_Portal.skp');
  registerSkpModel(model);
  return model;
}

/**
 * Parse simple Wavefront .obj text into SkpParsedModel
 */
function parseObjToSkpModel(text: string, fileName: string): SkpParsedModel {
  const verts: number[] = [];
  const uvsRaw: number[] = [];
  const positions: number[] = [];
  const uvs: number[] = [];

  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      verts.push(Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0);
    } else if (parts[0] === 'vt' && parts.length >= 3) {
      uvsRaw.push(Number(parts[1]) || 0, Number(parts[2]) || 0);
    } else if (parts[0] === 'f' && parts.length >= 4) {
      const faceTokens = parts.slice(1);
      for (let i = 1; i < faceTokens.length - 1; i++) {
        for (const tok of [faceTokens[0], faceTokens[i], faceTokens[i + 1]]) {
          const [viStr, tiStr] = tok.split('/');
          const vi = (Number(viStr) - 1) * 3;
          const ti = tiStr ? (Number(tiStr) - 1) * 2 : -1;
          positions.push(verts[vi] ?? 0, verts[vi + 1] ?? 0, verts[vi + 2] ?? 0);
          if (ti >= 0 && ti + 1 < uvsRaw.length) {
            uvs.push(uvsRaw[ti], uvsRaw[ti + 1]);
          } else {
            uvs.push(0, 0);
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;

  const prim: SkpMeshPrimitive = {
    name: fileName.replace(/\.obj$/i, ''),
    positions: new Float32Array(positions),
    normals: new Float32Array(normAttr.array),
    uvs: new Float32Array(uvs),
    colorHex: '#94A3B8',
    opacity: 1,
    roughness: 0.45,
    metalness: 0.3,
  };
  geo.dispose();

  return {
    id: `skp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    format: 'obj',
    sketchUpVersion: 'Wavefront OBJ',
    componentCount: 1,
    vertexCount: positions.length / 3,
    faceCount: positions.length / 9,
    rootNode: {
      id: 'obj-root',
      name: fileName,
      isComponentInstance: false,
      matrix: [...IDENTITY_MATRIX],
      primitives: [prim],
      children: [],
    },
    createdAt: Date.now(),
  };
}

/**
 * Parse .glb/.gltf buffer via Three.js GLTFLoader into hierarchical SkpParsedModel
 */
async function parseGltfToSkpModel(
  buffer: ArrayBuffer,
  fileName: string,
  normalizeTruss = false,
): Promise<SkpParsedModel> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, '');

  let componentCount = 0;
  let vertexCount = 0;
  let faceCount = 0;

  const convertNode = (obj: THREE.Object3D): SkpGroupNode => {
    componentCount++;
    obj.updateMatrix();
    const primitives: SkpMeshPrimitive[] = [];

    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      const geo = mesh.geometry;
      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (posAttr) {
        if (!geo.getAttribute('normal')) {
          geo.computeVertexNormals();
        }
        const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
        const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
        const idxAttr = geo.getIndex();
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const stdMat = mat as THREE.MeshStandardMaterial | undefined;
        const colorHex = stdMat?.color ? `#${stdMat.color.getHexString()}` : '#9CA3AF';

        const posArr = new Float32Array(posAttr.array);
        vertexCount += posArr.length / 3;
        faceCount += idxAttr ? idxAttr.count / 3 : posArr.length / 9;

        primitives.push({
          name: mesh.name || 'Mesh',
          positions: posArr,
          normals: new Float32Array(normAttr.array),
          uvs: uvAttr ? new Float32Array(uvAttr.array) : new Float32Array((posArr.length / 3) * 2),
          indices: idxAttr ? new Uint32Array(idxAttr.array) : undefined,
          colorHex,
          opacity: stdMat?.opacity ?? 1,
          roughness: stdMat?.roughness ?? 0.5,
          metalness: stdMat?.metalness ?? 0.25,
        });
      }
    }

    return {
      id: `node-${componentCount}`,
      name: obj.name || `Group_${componentCount}`,
      isComponentInstance: obj.children.length > 0,
      matrix: Array.from(obj.matrix.elements),
      primitives,
      children: obj.children.map(convertNode),
    };
  };

  let rootSource: THREE.Object3D = gltf.scene;
  if (normalizeTruss) {
    // Packaged truss GLBs keep the SketchUp author's origin and axis.
    // Center the real geometry and normalize its long axis to local X so
    // connector offsets from the catalog are directly usable for snapping.
    const wrapper = new THREE.Group();
    wrapper.name = 'NormalizedTruss';
    wrapper.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    if (!bounds.isEmpty()) {
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const q = new THREE.Quaternion();
      if (size.z > size.x && size.z > size.y) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      } else if (size.y > size.x && size.y > size.z) {
        q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
      }
      wrapper.quaternion.copy(q);
      wrapper.position.copy(center.applyQuaternion(q).negate());
      wrapper.updateMatrix();
      rootSource = wrapper;
    }
  }

  const rootNode = convertNode(rootSource);
  return {
    id: `skp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    format: fileName.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf',
    sketchUpVersion: 'glTF 2.0 Scene',
    componentCount,
    vertexCount,
    faceCount,
    rootNode,
    createdAt: Date.now(),
  };
}

/**
 * Unified client-side 3D model ingestion pipeline (.skp, .glb, .gltf, .obj).
 */
export async function ingestModelFile(
  file: File,
  options: { normalizeTruss?: boolean } = {},
): Promise<SkpParsedModel> {
  const lower = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();

  let model: SkpParsedModel;
  if (lower.endsWith('.skp')) {
    model = await parseSketchUpBytes(new Uint8Array(buffer), file.name);
  } else if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
    model = await parseGltfToSkpModel(buffer, file.name, options.normalizeTruss);
  } else if (lower.endsWith('.obj')) {
    const text = new TextDecoder('utf-8').decode(buffer);
    model = parseObjToSkpModel(text, file.name);
  } else {
    throw new Error(`Unsupported 3D model format "${file.name}". Supported: .skp, .glb, .gltf, .obj`);
  }

  registerSkpModel(model);
  return model;
}

/* === .kptr serialization helpers ===================================== */

export interface SerializedSkpPrimitive {
  name: string;
  /** base64-encoded little-endian Float32/Uint32 buffers */
  positions: string;
  normals: string;
  uvs: string;
  indices?: string;
  colorHex: string;
  opacity: number;
  roughness: number;
  metalness: number;
  hasCheckerTexture?: boolean;
  textureData?: string;
  textureMimeType?: 'image/png' | 'image/jpeg';
  textureName?: string;
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  doubleSided?: boolean;
}

export interface SerializedSkpGroupNode {
  id: string;
  name: string;
  isComponentInstance: boolean;
  matrix: number[];
  primitives: SerializedSkpPrimitive[];
  children: SerializedSkpGroupNode[];
}

export interface SerializedSkpModel {
  encoding: 'kptr-skp-v1';
  id: string;
  fileName: string;
  format: SkpParsedModel['format'];
  sketchUpVersion: string;
  componentCount: number;
  vertexCount: number;
  faceCount: number;
  rootNode: SerializedSkpGroupNode;
  createdAt: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function viewToBase64(view: ArrayBufferView): string {
  return bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function base64ToFloat32(value: string): Float32Array {
  const bytes = base64ToBytes(value);
  const aligned = new Uint8Array(bytes.byteLength);
  aligned.set(bytes);
  return new Float32Array(aligned.buffer);
}

function base64ToUint32(value: string): Uint32Array {
  const bytes = base64ToBytes(value);
  const aligned = new Uint8Array(bytes.byteLength);
  aligned.set(bytes);
  return new Uint32Array(aligned.buffer);
}

function serializeNode(node: SkpGroupNode): SerializedSkpGroupNode {
  return {
    id: node.id,
    name: node.name,
    isComponentInstance: node.isComponentInstance,
    matrix: [...node.matrix],
    primitives: node.primitives.map((p) => ({
      name: p.name,
      positions: viewToBase64(p.positions),
      normals: viewToBase64(p.normals),
      uvs: viewToBase64(p.uvs),
      indices: p.indices ? viewToBase64(p.indices) : undefined,
      colorHex: p.colorHex,
      opacity: p.opacity,
      roughness: p.roughness,
      metalness: p.metalness,
      hasCheckerTexture: p.hasCheckerTexture,
      textureData: p.textureData,
      textureMimeType: p.textureMimeType,
      textureName: p.textureName,
      alphaMode: p.alphaMode,
      doubleSided: p.doubleSided,
    })),
    children: node.children.map(serializeNode),
  };
}

function deserializeNode(node: SerializedSkpGroupNode): SkpGroupNode {
  return {
    id: node.id,
    name: node.name,
    isComponentInstance: node.isComponentInstance,
    matrix: [...node.matrix],
    primitives: node.primitives.map((p) => ({
      name: p.name,
      positions: base64ToFloat32(p.positions),
      normals: base64ToFloat32(p.normals),
      uvs: base64ToFloat32(p.uvs),
      indices: p.indices ? base64ToUint32(p.indices) : undefined,
      colorHex: p.colorHex,
      opacity: p.opacity,
      roughness: p.roughness,
      metalness: p.metalness,
      hasCheckerTexture: p.hasCheckerTexture,
      textureData: p.textureData,
      textureMimeType: p.textureMimeType,
      textureName: p.textureName,
      alphaMode: p.alphaMode,
      doubleSided: p.doubleSided,
    })),
    children: node.children.map(deserializeNode),
  };
}

export function serializeSkpModel(model: SkpParsedModel): SerializedSkpModel {
  return {
    encoding: 'kptr-skp-v1',
    id: model.id,
    fileName: model.fileName,
    format: model.format,
    sketchUpVersion: model.sketchUpVersion,
    componentCount: model.componentCount,
    vertexCount: model.vertexCount,
    faceCount: model.faceCount,
    rootNode: serializeNode(model.rootNode),
    createdAt: model.createdAt,
  };
}

export function deserializeSkpModel(raw: SerializedSkpModel): SkpParsedModel {
  if (raw.encoding !== 'kptr-skp-v1') {
    throw new Error(`Unsupported SKP encoding: ${String(raw.encoding)}`);
  }
  return {
    id: raw.id,
    fileName: raw.fileName,
    format: raw.format,
    sketchUpVersion: raw.sketchUpVersion,
    componentCount: raw.componentCount,
    vertexCount: raw.vertexCount,
    faceCount: raw.faceCount,
    rootNode: deserializeNode(raw.rootNode),
    createdAt: raw.createdAt,
  };
}
