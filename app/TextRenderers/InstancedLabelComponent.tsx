import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import {
  Label,
  RotationAlignment,
  TextAlign,
  TextAnchorX,
  TextAnchorY,
} from "../Labels/Core/Label";
import { InstancedLabelManager } from "../Labels/Core/InstancedLabelManager";
import { Item } from "../Types/Item";
import { useFrame, useThree } from "@react-three/fiber";

const DEBUG_COLLISIONS = true;
const DEBUG_MAX_COLLISION_SEGMENTS = 120000;

export interface InstancedLabelsProps {
  items: Item[];
  halo: boolean;
  viewportPredicate: (item: Item) => boolean;
  fontSize?: number;
  pxPerUnit?: number;
}

function makeLabel(
  item: Item,
  halo: boolean,
  viewportPredicate: (item: Item) => boolean,
  fontSize: number,
): Label {
  return new Label({
    text: item.text,
    position: item.position,
    rotation: item.rotation,
    rotationAlignment: RotationAlignment.Map,
    color: "#000000",
    haloColor: viewportPredicate(item) ? "#ffcccc" : "#cce5ff",
    haloWidth: halo ? 1 : 0,
    haloBlur: halo ? 10 : 0,
    font: "Arial",
    fontSize,
    maxWidth: 5,
    textAlign: TextAlign.Left,
    lineHeight: 1.2,
    offset: [0, 0],
    anchorX: TextAnchorX.Left,
    anchorY: TextAnchorY.Top,
  });
}

export function InstancedLabelComponent({
  items,
  halo,
  viewportPredicate,
  fontSize = 20,
  pxPerUnit = 1024,
}: InstancedLabelsProps) {
  const groupRef = useRef<Group>(null);
  const debugLinesRef = useRef<LineSegments>(null);
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const renderer = useThree((state) => state.gl);
  const debugColorVisible = useMemo(() => new Color("#00d26a"), []);
  const debugColorOccluded = useMemo(() => new Color("#ff3344"), []);
  const debugPositions = useMemo(() => new Float32Array(DEBUG_MAX_COLLISION_SEGMENTS * 2 * 3), []);
  const debugColors = useMemo(() => new Float32Array(DEBUG_MAX_COLLISION_SEGMENTS * 2 * 3), []);
  const debugGeom = useMemo(() => {
    const geom = new BufferGeometry();
    geom.setAttribute("position", new BufferAttribute(debugPositions, 3));
    geom.setAttribute("color", new BufferAttribute(debugColors, 3));
    geom.setDrawRange(0, 0);
    return geom;
  }, [debugPositions, debugColors]);
  const debugMat = useMemo(
    () =>
      new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.3,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        toneMapped: false,
      }),
    [],
  );

  // Map of item.key to Label
  const labelMapRef = useRef<Map<number, Label>>(new Map());
  // How many mesh pairs are already attached to the group
  const attachedMeshCountRef = useRef(0);

  // Manager created once per pxPerUnit change only
  const manager = useMemo(() => {
    const m = new InstancedLabelManager(
      pxPerUnit,
      canvas,
      renderer
    );

    m.autoUpdate = false;
    return m;
  }, [pxPerUnit, canvas, renderer]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const labelMap = labelMapRef.current;
    const currentKeys = new Set(items.map((i) => i.key));

    // Remove labels whose items are gone
    const toRemove: Label[] = [];
    for (const [key, label] of labelMap) {
      if (!currentKeys.has(key)) {
        toRemove.push(label);
        labelMap.delete(key);
      }
    }
    if (toRemove.length > 0) {
      manager.removeLabels(toRemove);
    }

    // Add labels that are new
    const toAdd: Label[] = [];
    for (const item of items) {
      if (!labelMap.has(item.key)) {
        const label = makeLabel(item, halo, viewportPredicate, fontSize);
        labelMap.set(item.key, label);
        toAdd.push(label);
      }
    }
    if (toAdd.length > 0) {
      manager.addLabels(toAdd);

      // const mesh = new Mesh(
      //   new SphereGeometry(0.1, 8, 8),
      //   new MeshBasicMaterial({ color: "red" }),
      // );

      // for (const label of toAdd) {
      //   const cpy = mesh.clone();
      //   cpy.position.copy(label.position);
      //   group.add(cpy);
      // }
    }

    // Always flush dirty state so removes + adds are both committed.
    if (toAdd.length > 0 || toRemove.length > 0) {
      manager.update();
    }

    // Attach any mesh pairs created by new font groups (lazy, incremental)
    for (let i = attachedMeshCountRef.current; i < manager.meshes.length; i++) {
      const { fill, halo: haloMesh } = manager.meshes[i];
      group.add(haloMesh, fill);
    }
    attachedMeshCountRef.current = manager.meshes.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, manager, fontSize]);

  // Halo toggle — mutate labels in-place, no rebuild, no re-layout
  useEffect(() => {
    for (const label of labelMapRef.current.values()) {
      label.set({ haloWidth: halo ? 1 : 0, haloBlur: halo ? 10 : 0 });
    }
    manager.update();
  }, [halo, manager]);

  useEffect(() => {
    return () => {
      debugGeom.dispose();
      debugMat.dispose();
    };
  }, [debugGeom, debugMat]);

  useFrame(() => {
    manager.cull(camera);

    if (!DEBUG_COLLISIONS) {
      return;
    }

    const lines = debugLinesRef.current;
    if (!lines) {
      return;
    }

    const segments = manager.getCollisionDebugSegments(camera, DEBUG_MAX_COLLISION_SEGMENTS);
    const segmentCount = Math.min(segments.length, DEBUG_MAX_COLLISION_SEGMENTS);
    const vertexCount = segmentCount * 2;

    for (let i = 0; i < segmentCount; i++) {
      const s = segments[i];
      const base = i * 6;
      const c = s.shouldRender ? debugColorVisible : debugColorOccluded;

      debugPositions[base + 0] = s.ax;
      debugPositions[base + 1] = s.ay;
      debugPositions[base + 2] = s.az;
      debugPositions[base + 3] = s.bx;
      debugPositions[base + 4] = s.by;
      debugPositions[base + 5] = s.bz;

      debugColors[base + 0] = c.r;
      debugColors[base + 1] = c.g;
      debugColors[base + 2] = c.b;
      debugColors[base + 3] = c.r;
      debugColors[base + 4] = c.g;
      debugColors[base + 5] = c.b;
    }

    debugGeom.setDrawRange(0, vertexCount);
    (debugGeom.getAttribute("position") as BufferAttribute).needsUpdate = true;
    (debugGeom.getAttribute("color") as BufferAttribute).needsUpdate = true;
    lines.frustumCulled = false;
  });

  return (
    <group ref={groupRef}>
      {DEBUG_COLLISIONS && (
        <lineSegments
          ref={debugLinesRef}
          args={[debugGeom, debugMat]}
          frustumCulled={false}
          renderOrder={1000}
        />
      )}
    </group>
  );
}
