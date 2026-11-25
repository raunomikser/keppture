import * as THREE from 'three';
import type { SceneObject } from '../types/visualizer';

export interface TrussEndpoint {
  local: THREE.Vector3;
  outward: THREE.Vector3;
  world: THREE.Vector3;
}

export interface TrussSnapResult {
  targetObjectId: string;
  /** New position for the dragged anchor object. */
  position: [number, number, number];
  /** New Euler rotation for the dragged anchor object, radians. */
  rotation: [number, number, number];
  /** Exact shared endpoint point where the magnet locks. */
  snapPoint: THREE.Vector3;
  /** Current dragged endpoint before correction, for drawing the guide line. */
  draggedPoint: THREE.Vector3;
  distance: number;
}

/** Fields present on catalog / imported truss objects at runtime. */
interface CatalogTrussFields {
  skpCatalogId?: string;
  trussEndpoints?: Array<[number, number, number]>;
}

type Triple = [number, number, number];

const DEFAULT_TOLERANCE = 0.45;
const MIN_ENDPOINT_SPAN = 0.02;
const AXIS_EPS = 1e-4;
const HORIZONTAL_Y_LIMIT = 0.3;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function isFiniteTriple(value: unknown): value is Triple {
  return Array.isArray(value) && value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function toVector(value: Triple): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2]);
}

function localEndpoints(obj: SceneObject, extras: CatalogTrussFields): THREE.Vector3[] {
  if (Array.isArray(extras.trussEndpoints)) {
    const points = extras.trussEndpoints.filter(isFiniteTriple).map(toVector);
    if (points.length >= 2) return points;
  }

  const length = obj.length;
  const isTrussLike = obj.kind === 'truss' || Boolean(extras.skpCatalogId);
  if (isTrussLike && typeof length === 'number' && Number.isFinite(length) &&
    Math.abs(length) >= MIN_ENDPOINT_SPAN) {
    return [new THREE.Vector3(-length / 2, 0, 0), new THREE.Vector3(length / 2, 0, 0)];
  }

  return [];
}

/** Outward normals in local space, before rotation. */
function deriveOutwards(points: THREE.Vector3[]): THREE.Vector3[] {
  const onLocalX = (p: THREE.Vector3): boolean => Math.abs(p.y) < AXIS_EPS && Math.abs(p.z) < AXIS_EPS;

  if (points.length === 2 && onLocalX(points[0]) && onLocalX(points[1])) {
    const sign = Math.sign(points[0].x - points[1].x) || -1;
    return [new THREE.Vector3(sign, 0, 0), new THREE.Vector3(-sign, 0, 0)];
  }

  return points.map((p, index) => {
    const direction = p.clone();
    if (direction.lengthSq() < AXIS_EPS * AXIS_EPS) {
      const centroid = new THREE.Vector3();
      let count = 0;
      for (let i = 0; i < points.length; i++) {
        if (i === index) continue;
        centroid.add(points[i]);
        count++;
      }
      if (count > 0) centroid.divideScalar(count);
      direction.sub(centroid);
    }
    if (direction.lengthSq() < AXIS_EPS * AXIS_EPS) direction.set(index === 0 ? -1 : 1, 0, 0);
    return direction.normalize();
  });
}

export function getTrussEndpoints(
  obj: SceneObject,
  positionOverride?: Triple,
  rotationOverride?: Triple,
): TrussEndpoint[] {
  const extras = obj as SceneObject & CatalogTrussFields;
  const position = positionOverride ?? obj.position;
  const rotation = rotationOverride ?? obj.rotation;
  if (!isFiniteTriple(position) || !isFiniteTriple(rotation)) return [];

  const euler = new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ');
  const scale = isFiniteTriple(obj.scale) ? toVector(obj.scale) : new THREE.Vector3(1, 1, 1);
  const raw = localEndpoints(obj, extras);

  // Drop duplicate / degenerate endpoint pairs.
  const locals: THREE.Vector3[] = [];
  for (const point of raw) {
    if (!locals.some((existing) => existing.distanceToSquared(point) < AXIS_EPS * AXIS_EPS)) {
      locals.push(point);
    }
  }
  if (locals.length < 2) return [];

  let spanSq = 0;
  for (let i = 0; i < locals.length; i++) {
    for (let j = i + 1; j < locals.length; j++) {
      spanSq = Math.max(spanSq, locals[i].distanceToSquared(locals[j]));
    }
  }
  if (spanSq < MIN_ENDPOINT_SPAN * MIN_ENDPOINT_SPAN) return [];

  const origin = toVector(position);
  const outwards = deriveOutwards(locals);
  return locals.map((local, index) => ({
    local,
    outward: outwards[index].clone().applyEuler(euler).normalize(),
    world: local.clone().multiply(scale).applyEuler(euler).add(origin),
  }));
}

/** World-space delta quaternion; planar pairs yaw only, other pairs rotate freely. */
function snapRotationFromPairs(rotation: Triple, current: THREE.Vector3, desired: THREE.Vector3): Triple {
  const from = current.clone().normalize();
  const to = desired.clone().normalize();
  if (from.lengthSq() < AXIS_EPS * AXIS_EPS || to.lengthSq() < AXIS_EPS * AXIS_EPS) return [...rotation];

  let delta: THREE.Quaternion;
  if (Math.abs(from.y) < HORIZONTAL_Y_LIMIT && Math.abs(to.y) < HORIZONTAL_Y_LIMIT) {
    // Three.js +Y rotation turns +X toward -Z, so the planar angle is inverted.
    let yaw = Math.atan2(from.z, from.x) - Math.atan2(to.z, to.x);
    while (yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw < -Math.PI) yaw += Math.PI * 2;
    delta = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw);
  } else {
    delta = new THREE.Quaternion().setFromUnitVectors(from, to);
  }

  const quaternion = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ'))
    .premultiply(delta);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return [euler.x, euler.y, euler.z];
}

export function findTrussSnap(
  dragged: Array<{ id: string; startPos: Triple; position: Triple }>,
  objects: SceneObject[],
  tolerance = DEFAULT_TOLERANCE,
): TrussSnapResult | null {
  if (dragged.length === 0 || !Number.isFinite(tolerance) || tolerance <= 0) return null;

  const anchor = dragged[0];
  const anchorObj = objects.find((obj) => obj.id === anchor.id);
  if (!anchorObj) return null;

  const anchorEndpoints = getTrussEndpoints(anchorObj, anchor.position);
  if (anchorEndpoints.length === 0) return null;

  const draggedIds = new Set(dragged.map((item) => item.id));
  let best: { target: SceneObject; draggedEnd: TrussEndpoint; targetEnd: TrussEndpoint; distance: number } | null = null;

  for (const obj of objects) {
    if (obj.id === anchor.id || draggedIds.has(obj.id)) continue;
    const targetEndpoints = getTrussEndpoints(obj);
    for (const draggedEnd of anchorEndpoints) {
      for (const targetEnd of targetEndpoints) {
        const distance = draggedEnd.world.distanceTo(targetEnd.world);
        if (distance <= tolerance && (best === null || distance < best.distance)) {
          best = { target: obj, draggedEnd, targetEnd, distance };
        }
      }
    }
  }

  if (best === null) return null;

  const desiredOutward = best.targetEnd.outward.clone().negate();
  const rotation = snapRotationFromPairs(anchorObj.rotation, best.draggedEnd.outward, desiredOutward);
  const newEuler = new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ');
  const scale = isFiniteTriple(anchorObj.scale) ? toVector(anchorObj.scale) : new THREE.Vector3(1, 1, 1);

  // Rotated local offset only: translation is then solved so this endpoint lands exactly on the target.
  const rotatedOffset = best.draggedEnd.local.clone().multiply(scale).applyEuler(newEuler);
  const position = best.targetEnd.world.clone().sub(rotatedOffset);

  return {
    targetObjectId: best.target.id,
    position: [position.x, position.y, position.z],
    rotation,
    snapPoint: best.targetEnd.world.clone(),
    draggedPoint: best.draggedEnd.world.clone(),
    distance: best.distance,
  };
}

let cachedMagnetTexture: THREE.Texture | null = null;

function getMagnetTexture(): THREE.Texture {
  if (cachedMagnetTexture) return cachedMagnetTexture;

  // Headless callers still get a harmless texture instead of a DOM error.
  if (typeof document === 'undefined') {
    const fallback = new THREE.DataTexture(new Uint8Array([255, 122, 40, 255]), 1, 1, THREE.RGBAFormat);
    fallback.needsUpdate = true;
    cachedMagnetTexture = fallback;
    return fallback;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const traceMagnet = (): void => {
      ctx.beginPath();
      ctx.moveTo(36, 40);
      ctx.lineTo(36, 78);
      ctx.quadraticCurveTo(64, 112, 92, 78);
      ctx.lineTo(92, 40);
    };

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    traceMagnet();
    ctx.strokeStyle = 'rgba(10, 14, 22, 0.9)';
    ctx.lineWidth = 42;
    ctx.stroke();

    const body = ctx.createLinearGradient(30, 30, 96, 108);
    body.addColorStop(0, '#ff9a2e');
    body.addColorStop(0.55, '#f0441f');
    body.addColorStop(1, '#a9130f');
    traceMagnet();
    ctx.strokeStyle = body;
    ctx.lineWidth = 30;
    ctx.stroke();

    const silver = ctx.createLinearGradient(0, 20, 0, 48);
    silver.addColorStop(0, '#ffffff');
    silver.addColorStop(1, '#9aa8b8');
    for (const x of [22, 78]) {
      ctx.fillStyle = silver;
      ctx.fillRect(x, 20, 28, 26);
      ctx.strokeStyle = 'rgba(10, 14, 22, 0.85)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, 20, 28, 26);
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillRect(26, 23, 10, 3);
    ctx.fillRect(82, 23, 10, 3);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  cachedMagnetTexture = texture;
  return texture;
}

export function buildSnapIndicator(snapPoint: THREE.Vector3, draggedPoint?: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.name = 'truss-snap-indicator';
  group.userData.isSnapIndicator = true;

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getMagnetTexture(),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }));
  sprite.position.copy(snapPoint).y += 0.14;
  sprite.scale.set(0.34, 0.34, 1);
  sprite.renderOrder = 31;
  group.add(sprite);

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 12, 8),
    new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  marker.position.copy(snapPoint);
  marker.renderOrder = 30;
  group.add(marker);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.024, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0xffbf24,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  core.position.copy(snapPoint);
  core.renderOrder = 32;
  group.add(core);

  if (draggedPoint && draggedPoint.distanceTo(snapPoint) > 0.02) {
    const geometry = new THREE.BufferGeometry().setFromPoints([draggedPoint.clone(), snapPoint.clone()]);
    const line = new THREE.Line(
      geometry,
      new THREE.LineDashedMaterial({
        color: 0xffc857,
        dashSize: 0.12,
        gapSize: 0.08,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    line.computeLineDistances();
    line.renderOrder = 29;
    group.add(line);
  }

  return group;
}
