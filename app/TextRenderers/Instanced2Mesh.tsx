/**
 * @deprecated Use InstancedLabelsManager and InstancedLabelsComponent or useInstancedLabels instead.
 * This file provides backwards compatibility with the old API.
 */
import { useMemo } from "react";
import type { Item } from "../Types/Item";
import { InstancedLabelsManager, InstancedLabelsComponent } from "./InstancedLabels";
import { Label } from "../Labels/Core/Label";

export interface InstancedLabelsEZProps {
  items: Item[];
  halo: boolean;
  viewportPredicate: (item: Item) => boolean;
  fontSize?: number;
  pxPerUnit?: number;
}

/**
 * @deprecated Use InstancedLabelsManager with InstancedLabelsComponent instead.
 */
export function InstancedLabelsEZ({
  items,
  halo,
  viewportPredicate,
  fontSize = 92,
  pxPerUnit = 64,
}: InstancedLabelsEZProps) {
  const manager = useMemo(() => {
    const m = new InstancedLabelsManager(pxPerUnit);
    items.forEach(item => {
      m.addLabel(new Label({
        text: item.text,
        position: item.position,
        rotation: item.rotation,
        rotationAlignment: 0,
        color: "#000000",
        haloColor: Math.random() < 0.5 ? "#ffcccc" : "#cce5ff",
        haloWidth: halo ? 5 : 0,
        haloBlur: halo ? 10000 : 0,
        font: (() => viewportPredicate(item) ? "Arial" : "Times New Roman")(),
        fontSize: 30,
        maxWidth: 5,
        textAlign: "justify",
        lineHeight: 1,
        anchorX: "center",
        anchorY: "middle",
      }));
    });
    return m;
  }, [items, viewportPredicate, halo, fontSize, pxPerUnit]);

  return <InstancedLabelsComponent manager={manager} />;
}
  