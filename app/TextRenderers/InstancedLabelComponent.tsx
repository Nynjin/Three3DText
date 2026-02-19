import { useEffect, useMemo, useRef } from "react";
import {
  Mesh,
  Group,
} from "three";
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
    const m = new InstancedLabelManager(pxPerUnit);
    for (const item of items) {
      m.addLabel(new Label({
        text: item.text,
        position: item.position,
        rotation: item.rotation,
        rotationAlignment: 0,
        color: "#000000",
        haloColor: viewportPredicate(item) ? "#ffcccc" : "#cce5ff",
        haloWidth: halo ? 5 : 0,
        haloBlur: halo ? 10000 : 0,
        font: (() => viewportPredicate(item) ? "Arial" : "Times New Roman")(),
        fontSize,
        maxWidth: 1,
        textAlign: TextAlign.Justify,
        lineHeight: 1,
        anchorX: TextAnchorX.Center,
        anchorY: TextAnchorY.Middle,
      }));
    };
    return m;
  }, [items, viewportPredicate, halo, fontSize, pxPerUnit]);

  const meshes = useMemo(() => {
    return manager.buildMeshes();
  }, [manager]);

  useEffect(() => {
    if (!groupRef.current) return;

    for (const child of groupRef.current.children) {
      const mesh = child as Mesh;
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) {
        for (const m of mat) {
          m.dispose();
        }
      } else {
        mat.dispose();
      }
    }

    // Clear old children
    groupRef.current.children.length = 0;

    // Add new meshes
    for (const mesh of meshes) {
      groupRef.current.add(mesh);
    }
  }, [meshes]);

  return <group ref={groupRef} />;
}
