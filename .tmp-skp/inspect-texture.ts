import { buildScene, parseSkp } from 'openskp';

const bytes = await Deno.readFile('.tmp-skp/textured.skp');
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const model = parseSkp(ab);
console.log('version', JSON.stringify((model as any).version));
const scene = buildScene(ab);
console.log('textures', scene.textures.length);
console.log('texture shape', JSON.stringify(scene.textures[0] && {
  keys: Object.keys(scene.textures[0]),
  mimeType: (scene.textures[0] as any).mimeType,
  name: (scene.textures[0] as any).name,
  dataLength: (scene.textures[0] as any).data?.length ?? (scene.textures[0] as any).bytes?.length,
}, null, 2));
console.log('materials with tex', JSON.stringify(scene.gltfMaterials.filter((m: any) => m.pbrMetallicRoughness?.baseColorTexture), null, 2));
console.log('primitive materialIndex sample', scene.glbPrimitives.map((p) => p.materialIndex));
