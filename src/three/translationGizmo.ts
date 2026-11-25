import * as THREE from 'three';

export type GizmoAxis = 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz';

const AXIS_COLORS: Record<'x' | 'y' | 'z', number> = {
  x: 0xff3b30,
  y: 0x34c759,
  z: 0x0a84ff,
};

const ACTIVE_COLOR = 0xffd60a;

function createGizmoMat(color: number, opacity = 0.98): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

export function buildTranslationGizmoGroup(activeAxis: GizmoAxis | null = null): THREE.Group {
  const root = new THREE.Group();
  root.name = 'translation-gizmo';
  root.renderOrder = 25;

  const shaftLen = 1.05;
  const coneLen = 0.28;
  const shaftR = 0.028;
  const coneR = 0.082;
  const hitR = 0.14;

  const axes: Array<{
    axis: 'x' | 'y' | 'z';
    dir: THREE.Vector3;
    rot: THREE.Euler;
  }> = [
    { axis: 'x', dir: new THREE.Vector3(1, 0, 0), rot: new THREE.Euler(0, 0, -Math.PI / 2) },
    { axis: 'y', dir: new THREE.Vector3(0, 1, 0), rot: new THREE.Euler(0, 0, 0) },
    { axis: 'z', dir: new THREE.Vector3(0, 0, 1), rot: new THREE.Euler(Math.PI / 2, 0, 0) },
  ];

  for (const { axis, rot } of axes) {
    const isActive = activeAxis === axis;
    const color = isActive ? ACTIVE_COLOR : AXIS_COLORS[axis];
    const axisGrp = new THREE.Group();
    axisGrp.rotation.copy(rot);
    axisGrp.userData.gizmoAxis = axis;

    const shaftGeo = new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 10);
    const shaft = new THREE.Mesh(shaftGeo, createGizmoMat(color));
    shaft.position.set(0, shaftLen * 0.5, 0);
    shaft.renderOrder = 26;
    shaft.userData.gizmoAxis = axis;
    axisGrp.add(shaft);

    const coneGeo = new THREE.ConeGeometry(coneR, coneLen, 12);
    const cone = new THREE.Mesh(coneGeo, createGizmoMat(color));
    cone.position.set(0, shaftLen + coneLen * 0.5, 0);
    cone.renderOrder = 26;
    cone.userData.gizmoAxis = axis;
    axisGrp.add(cone);

    // Invisible generous hit-cylinder for effortless pointer grabbing
    const hitGeo = new THREE.CylinderGeometry(hitR, hitR, shaftLen + coneLen + 0.15, 8);
    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
    });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.set(0, (shaftLen + coneLen) * 0.5, 0);
    hitMesh.userData.gizmoAxis = axis;
    axisGrp.add(hitMesh);

    root.add(axisGrp);
  }

  // Planar 2-axis handles (XY, XZ, YZ)
  const planes: Array<{
    axis: 'xy' | 'xz' | 'yz';
    pos: [number, number, number];
    rot: [number, number, number];
    color: number;
  }> = [
    { axis: 'xy', pos: [0.36, 0.36, 0], rot: [0, 0, 0], color: 0x0a84ff },
    { axis: 'xz', pos: [0.36, 0, 0.36], rot: [Math.PI / 2, 0, 0], color: 0x34c759 },
    { axis: 'yz', pos: [0, 0.36, 0.36], rot: [0, Math.PI / 2, 0], color: 0xff3b30 },
  ];

  const planeGeo = new THREE.PlaneGeometry(0.24, 0.24);
  for (const p of planes) {
    const isActive = activeAxis === p.axis;
    const mesh = new THREE.Mesh(
      planeGeo,
      createGizmoMat(isActive ? ACTIVE_COLOR : p.color, isActive ? 0.72 : 0.38),
    );
    mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    mesh.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    mesh.renderOrder = 25;
    mesh.userData.gizmoAxis = p.axis;
    root.add(mesh);
  }

  // Center hub
  const hubGeo = new THREE.SphereGeometry(0.085, 12, 12);
  const hub = new THREE.Mesh(hubGeo, createGizmoMat(0xffffff, 0.95));
  hub.renderOrder = 27;
  root.add(hub);

  return root;
}

export function scaleGizmoForViewport(
  gizmoGroup: THREE.Group,
  camera: THREE.Camera,
  isPerspective: boolean,
  orthoZoom: number,
): void {
  if (isPerspective) {
    const dist = camera.position.distanceTo(gizmoGroup.position);
    const s = THREE.MathUtils.clamp(dist * 0.14, 0.55, 6.0);
    gizmoGroup.scale.setScalar(s);
  } else {
    const s = THREE.MathUtils.clamp(1.25 / Math.max(orthoZoom, 0.18), 0.45, 5.0);
    gizmoGroup.scale.setScalar(s);
  }
}

const _w0 = new THREE.Vector3();
const _axisDir = new THREE.Vector3();
const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();

/**
 * Computes closest point along an axis line (axisOrigin + s * axisDir) to a 3D mouse ray.
 */
export function intersectRayWithAxis(
  ray: THREE.Ray,
  axisOrigin: THREE.Vector3,
  axis: 'x' | 'y' | 'z',
): THREE.Vector3 | null {
  _axisDir.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  _w0.copy(axisOrigin).sub(ray.origin);
  const b = _axisDir.dot(ray.direction);
  const denom = 1.0 - b * b;
  if (denom < 1e-4) return null;
  const d = _axisDir.dot(_w0);
  const e = ray.direction.dot(_w0);
  const sc = (b * e - d) / denom;
  return axisOrigin.clone().addScaledVector(_axisDir, sc);
}

/**
 * Intersects a 3D mouse ray with a coordinate plane ('xy', 'xz', or 'yz') through planeOrigin.
 */
export function intersectRayWithConstraintPlane(
  ray: THREE.Ray,
  planeOrigin: THREE.Vector3,
  planeAxis: 'xy' | 'xz' | 'yz',
): THREE.Vector3 | null {
  const normal =
    planeAxis === 'xy'
      ? _axisDir.set(0, 0, 1)
      : planeAxis === 'xz'
        ? _axisDir.set(0, 1, 0)
        : _axisDir.set(1, 0, 0);
  _plane.setFromNormalAndCoplanarPoint(normal, planeOrigin);
  const hit = ray.intersectPlane(_plane, _hit);
  return hit ? hit.clone() : null;
}
