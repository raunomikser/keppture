import { buildScene, parseSkp } from 'openskp';

const bytes = await Deno.readFile('.tmp-skp/chair_and_table.skp');
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const model = parseSkp(ab);
console.log('model keys', Object.keys(model));
console.log('version', (model as any).versionString ?? (model as any).header?.versionString ?? (model as any).header?.version);
const scene = buildScene(ab);
console.log('scene keys', Object.keys(scene));
console.log('bounds', scene.bounds);
console.log('primitives', scene.glbPrimitives.length);
console.log('materials', JSON.stringify(scene.gltfMaterials.slice(0, 3), null, 2));
console.log('first primitive', {
  geomName: scene.glbPrimitives[0]?.geomName,
  positions: scene.glbPrimitives[0]?.positions.length,
  indices: scene.glbPrimitives[0]?.indices.length,
  materialIndex: scene.glbPrimitives[0]?.materialIndex,
  uvs: scene.glbPrimitives[0]?.uvs.length,
  normals: scene.glbPrimitives[0]?.normals.length,
});
console.log('meshIndex first', JSON.stringify(Object.values(scene.meshIndex)[0], null, 2));
console.log('hierarchy keys', Object.keys(scene.sceneHierarchy));
console.log('hierarchy sample', JSON.stringify(scene.sceneHierarchy, (k, v) => (k === 'children' && Array.isArray(v) ? v.slice(0, 2) : v), 2).slice(0, 3000));
