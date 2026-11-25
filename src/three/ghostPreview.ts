import * as THREE from 'three';
import { ObjectKind, SceneObject } from '../types/visualizer';

export interface TransformGhostItem {
  id: string;
  kind: ObjectKind;
  startPos: [number, number, number];
  currentPos: [number, number, number];
  rotation: [number, number, number];
  boxSize: [number, number, number];
  boxOffsetY: number;
}

export function computeGhostBoxMetrics(obj: SceneObject): {
  boxSize: [number, number, number];
  boxOffsetY: number;
} {
  switch (obj.kind) {
    case 'smoke-volume':
      return {
        boxSize: [
          Math.max(1, obj.smokeWidth ?? 16),
          Math.max(1, obj.smokeHeight ?? 7),
          Math.max(1, obj.smokeDepth ?? 12),
        ],
        boxOffsetY: 0,
      };
    case 'truss':
      return {
        boxSize: [
          Math.max(0.5, obj.length ?? 4.0),
          Math.max(0.2, obj.sectionHeight ?? 0.29) + 0.06,
          Math.max(0.2, obj.sectionWidth ?? 0.29) + 0.06,
        ],
        boxOffsetY: 0,
      };
    case 'stage-deck':
      return {
        boxSize: [Math.max(0.5, obj.length ?? 2.0), 0.38, Math.max(0.5, obj.width ?? 2.0)],
        boxOffsetY: 0.19,
      };
    case 'led-par':
      return {
        boxSize: [0.3, 0.32, 0.3],
        boxOffsetY: -0.14,
      };
    case 'moving-head':
    case 'gdtf-fixture':
      return {
        boxSize: [0.42, 0.56, 0.38],
        boxOffsetY: -0.24,
      };
    case 'co2-jet':
    case 'flame-jet':
      return {
        boxSize: [0.4, 0.52, 0.4],
        boxOffsetY: 0.26,
      };
    default:
      return {
        boxSize: [
          Math.max(0.4, obj.length ?? 1.0),
          Math.max(0.4, obj.sectionHeight ?? 1.0),
          Math.max(0.4, obj.width ?? 1.0),
        ],
        boxOffsetY: 0,
      };
  }
}

/**
 * Builds transient source-position wireframe ghost outlines + dashed movement tethers.
 * Strictly tagged with `userData.isSelectionHelper = true` and removed immediately on drop or ESC abort.
 */
export function buildMoveGhostGroup(items: TransformGhostItem[]): THREE.Group {
  const root = new THREE.Group();
  root.name = 'move-ghost-preview';
  root.renderOrder = 22;

  for (const item of items) {
    const itemGroup = new THREE.Group();
    itemGroup.position.set(item.startPos[0], item.startPos[1], item.startPos[2]);
    itemGroup.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2]);
    itemGroup.userData.isSelectionHelper = true;

    const [bw, bh, bd] = item.boxSize;
    const boxGeo = new THREE.BoxGeometry(bw, bh, bd);
    const edgesGeo = new THREE.EdgesGeometry(boxGeo, 1);
    boxGeo.dispose();

    const outlineMat = new THREE.LineDashedMaterial({
      color: 0x5ac8fa,
      dashSize: 0.18,
      gapSize: 0.1,
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      toneMapped: false,
    });
    const outline = new THREE.LineSegments(edgesGeo, outlineMat);
    outline.position.set(0, item.boxOffsetY, 0);
    outline.computeLineDistances();
    outline.renderOrder = 22;
    outline.userData.isSelectionHelper = true;
    itemGroup.add(outline);

    // Subtle semi-transparent fill cue at source position
    const fillGeo = new THREE.BoxGeometry(bw, bh, bd);
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x5ac8fa,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
      toneMapped: false,
    });
    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    fillMesh.position.set(0, item.boxOffsetY, 0);
    fillMesh.renderOrder = 21;
    fillMesh.userData.isSelectionHelper = true;
    itemGroup.add(fillMesh);

    root.add(itemGroup);

    // Dashed world-space tether from original origin to live dragged position
    const dist = Math.hypot(
      item.currentPos[0] - item.startPos[0],
      item.currentPos[1] - item.startPos[1],
      item.currentPos[2] - item.startPos[2],
    );
    if (dist > 0.02) {
      const tetherGeo = new THREE.BufferGeometry();
      tetherGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [
            item.startPos[0],
            item.startPos[1],
            item.startPos[2],
            item.currentPos[0],
            item.currentPos[1],
            item.currentPos[2],
          ],
          3,
        ),
      );
      const tetherMat = new THREE.LineDashedMaterial({
        color: 0xffd60a,
        dashSize: 0.14,
        gapSize: 0.09,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        toneMapped: false,
      });
      const tether = new THREE.Line(tetherGeo, tetherMat);
      tether.computeLineDistances();
      tether.renderOrder = 23;
      tether.userData.isSelectionHelper = true;
      root.add(tether);
    }
  }

  return root;
}
