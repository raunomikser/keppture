import * as THREE from 'three';
import { SceneObject } from '../types/visualizer';

export type EffectJetUpdate = (phase: number, level: number) => void;

interface JetLayer {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  baseOpacity: number;
  index: number;
  height: number;
}

/**
 * Builds a CO2 / flame jet device and its plume.
 *
 * In plot/wireframe modes only a dashed plume symbol is drawn. In Live mode
 * the plume is a stack of additive translucent cones whose opacity and shape
 * are driven by `root.userData.effectJetUpdate` from the viewport animation loop.
 */
export function buildEffectJet(
  obj: SceneObject,
  baseMode: 'wireframe' | 'plot' | 'live',
  strokeColorHex: number,
  isSelected: boolean,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `${obj.id}-effect-jet`;
  root.userData.objectId = obj.id;
  root.position.set(obj.position[0], obj.position[1], obj.position[2]);
  root.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);

  const isFlame = obj.kind === 'flame-jet';
  const height = Math.max(0.5, obj.height ?? (isFlame ? 3.2 : 4.5));
  const spread = THREE.MathUtils.clamp((obj.beamAngle ?? 8) * 0.018, 0.08, 0.45);
  const nozzleY = 0.46;
  const selectedColor = 0xff3b30;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x3a3d42,
    metalness: 0.65,
    roughness: 0.38,
    toneMapped: false,
  });
  const ringMat = new THREE.MeshStandardMaterial({
    color: isFlame ? 0x7a3b1e : 0x2b5d78,
    metalness: 0.5,
    roughness: 0.4,
    toneMapped: false,
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.36, 14), bodyMat);
  body.position.y = 0.18;
  root.add(body);

  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.12, 14), ringMat);
  ring.position.y = nozzleY - 0.04;
  root.add(ring);

  if (baseMode !== 'live') {
    const symbolGeo = new THREE.CylinderGeometry(
      Math.max(0.12, spread * height),
      0.08,
      height,
      16,
      1,
      true,
    );
    const edges = new THREE.EdgesGeometry(symbolGeo, 18);
    symbolGeo.dispose();
    const lines = new THREE.LineSegments(
      edges,
      new THREE.LineDashedMaterial({
        color: isSelected ? selectedColor : strokeColorHex,
        dashSize: 0.16,
        gapSize: 0.1,
        transparent: true,
        opacity: 0.75,
        depthTest: false,
        toneMapped: false,
      }),
    );
    lines.computeLineDistances();
    lines.position.y = nozzleY + height * 0.5;
    root.add(lines);
    return root;
  }

  const palette = isFlame
    ? [0xff3b00, 0xff8a00, 0xffd166]
    : [0x7ec8f2, 0xcceeff, 0xffffff];
  const layers: JetLayer[] = [];

  for (let i = 0; i < 3; i++) {
    const layerHeight = height * (1 - i * 0.12);
    const radiusTop = Math.max(0.1, spread * height * (1 - i * 0.22));
    const geo = new THREE.CylinderGeometry(radiusTop, 0.06, layerHeight, 16, 4, true);
    const baseOpacity = isFlame ? 0.36 - i * 0.07 : 0.26 - i * 0.05;
    const mat = new THREE.MeshBasicMaterial({
      color: palette[i],
      transparent: true,
      opacity: baseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = nozzleY + layerHeight * 0.5;
    mesh.renderOrder = 12 + i;
    root.add(mesh);
    layers.push({ mesh, baseOpacity, index: i, height: layerHeight });
  }

  const coreMat = new THREE.MeshBasicMaterial({
    color: isFlame ? 0xffd166 : 0xffffff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), coreMat);
  core.position.y = nozzleY;
  core.renderOrder = 16;
  root.add(core);

  const update: EffectJetUpdate = (phase, level) => {
    const output = THREE.MathUtils.clamp(level, 0, 1);
    for (const layer of layers) {
      const flicker = isFlame
        ? 0.78 + 0.22 * Math.sin(phase * 14 + layer.index * 2.1)
        : 0.9 + 0.1 * Math.sin(phase * 5 + layer.index * 1.3);
      const wobble = Math.sin(phase * (isFlame ? 9 : 4) + layer.index * 1.7);
      layer.mesh.material.opacity = layer.baseOpacity * output * flicker;
      layer.mesh.scale.set(1 + wobble * 0.06, 0.82 + 0.18 * output, 1 - wobble * 0.06);
      layer.mesh.position.y = nozzleY + layer.height * (0.42 + 0.08 * output);
    }
    coreMat.opacity = 0.9 * output;
    core.scale.setScalar(0.85 + 0.25 * output);
  };

  root.userData.effectJetUpdate = update;
  root.userData.effectJetLevel = 1;
  return root;
}
