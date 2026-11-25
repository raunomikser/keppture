import * as THREE from 'three';

/**
 * Builds a deliberately temporary scene-space measurement helper.
 * It is added directly to the viewport scene, never to objectsGroup, so it
 * cannot be selected, dragged, duplicated, deleted, or written to a project.
 */
export function buildDistanceMeasurementGroup(
  start: [number, number, number],
  end: [number, number, number] | null,
  preview = false,
): THREE.Group {
  const group = new THREE.Group();
  group.userData.isDistanceHelper = true;

  const color = preview ? 0xE5B769 : 0x5AC8FA;
  const a = new THREE.Vector3(start[0], start[1], start[2]);

  const addMarker = (point: THREE.Vector3) => {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 12, 8),
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    marker.position.copy(point);
    marker.renderOrder = 30;
    group.add(marker);
  };

  addMarker(a);

  if (end) {
    const b = new THREE.Vector3(end[0], end[1], end[2]);
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([a, b]);
    const lineMaterial = new THREE.LineDashedMaterial({
      color,
      dashSize: 0.18,
      gapSize: 0.12,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
    });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.computeLineDistances();
    line.renderOrder = 29;
    group.add(line);
    addMarker(b);
  }

  return group;
}
