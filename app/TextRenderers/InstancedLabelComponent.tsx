import { useEffect, useMemo, useRef } from "react";
import { Group } from "three";
import { Label, RotationAlignment, TextAlign, TextAnchorX, TextAnchorY } from "../Labels/Core/Label";
import { InstancedLabelManager } from "../Labels/Core/InstancedLabelManager";
import { Item } from "../Types/Item";
import { useFrame, useThree } from "@react-three/fiber";

export interface InstancedLabelsProps {
  items: Item[];
  halo: boolean;
  viewportPredicate: (item: Item) => boolean;
  fontSize?: number;
  pxPerUnit?: number;
}

function makeLabel(item: Item, halo: boolean, viewportPredicate: (item: Item) => boolean, fontSize: number): Label {
  return new Label({
    text: item.text,
    position: item.position,
    rotation: item.rotation,
    rotationAlignment: RotationAlignment.Map,
    color: "#000000",
    haloColor: viewportPredicate(item) ? "#ffcccc" : "#cce5ff",
    haloWidth: halo ? 5 : 0,
    haloBlur: halo ? 10 : 0,
    font: viewportPredicate(item) ? "Arial" : "Times New Roman",
    fontSize,
    maxWidth: 1,
    textAlign: TextAlign.Justify,
    lineHeight: 1,
    anchorX: TextAnchorX.Center,
    anchorY: TextAnchorY.Middle,
  });
}

export function InstancedLabelComponent({
  items,
  halo,
  viewportPredicate,
  fontSize = 20,
  pxPerUnit = 96,
}: InstancedLabelsProps) {
  const groupRef = useRef<Group>(null);
  const camera = useThree((state) => state.camera);

  // Stable map of item.key → Label, survives all re-renders
  const labelMapRef = useRef<Map<number, Label>>(new Map());
  // How many mesh pairs are already attached to the group
  const attachedMeshCountRef = useRef(0);

  // Manager created once per pxPerUnit change only
  const manager = useMemo(() => new InstancedLabelManager(pxPerUnit), [pxPerUnit]);
  manager.autoUpdate = false;

  // Cleanup when manager changes or component unmounts
  useEffect(() => {
    return () => {
      groupRef.current?.clear();
      manager.dispose();
      labelMapRef.current.clear();
      attachedMeshCountRef.current = 0;
    };
  }, [manager]);

  // Diff items — add new, remove stale. Never depends on halo.
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
    if (toRemove.length > 0) manager.removeLabels(toRemove);

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
      // manager.autoUpdate = false;
      manager.addLabels(toAdd);
      manager.update();
      // manager.autoUpdate = true;
    } else if (toRemove.length > 0) {
      manager.update();
    }

    // Attach any mesh pairs created by new font groups (lazy, incremental)
    for (let i = attachedMeshCountRef.current; i < manager.meshes.length; i++) {
      const { fill, halo: haloMesh } = manager.meshes[i];
      group.add(haloMesh, fill);
    }
    attachedMeshCountRef.current = manager.meshes.length;
  // viewportPredicate and halo intentionally excluded — halo handled below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, manager, fontSize]);

  // Halo toggle — mutate labels in-place, no rebuild, no re-layout
  useEffect(() => {
    for (const label of labelMapRef.current.values()) {
      label.set({ haloWidth: halo ? 5 : 0, haloBlur: halo ? 10 : 0 });
    }
    manager.update();
  }, [halo]);

  const last    = useRef(0);

  useFrame(({ clock }) => {
    // if (clock.elapsedTime - last.current < 0.1) {
    //   return;
    // };
    // last.current = clock.elapsedTime;
    manager.cull(camera);
  });

  return <group ref={groupRef} />;
}

