import { useEffect, useRef } from "react";
import { BufferGeometry, Group, Mesh } from "three";
import {
  Label,
  RotationAlignment,
  TextAlign,
  TextAnchorX,
  TextAnchorY,
} from "../Core/Label";
import { InstancedLabelManager } from "../Core/InstancedLabelManager";
import { Item } from "../Types/Item";
import { useFrame, useThree } from "@react-three/fiber";

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
    padding: [20, 20, 20, 20],
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
  const debugMeshRef = useRef<Mesh<BufferGeometry>>(null);
  const camera = useThree((state) => state.camera);
  const renderer = useThree((state) => state.gl);

  // Map of item.key to Label
  const labelMapRef = useRef<Map<number, Label>>(new Map());
  // How many mesh pairs are already attached to the group
  const attachedMeshCountRef = useRef(0);

  const managerRef = useRef<InstancedLabelManager | null>(null);

  if (!managerRef.current) {
    managerRef.current = new InstancedLabelManager(renderer, {
      pxPerUnit,
      autoUpdate: false,
    });
  }
  const manager = managerRef.current;

  useEffect(() => {
    return () => {
      managerRef.current?.dispose();
      managerRef.current = null;
    };
  }, []); // dispose only on real unmount

  // Manager created once per pxPerUnit change only
  // const manager = useMemo(() => {
  //   const m = new InstancedLabelManager(
  //     pxPerUnit,
  //     renderer
  //   );

  //   m.autoUpdate = false;
  //   return m;
  // }, [pxPerUnit, renderer]);

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

  useFrame(() => {
    manager.cull(camera);
  });

  return (
    <group ref={groupRef}>
      {
        <mesh
          ref={debugMeshRef}
          geometry={debugMeshRef.current?.geometry}
          material={debugMeshRef.current?.material}
          renderOrder={9999}
          frustumCulled={false}
        />
      }
    </group>
  );
}
