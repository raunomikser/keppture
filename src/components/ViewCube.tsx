import React, { useRef, useState } from 'react';
import * as THREE from 'three';
import { ProjectionType } from '../types/visualizer';

export interface ViewCubeSnapTarget {
  direction: [number, number, number]; // unit vector from target to camera
  projection: ProjectionType;
  label: string;
}

interface ViewCubeProps {
  /** 16-element CSS matrix3d column-major array derived from camera orientation */
  matrix3d: string;
  /** Current camera world direction (from target to camera, normalized) */
  viewDir: [number, number, number];
  activeProjection: ProjectionType;
  onSnapTo: (target: ViewCubeSnapTarget) => void;
  onOrbitDrag: (dx: number, dy: number) => void;
  onOrbitEnd?: () => void;
}

type FaceId = 'Top' | 'Bottom' | 'Front' | 'Back' | 'Right' | 'Left';

interface FaceConfig {
  id: FaceId;
  normal: [number, number, number];
  right: [number, number, number];
  down: [number, number, number]; // local +Y in CSS face space (downward on face)
  cssTransform: (half: number) => string;
}

const CUBE_SIZE = 44;
const HALF = CUBE_SIZE / 2;

const FACES: FaceConfig[] = [
  {
    id: 'Front',
    normal: [0, 0, 1],
    right: [1, 0, 0],
    down: [0, -1, 0],
    cssTransform: (h) => `translateZ(${h}px)`,
  },
  {
    id: 'Back',
    normal: [0, 0, -1],
    right: [-1, 0, 0],
    down: [0, -1, 0],
    cssTransform: (h) => `rotateY(180deg) translateZ(${h}px)`,
  },
  {
    id: 'Right',
    normal: [1, 0, 0],
    right: [0, 0, -1],
    down: [0, -1, 0],
    cssTransform: (h) => `rotateY(90deg) translateZ(${h}px)`,
  },
  {
    id: 'Left',
    normal: [-1, 0, 0],
    right: [0, 0, 1],
    down: [0, -1, 0],
    cssTransform: (h) => `rotateY(-90deg) translateZ(${h}px)`,
  },
  {
    id: 'Top',
    normal: [0, 1, 0],
    right: [1, 0, 0],
    down: [0, 0, 1],
    cssTransform: (h) => `rotateX(90deg) translateZ(${h}px)`,
  },
  {
    id: 'Bottom',
    normal: [0, -1, 0],
    right: [1, 0, 0],
    down: [0, 0, -1],
    cssTransform: (h) => `rotateX(-90deg) translateZ(${h}px)`,
  },
];

// 3x3 grid offsets per face: row (-1, 0, 1) along face.down, col (-1, 0, 1) along face.right
const GRID_CELLS: Array<{
  row: -1 | 0 | 1;
  col: -1 | 0 | 1;
  kind: 'center' | 'edge' | 'corner';
}> = [
  { row: -1, col: -1, kind: 'corner' },
  { row: -1, col: 0, kind: 'edge' },
  { row: -1, col: 1, kind: 'corner' },
  { row: 0, col: -1, kind: 'edge' },
  { row: 0, col: 0, kind: 'center' },
  { row: 0, col: 1, kind: 'edge' },
  { row: 1, col: -1, kind: 'corner' },
  { row: 1, col: 0, kind: 'edge' },
  { row: 1, col: 1, kind: 'corner' },
];

export function computeCubeMatrix3d(quaternion: THREE.Quaternion): string {
  // Convert Three.js camera inverse rotation (world -> camera, Y-up)
  // to CSS 3D transform (Y-down): C * R_inv * C where C = diag(1, -1, 1)
  const invQuat = quaternion.clone().invert();
  const m = new THREE.Matrix4().makeRotationFromQuaternion(invQuat);
  const e = m.elements;
  // Conjugating 3x3 by diag(1, -1, 1) negates (row=1,col!=1) and (row!=1,col=1)
  const vals = [
    e[0], -e[1], e[2], 0,
    -e[4], e[5], -e[6], 0,
    e[8], -e[9], e[10], 0,
    0, 0, 0, 1,
  ];
  return `matrix3d(${vals.map((v) => v.toFixed(6)).join(',')})`;
}

export const ViewCube: React.FC<ViewCubeProps> = ({
  matrix3d,
  viewDir,
  activeProjection,
  onSnapTo,
  onOrbitDrag,
  onOrbitEnd,
}) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, lastX: 0, lastY: 0 });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) {
      d.moved = true;
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (d.moved) {
      onOrbitDrag(dx, dy);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;
    if (wasMoved) {
      onOrbitEnd?.();
    }
  };

  const buildSnapTarget = (
    face: FaceConfig,
    row: -1 | 0 | 1,
    col: -1 | 0 | 1,
    kind: 'center' | 'edge' | 'corner',
  ): ViewCubeSnapTarget => {
    if (kind === 'center') {
      return {
        direction: face.normal,
        projection: face.id,
        label: face.id,
      };
    }

    const vx = face.normal[0] + col * face.right[0] + row * face.down[0];
    const vy = face.normal[1] + col * face.right[1] + row * face.down[1];
    const vz = face.normal[2] + col * face.right[2] + row * face.down[2];
    const len = Math.hypot(vx, vy, vz) || 1;
    return {
      direction: [vx / len, vy / len, vz / len],
      projection: 'Perspective',
      label: kind === 'corner' ? 'Isometric' : 'Perspective',
    };
  };

  return (
    <div
      className="relative flex items-center justify-center select-none"
      style={{
        width: '74px',
        height: '74px',
        perspective: '220px',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setHoveredKey(null)}
    >
      {/* 3D Cube Container synced with Three.js camera quaternion */}
      <div
        className="relative"
        style={{
          width: `${CUBE_SIZE}px`,
          height: `${CUBE_SIZE}px`,
          transformStyle: 'preserve-3d',
          transform: matrix3d,
        }}
      >
        {FACES.map((face) => {
          // Dot product with camera viewDir (> 0 means front-facing toward camera)
          const dot =
            face.normal[0] * viewDir[0] +
            face.normal[1] * viewDir[1] +
            face.normal[2] * viewDir[2];
          const isFrontFacing = dot > 0.04;
          const isFaceCenterHovered = hoveredKey === `${face.id}-0-0`;
          const isCurrentActiveFace = activeProjection === face.id && dot > 0.98;

          return (
            <div
              key={face.id}
              style={{
                position: 'absolute',
                inset: 0,
                width: `${CUBE_SIZE}px`,
                height: `${CUBE_SIZE}px`,
                transform: face.cssTransform(HALF),
                backfaceVisibility: 'visible',
                pointerEvents: isFrontFacing ? 'auto' : 'none',
                border: `1px solid ${
                  isFaceCenterHovered || isCurrentActiveFace ? '#7CE043' : '#4D8C2A'
                }`,
                backgroundColor: isFrontFacing
                  ? isFaceCenterHovered
                    ? 'rgba(56, 108, 28, 0.90)'
                    : 'rgba(27, 51, 17, 0.85)'
                  : 'rgba(18, 34, 11, 0.42)',
                boxShadow: isFaceCenterHovered
                  ? 'inset 0 0 8px rgba(124, 224, 67, 0.35)'
                  : 'none',
                transition: 'background-color 120ms ease, border-color 120ms ease',
              }}
            >
              {/* Crisp bright green face label */}
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] leading-none font-medium tracking-[0.01em]"
                style={{
                  color: isFrontFacing
                    ? isFaceCenterHovered
                      ? '#9FF569'
                      : '#6BC938'
                    : 'rgba(107, 201, 56, 0.25)',
                }}
              >
                {face.id}
              </div>

              {/* 3x3 Interactive Hit Grid for Center Face, 4 Edges, and 4 Corners */}
              {isFrontFacing && (
                <div
                  className="absolute inset-0 grid"
                  style={{
                    gridTemplateColumns: '9px 1fr 9px',
                    gridTemplateRows: '9px 1fr 9px',
                  }}
                >
                  {GRID_CELLS.map(({ row, col, kind }) => {
                    const cellKey = `${face.id}-${row}-${col}`;
                    const isCellHovered = hoveredKey === cellKey;
                    const snapTarget = buildSnapTarget(face, row, col, kind);

                    return (
                      <div
                        key={cellKey}
                        title={`Align to ${snapTarget.label}`}
                        onMouseEnter={() => setHoveredKey(cellKey)}
                        onMouseLeave={() =>
                          setHoveredKey((prev) => (prev === cellKey ? null : prev))
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (dragRef.current.moved) return;
                          onSnapTo(snapTarget);
                        }}
                        className="cursor-pointer transition-colors"
                        style={{
                          backgroundColor:
                            kind !== 'center' && isCellHovered
                              ? 'rgba(124, 224, 67, 0.52)'
                              : 'transparent',
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
