import { useEffect, useMemo, useRef } from "react";
import { Group } from "three";
import { Label, TextAlign, TextAnchorX, TextAnchorY } from "../Labels/Core/Label";
import { InstancedLabelManager } from "../Labels/Core/InstancedLabelManager";
import { Item } from "../Types/Item";

export interface InstancedLabelsProps {
  items: Item[];
  halo: boolean;
  viewportPredicate: (item: Item) => boolean;
  fontSize?: number;
  pxPerUnit?: number;
}

export function InstancedLabelComponent({
  items,
  halo,
  viewportPredicate,
  fontSize = 24,
  pxPerUnit = 96,
}: InstancedLabelsProps) {
  const groupRef = useRef<Group>(null);

  const manager = useMemo(() => {
    // Batch all additions before syncing
    const m = new InstancedLabelManager(pxPerUnit);
    m.autoUpdate = false;

    m.addLabels(items.map((item) => new Label({
      text: item.text,
      position: item.position,
      rotation: item.rotation,
      rotationAlignment: 0,
      color: "#000000",
      haloColor: viewportPredicate(item) ? "#ffcccc" : "#cce5ff",
      haloWidth: halo ? 10 : 0,
      haloBlur: halo ? 2000 : 0,
      font: viewportPredicate(item) ? "Arial" : "Times New Roman",
      fontSize,
      maxWidth: 1,
      textAlign: TextAlign.Justify,
      lineHeight: 1,
      anchorX: TextAnchorX.Center,
      anchorY: TextAnchorY.Middle,
    })));

    // Single sync for all groups, then enable reactive updates
    m.update();
    m.autoUpdate = true;
    return m;
  }, [items, viewportPredicate, halo, fontSize, pxPerUnit]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    // Meshes are persistent — add once, manager keeps them in sync
    for (const { fill, halo } of manager.meshes) {
      group.add(halo, fill); // halo behind fill
    }

    return () => {
      group.clear();
      manager.dispose();
    };
  }, [manager]);

  return <group ref={groupRef} />;
}
