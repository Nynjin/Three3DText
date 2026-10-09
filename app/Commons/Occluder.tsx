import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { TransformControls } from '@react-three/drei';
import type { Object3D } from 'three';

export interface OccluderProps {
  /** Edge length of the block, in scene units. */
  size: number;
  /** Where the block starts. */
  start: [number, number, number];
}

/** Width of the plane the gizmo drags along, in scene units; set by the library. */
const DRAG_PLANE_WIDTH = 1e5;

/** Width of the drag plane, in block edges. */
const DRAG_PLANE_EDGES = 200;

/**
 * An opaque block with a move gizmo, to drag across the labels and see which
 * ones it hides. Needs `OrbitControls` with `makeDefault`, so the camera stays
 * still while the gizmo is dragged.
 */
export function Occluder({ size, start }: OccluderProps) {
  const [block, setBlock] = useState<Object3D | null>(null);
  const gizmo = useRef<ComponentRef<typeof TransformControls>>(null);

  // The gizmo drags along a plane of a fixed width, which a scene much larger
  // than that never hits. `plane` is private in the library's typings.
  useEffect(() => {
    if (!gizmo.current) return;
    const { plane } = gizmo.current as unknown as { plane: Object3D };
    plane.scale.setScalar(Math.max(1, (size * DRAG_PLANE_EDGES) / DRAG_PLANE_WIDTH));
  }, [block, size]);

  return (
    <>
      <mesh ref={setBlock} position={start}>
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial color="#d9822b" />
      </mesh>
      {block && <TransformControls ref={gizmo} object={block} mode="translate" size={0.9} />}
    </>
  );
}
