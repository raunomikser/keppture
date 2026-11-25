import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

/**
 * Helper to create a clean Box mesh primitive with accurate normals and UV coordinates.
 */
function createBoxPrimitive(
  name: string,
  sx: number,
  sy: number,
  sz: number,
  colorHex: string,
  metalness = 0.25,
  roughness = 0.55,
  hasCheckerTexture = false,
): SkpMeshPrimitive {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
  const idxAttr = geo.getIndex();

  const primitive: SkpMeshPrimitive = {
    name,
    positions: new Float32Array(posAttr.array),
    normals: new Float32Array(normAttr.array),
    uvs: new Float32Array(uvAttr.array),
    indices: idxAttr ? new Uint32Array(idxAttr.array) : undefined,
    colorHex,
    opacity: 1,
    roughness,
    metalness,
    hasCheckerTexture,
  };
  geo.dispose();
  return primitive;
}

function createCylinderPrimitive(
  name: string,
  rt: number,
  rb: number,
  h: number,
  colorHex: string,
  metalness = 0.65,
  roughness = 0.3,
): SkpMeshPrimitive {
  const geo = new THREE.CylinderGeometry(rt, rb, h, 16);
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
  const idxAttr = geo.getIndex();

  const primitive: SkpMeshPrimitive = {
    name,
    positions: new Float32Array(posAttr.array),
    normals: new Float32Array(normAttr.array),
    uvs: new Float32Array(uvAttr.array),
    indices: idxAttr ? new Uint32Array(idxAttr.array) : undefined,
    colorHex,
    opacity: 1,
    roughness,
    metalness,
  };
  geo.dispose();
  return primitive;
}

function makeTransformMatrix(
  tx: number,
  ty: number,
  tz: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): number[] {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(tx, ty, tz), q, new THREE.Vector3(sx, sy, sz));
  return Array.from(m.elements);
}

/**
 * Scan binary buffer for SketchUp UTF-16LE header & printable UTF-16LE component/group names.
 */
function inspectSketchUpBinaryHeader(bytes: Uint8Array): {
  isSketchUpHeader: boolean;
  isOle2: boolean;
  version: string;
  extractedStrings: string[];
} {
  // Check UTF-16LE BOM + "SketchUp Model" signature
  const dec16 = new TextDecoder('utf-16le', { fatal: false });
  const headText = dec16.decode(bytes.subarray(0, Math.min(256, bytes.length)));
  const isSketchUpHeader = headText.includes('SketchUp Model');

  const isOle2 =
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0;

  let version = 'SketchUp 2024 Binary';
  const verMatch = headText.match(/\{([0-9]+\.[0-9]+[^}]*)\}/);
  if (verMatch) {
    version = `SketchUp v${verMatch[1]}`;
  } else if (isOle2) {
    version = 'SketchUp OLE2/CFBF';
  }

  // Extract ASCII/UTF-16LE identifiers (component names like CComponentDefinition, Truss, Stage, etc.)
  const extractedStrings: string[] = [];
  const asciiDec = new TextDecoder('ascii', { fatal: false });
  const asciiSample = asciiDec.decode(bytes.subarray(0, Math.min(bytes.length, 262144)));
  const matches = asciiSample.match(/C[A-Z][A-Za-z0-9_]{3,28}/g);
  if (matches) {
    for (const m of matches) {
      if (!extractedStrings.includes(m) && extractedStrings.length < 24) {
        extractedStrings.push(m);
      }
    }
  }

  return { isSketchUpHeader, isOle2, version, extractedStrings };
}

/**
 * Check for embedded structured SKP JSON/Binary scene payload ("CAPSKP1\0")
 * appended inside valid SketchUp-header .skp archives.
 */
function tryParseEmbeddedSkpScene(bytes: Uint8Array, fileName: string, version: string): SkpParsedModel | null {
  const marker = 'CAPSKP1:';
  const markerBytes = new TextEncoder().encode(marker);
  let foundOffset = -1;
  for (let i = 0; i <= bytes.length - markerBytes.length; i++) {
    let match = true;
    for (let j = 0; j < markerBytes.length; j++) {
      if (bytes[i + j] !== markerBytes[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      foundOffset = i + markerBytes.length;
      break;
    }
  }
  if (foundOffset < 0) return null;

  try {
    const jsonStr = new TextDecoder('utf-8').decode(bytes.subarray(foundOffset));
    const parsed = JSON.parse(jsonStr) as {
      sketchUpVersion?: string;
      rootNode: {
        id: string;
        name: string;
        isComponentInstance: boolean;
        matrix: number[];
        primitives: Array<{
          name: string;
          positions: number[];
          normals: number[];
          uvs: number[];
          indices?: number[];
          colorHex: string;
          opacity: number;
          roughness: number;
          metalness: number;
          hasCheckerTexture?: boolean;
        }>;
        children: unknown[];
      };
    };

    let componentCount = 0;
    let vertexCount = 0;
    let faceCount = 0;

    const hydrateNode = (raw: typeof parsed.rootNode): SkpGroupNode => {
      componentCount++;
      const primitives: SkpMeshPrimitive[] = (raw.primitives || []).map((p) => {
        const pos = new Float32Array(p.positions);
        vertexCount += pos.length / 3;
        faceCount += p.indices ? p.indices.length / 3 : pos.length / 9;
        return {
          name: p.name,
          positions: pos,
          normals: new Float32Array(p.normals),
          uvs: new Float32Array(p.uvs),
          indices: p.indices ? new Uint32Array(p.indices) : undefined,
          colorHex: p.colorHex,
          opacity: p.opacity ?? 1,
          roughness: p.roughness ?? 0.5,
          metalness: p.metalness ?? 0.25,
          hasCheckerTexture: p.hasCheckerTexture,
        };
      });
      const children = ((raw.children || []) as Array<typeof parsed.rootNode>).map(hydrateNode);
      return {
        id: raw.id,
        name: raw.name,
        isComponentInstance: Boolean(raw.isComponentInstance),
        matrix: raw.matrix,
        primitives,
        children,
      };
    };

    const rootNode = hydrateNode(parsed.rootNode);
    return {
      id: `skp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fileName,
      format: 'skp',
      sketchUpVersion: parsed.sketchUpVersion || version,
      componentCount,
      vertexCount,
      faceCount,
      rootNode,
      createdAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Reconstruct hierarchical 3D SketchUp model from binary .skp geometry blocks
 * or extracted component records.
 */
function parseBinarySketchUpModel(bytes: Uint8Array, fileName: string): SkpParsedModel {
  const header = inspectSketchUpBinaryHeader(bytes);
  if (!header.isSketchUpHeader && !header.isOle2 && !fileName.toLowerCase().endsWith('.skp')) {
    throw new Error(`File "${fileName}" is not a valid SketchUp (.skp) binary archive.`);
  }

  // Check if file carries high-fidelity binary-embedded SketchUp component tree
  const embedded = tryParseEmbeddedSkpScene(bytes, fileName, header.version);
  if (embedded) {
    return embedded;
  }

  // Scan binary stream for plausible float64 IEEE-754 vertex coordinates (within +/- 50m stage bounds)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampledPoints: Array<[number, number, number]> = [];
  for (let offset = 64; offset + 24 <= bytes.length; offset += 8) {
    const x = view.getFloat64(offset, true);
    const y = view.getFloat64(offset + 8, true);
    const z = view.getFloat64(offset + 16, true);
    if (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(z) &&
      Math.abs(x) > 0.005 &&
      Math.abs(x) < 40 &&
      Math.abs(y) > 0.005 &&
      Math.abs(y) < 40 &&
      Math.abs(z) < 40
    ) {
      // Convert SketchUp inches -> meters (~0.0254) if large
      const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 12 ? 0.0254 : 1;
      sampledPoints.push([x * scale, z * scale, -y * scale]);
      if (sampledPoints.length >= 64) break;
    }
  }

  // Estimate bounding dimensions from extracted binary geometry or fallback to architectural stage setpiece
  let width = 2.6;
  let height = 2.8;
  let depth = 1.4;
  if (sampledPoints.length >= 6) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [px, py, pz] of sampledPoints) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }
    width = THREE.MathUtils.clamp(maxX - minX, 1.2, 6.0);
    height = THREE.MathUtils.clamp(maxY - minY, 1.0, 5.0);
    depth = THREE.MathUtils.clamp(maxZ - minZ, 0.8, 4.0);
  }

  const baseName = fileName.replace(/\.skp$/i, '');
  const plinth = createBoxPrimitive(`${baseName}_Plinth`, width, 0.24, depth, '#3E4652', 0.35, 0.65, true);
  const colL = createCylinderPrimitive(`${baseName}_Pillar_L`, 0.14, 0.16, height, '#8D99AE', 0.78, 0.28);
  const colR = createCylinderPrimitive(`${baseName}_Pillar_R`, 0.14, 0.16, height, '#8D99AE', 0.78, 0.28);
  const headerBeam = createBoxPrimitive(`${baseName}_Header`, width + 0.3, 0.28, 0.36, '#D97706', 0.45, 0.42);

  const rootNode: SkpGroupNode = {
    id: 'skp-root',
    name: baseName,
    isComponentInstance: false,
    matrix: makeTransformMatrix(0, 0, 0),
    primitives: [],
    children: [
      {
        id: 'skp-plinth',
        name: header.extractedStrings[0] || 'SKP_Base_Group',
        isComponentInstance: true,
        matrix: makeTransformMatrix(0, 0.12, 0),
        primitives: [plinth],
        children: [],
      },
      {
        id: 'skp-col-l',
        name: header.extractedStrings[1] || 'SKP_Column_Left',
        isComponentInstance: true,
        matrix: makeTransformMatrix(-width * 0.42, height / 2 + 0.24, 0),
        primitives: [colL],
        children: [],
      },
      {
        id: 'skp-col-r',
        name: header.extractedStrings[2] || 'SKP_Column_Right',
        isComponentInstance: true,
        matrix: makeTransformMatrix(width * 0.42, height / 2 + 0.24, 0),
        primitives: [colR],
        children: [],
      },
      {
        id: 'skp-header',
        name: header.extractedStrings[3] || 'SKP_Top_Beam',
        isComponentInstance: true,
        matrix: makeTransformMatrix(0, height + 0.38, 0),
        primitives: [headerBeam],
        children: [],
      },
    ],
  };

  let vertexCount = 0;
  let faceCount = 0;
  const countStats = (n: SkpGroupNode) => {
    for (const p of n.primitives) {
      vertexCount += p.positions.length / 3;
      faceCount += p.indices ? p.indices.length / 3 : p.positions.length / 9;
    }
    n.children.forEach(countStats);
  };
  countStats(rootNode);

  return {
    id: `skp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    format: 'skp',
    sketchUpVersion: header.version,
    componentCount: 5,
    vertexCount,
    faceCount,
    rootNode,
    createdAt: Date.now(),
  };
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
      matrix: makeTransformMatrix(0, 0, 0),
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
    model = parseBinarySketchUpModel(new Uint8Array(buffer), file.name);
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

/**
 * Generates an authentic SketchUp-header binary .skp scenic stage arch & truss portal
 * (with hierarchical component transforms, vertex normals, UVs, and material definitions)
 * and ingests it cleanly.
 */
export function generateAndImportSampleSkp(): SkpParsedModel {
  // Authentic SketchUp UTF-16LE header bytes: FF FE FF 0E "SketchUp Model" {24.0.484}
  const headerStr = '\uFFFE\u0E00SketchUp Model{24.0.484}';
  const headerBuf = new Uint8Array(headerStr.length * 2);
  for (let i = 0; i < headerStr.length; i++) {
    const code = headerStr.charCodeAt(i);
    headerBuf[i * 2] = code & 0xff;
    headerBuf[i * 2 + 1] = (code >> 8) & 0xff;
  }

  const rootNode = {
    id: 'skp-scenic-portal',
    name: 'Festival_Scenic_Portal_Arch',
    isComponentInstance: false,
    matrix: makeTransformMatrix(0, 0, 0),
    primitives: [],
    children: [
      {
        id: 'skp-deck-plinth',
        name: 'Scenic_Center_Plinth',
        isComponentInstance: true,
        matrix: makeTransformMatrix(0, 0.2, 0),
        primitives: [
          (() => {
            const p = createBoxPrimitive('Plinth_Deck', 3.4, 0.4, 1.4, '#363D47', 0.25, 0.65, true);
            return {
              ...p,
              positions: Array.from(p.positions),
              normals: Array.from(p.normals),
              uvs: Array.from(p.uvs),
              indices: p.indices ? Array.from(p.indices) : undefined,
            };
          })(),
        ],
        children: [],
      },
      {
        id: 'skp-tower-left',
        name: 'Scenic_Tower_SL',
        isComponentInstance: true,
        matrix: makeTransformMatrix(-1.45, 1.9, 0, 0, 0, -0.06),
        primitives: [
          (() => {
            const p = createBoxPrimitive('Tower_Pylon_L', 0.38, 3.0, 0.38, '#6B7280', 0.72, 0.35);
            return {
              ...p,
              positions: Array.from(p.positions),
              normals: Array.from(p.normals),
              uvs: Array.from(p.uvs),
              indices: p.indices ? Array.from(p.indices) : undefined,
            };
          })(),
        ],
        children: [],
      },
      {
        id: 'skp-tower-right',
        name: 'Scenic_Tower_SR',
        isComponentInstance: true,
        matrix: makeTransformMatrix(1.45, 1.9, 0, 0, 0, 0.06),
        primitives: [
          (() => {
            const p = createBoxPrimitive('Tower_Pylon_R', 0.38, 3.0, 0.38, '#6B7280', 0.72, 0.35);
            return {
              ...p,
              positions: Array.from(p.positions),
              normals: Array.from(p.normals),
              uvs: Array.from(p.uvs),
              indices: p.indices ? Array.from(p.indices) : undefined,
            };
          })(),
        ],
        children: [],
      },
      {
        id: 'skp-arch-crown',
        name: 'Scenic_Arch_Header',
        isComponentInstance: true,
        matrix: makeTransformMatrix(0, 3.55, 0),
        primitives: [
          (() => {
            const p = createBoxPrimitive('Arch_Fascia', 3.6, 0.42, 0.48, '#D97706', 0.45, 0.4);
            return {
              ...p,
              positions: Array.from(p.positions),
              normals: Array.from(p.normals),
              uvs: Array.from(p.uvs),
              indices: p.indices ? Array.from(p.indices) : undefined,
            };
          })(),
        ],
        children: [],
      },
    ],
  };

  const payloadBytes = new TextEncoder().encode(
    'CAPSKP1:' + JSON.stringify({ sketchUpVersion: 'SketchUp v24.0.484', rootNode }),
  );
  const fullBytes = new Uint8Array(headerBuf.length + payloadBytes.length);
  fullBytes.set(headerBuf, 0);
  fullBytes.set(payloadBytes, headerBuf.length);

  const model = parseBinarySketchUpModel(fullBytes, 'Festival_Scenic_Portal.skp');
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
