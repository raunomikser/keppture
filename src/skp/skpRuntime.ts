import * as THREE from 'three';
import {
  attachSelectionBoundingBox,
  createStyledLineSegments,
  getSharedStageTexture,
  resolveEffectiveStyle,
  ViewportRenderStyleOptions,
} from '../three/fixtureFactory';
import { buildCaptureMeshMaterial } from '../three/materialsLibrary';
import { SceneObject } from '../types/visualizer';
import { getSkpModel, SkpGroupNode, SkpMeshPrimitive } from './skpParser';

const SELECTED_COLOR = 0xff3b30;
const textureCache = new Map<string, THREE.Texture>();

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function getSkpTexture(prim: SkpMeshPrimitive): THREE.Texture | null {
  if (!prim.textureData) {
    return prim.hasCheckerTexture ? getSharedStageTexture() : null;
  }
  const mimeType = prim.textureMimeType ?? 'image/png';
  const key = `${mimeType}:${prim.textureData}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const texture = new THREE.TextureLoader().load(`data:${mimeType};base64,${prim.textureData}`);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  textureCache.set(key, texture);
  return texture;
}

function buildSkpNodeGroup(
  node: SkpGroupNode,
  parent: THREE.Object3D,
  styleOpts: ViewportRenderStyleOptions,
  isSelected: boolean,
  castsShadows: boolean,
  materialPreset?: string,
): void {
  const resolved = resolveEffectiveStyle(styleOpts);
  const group = new THREE.Group();
  group.name = node.name;
  _mat4.fromArray(node.matrix);
  _mat4.decompose(_pos, _quat, _scale);
  group.position.copy(_pos);
  group.quaternion.copy(_quat);
  group.scale.copy(_scale);
  parent.add(group);

  for (const prim of node.primitives) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(prim.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(prim.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(prim.uvs, 2));
    if (prim.indices) {
      geo.setIndex(new THREE.BufferAttribute(prim.indices, 1));
    }

    let mat: THREE.Material;
    if (resolved.baseMode === 'wireframe') {
      mat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
    } else if (resolved.baseMode === 'plot') {
      mat = new THREE.MeshBasicMaterial({
        color: isSelected ? 0xfde2e0 : resolved.plotFillHex,
        toneMapped: false,
      });
    } else if (materialPreset) {
      mat = buildCaptureMeshMaterial(
        materialPreset,
        {
          color: new THREE.Color(prim.colorHex).getHex(),
          roughness: prim.roughness,
          metalness: prim.metalness,
        },
        2,
        2,
        isSelected,
      );
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x8b2c25 : new THREE.Color(prim.colorHex),
        map: getSkpTexture(prim),
        roughness: prim.roughness,
        metalness: prim.metalness,
        transparent: prim.opacity < 0.99 || prim.alphaMode === 'BLEND',
        opacity: prim.opacity,
        alphaTest: prim.alphaMode === 'MASK' ? 0.5 : 0,
        side: prim.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      });
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = prim.name;
    mesh.castShadow = resolved.baseMode === 'live' && castsShadows;
    mesh.receiveShadow = resolved.baseMode === 'live';
    group.add(mesh);

    if (resolved.showEdges || isSelected) {
      const edges = new THREE.EdgesGeometry(geo, 22);
      const lines = createStyledLineSegments(
        edges,
        isSelected ? SELECTED_COLOR : resolved.strokeColorHex,
        resolved.baseMode === 'plot' ? resolved.lineStyle : 'Solid',
        resolved.baseMode === 'plot' ? resolved.lineWeightPt : 0.75,
      );
      mesh.add(lines);
    }
  }

  for (const child of node.children) {
    buildSkpNodeGroup(child, group, styleOpts, isSelected, castsShadows, materialPreset);
  }
}

export function buildSkpSceneObjectGroup(
  obj: SceneObject,
  styleOpts: ViewportRenderStyleOptions,
  isSelected: boolean,
): THREE.Group {
  const resolved = resolveEffectiveStyle(styleOpts);
  const castsShadows = obj.castsShadows ?? true;
  const root = new THREE.Group();
  root.name = obj.id;
  root.userData.objectId = obj.id;
  root.position.set(obj.position[0], obj.position[1], obj.position[2]);
  root.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);
  if (obj.scale) {
    root.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
  }

  const model = getSkpModel(obj.skpModelId);
  if (model) {
    buildSkpNodeGroup(model.rootNode, root, styleOpts, isSelected, castsShadows, obj.materialPreset);
  } else {
    // Fallback architectural placeholder if model was loaded from saved JSON without binary buffer
    const geo = new THREE.BoxGeometry(2.0, 2.0, 1.2);
    const mat =
      resolved.baseMode === 'wireframe'
        ? new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
        : resolved.baseMode === 'plot'
          ? new THREE.MeshBasicMaterial({
              color: isSelected ? 0xfde2e0 : resolved.plotFillHex,
              toneMapped: false,
            })
          : buildCaptureMeshMaterial(
              obj.materialPreset,
              { color: 0x4b5563, roughness: 0.6, metalness: 0.1 },
              2,
              2,
              isSelected,
            );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 1.0, 0);
    mesh.castShadow = resolved.baseMode === 'live' && castsShadows;
    mesh.receiveShadow = resolved.baseMode === 'live';
    if (resolved.showEdges || isSelected) {
      const edges = new THREE.EdgesGeometry(geo, 22);
      mesh.add(
        createStyledLineSegments(
          edges,
          isSelected ? SELECTED_COLOR : resolved.strokeColorHex,
          resolved.baseMode === 'plot' ? resolved.lineStyle : 'Solid',
          resolved.baseMode === 'plot' ? resolved.lineWeightPt : 0.75,
        ),
      );
    }
    root.add(mesh);
  }

  if (isSelected) {
    attachSelectionBoundingBox(root);
  }

  root.traverse((child) => {
    child.userData.objectId = obj.id;
  });

  return root;
}
