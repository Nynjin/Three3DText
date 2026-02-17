import { useEffect, useMemo, useRef } from "react";
import {
  Mesh,
  Group,
} from "three";
import { Label, TextAlign, TextAnchorX, TextAnchorY } from "../Labels/Core/Label";
import buildSDFAtlas, { SDFAtlas } from "../Labels/Font/SDFAtlas";
import layoutText from "../Labels/Layout/TextLayout";
import { buildLabelGeometry } from "../Labels/Render/Geometries/LabelGeometry";
import { createFillMaterial } from "../Labels/Render/Materials/FillMaterial";
import { createHaloMaterial } from "../Labels/Render/Materials/HaloMaterial";
import type { Item } from "../Types/Item";

interface GroupKey {
  font: string;
  fontSize: number;
  fontWeight: string;
}

class InstancedLabelGroup {
  key: GroupKey;
  labels: Label[] = [];
  private atlas: SDFAtlas | null = null;
  private dirty = true;

  constructor(key: GroupKey) {
    this.key = key;
  }

  addLabel(label: Label) {
    if (
      label.font !== this.key.font ||
      label.fontSize !== this.key.fontSize ||
      label.fontWeight !== this.key.fontWeight
    ) {
      throw new Error(
        `Label font/size mismatch: expected ${this.key.font}/${this.key.fontSize}/${this.key.fontWeight}`
      );
    }
    this.labels.push(label);
    this.dirty = true;
  }

  removeLabel(label: Label) {
    const idx = this.labels.indexOf(label);
    if (idx >= 0) {
      this.labels.splice(idx, 1);
      this.dirty = true;
    }
  }

  getAtlas(): SDFAtlas {
    if (this.dirty || !this.atlas) {
      const chars = new Set<string>();
      this.labels.forEach((label) => {
        label
          .getDisplayText()
          .split("")
          .forEach((c) => chars.add(c));
      });
      chars.add("?").add(" ");
      this.atlas = buildSDFAtlas(
        [...chars].join(""),
        this.key.fontSize,
        this.key.font,
        this.key.fontWeight
      );
      this.dirty = false;
    }
    return this.atlas;
  }
}

/**
 * 
 */
export class InstancedLabelsManager {
  labels: Label[] = [];
  private groups = new Map<string, InstancedLabelGroup>();
  private pxPerUnit: number;

  constructor(pxPerUnit: number = 48) {
    this.pxPerUnit = pxPerUnit;
  }

  addLabel(label: Label) {
    const key = `${label.font}|${label.fontSize}|${label.fontWeight}`;
    let group = this.groups.get(key);

    if (!group) {
      group = new InstancedLabelGroup({
        font: label.font,
        fontSize: label.fontSize,
        fontWeight: label.fontWeight,
      });
      this.groups.set(key, group);
    }

    group.addLabel(label);
    this.labels.push(label);
  }

  removeLabel(label: Label) {
    const idx = this.labels.indexOf(label);
    if (idx < 0) return;

    this.labels.splice(idx, 1);

    const key = `${label.font}|${label.fontSize}|${label.fontWeight}`;
    const group = this.groups.get(key);
    if (group) {
      group.removeLabel(label);
      if (group.labels.length === 0) {
        this.groups.delete(key);
      }
    }
  }

  clear() {
    this.labels = [];
    this.groups.clear();
  }

  buildMeshes(): Mesh[] {
    const meshes: Mesh[] = [];

    for (const group of this.groups.values()) {
      const visibleLabels = group.labels.filter((l) => l.visible);
      if (visibleLabels.length === 0) continue;

      const atlas = group.getAtlas();
      meshes.push(...this._buildMesh(visibleLabels, atlas));
    }

    return meshes;
  }

  private _buildMesh(labels: Label[], atlas: SDFAtlas): Mesh[] {
    const labelInstances = [];

    for (const label of labels) {
      labelInstances.push(layoutText(label, atlas.glyphs, this.pxPerUnit).label);
    }

    const geometry = buildLabelGeometry(
      labelInstances,
      this.pxPerUnit
    );

    const fillMesh = new Mesh(geometry, createFillMaterial(atlas));
    const haloMesh = new Mesh(geometry, createHaloMaterial(atlas));

    haloMesh.renderOrder = 0;
    fillMesh.renderOrder = 1;

    haloMesh.frustumCulled = false;
    fillMesh.frustumCulled = false;

    return [haloMesh, fillMesh];
  }
}

// REACT COMPONENT
export interface InstancedLabelsProps {
  items: Item[];
  halo: boolean;
  viewportPredicate: (item: Item) => boolean;
  fontSize?: number;
  pxPerUnit?: number;
}

export function InstancedLabelsComponent({
  items,
  halo,
  viewportPredicate,
  fontSize = 20,
  pxPerUnit = 64,
}: InstancedLabelsProps) {
  const groupRef = useRef<Group>(null);

  const manager = useMemo(() => {
    const m = new InstancedLabelsManager(pxPerUnit);
    items.forEach(item => {
      m.addLabel(new Label({
        text: item.text,
        position: item.position,
        rotation: item.rotation,
        rotationAlignment: 1,
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
    });
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
        mat.forEach((m) => m.dispose());
      } else {
        mat.dispose();
      }
    }

    // Clear old children
    groupRef.current.children.length = 0;

    // Add new meshes
    meshes.forEach((mesh) => groupRef.current?.add(mesh));
  }, [meshes]);

  return <group ref={groupRef} />;
}
