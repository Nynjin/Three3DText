import { useEffect, useMemo, useRef } from "react";
import {
  Mesh,
  Group,
} from "three";
import { Label } from "../Labels/Core/Label";
import buildSDFAtlas, { SDFAtlas } from "../Labels/Font/SDFAtlas";
import layoutText from "../Labels/Layout/TextLayout";
import { buildLabelGeometry } from "../Labels/Render/LabelGeometry";
import { createFillMaterial } from "../Labels/Render/FillMaterial";
import { createHaloMaterial } from "../Labels/Render/HaloMaterial";

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

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCED LABELS CLASS - manages multiple groups
// ─────────────────────────────────────────────────────────────────────────────

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

    return [haloMesh, fillMesh];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REACT HOOK FOR EASY INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

export function useInstancedLabels(pxPerUnit: number = 48) {
  const manager = useMemo(
    () => new InstancedLabelsManager(pxPerUnit),
    [pxPerUnit]
  );
  const groupRef = useRef<Group>(null);

  // Rebuild meshes when labels change
  const meshes = useMemo(() => {
    return manager.buildMeshes();
  }, [manager]);

  return {
    manager,
    meshes,
    group: groupRef,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// REACT COMPONENT FOR RENDERING
// ─────────────────────────────────────────────────────────────────────────────

export interface InstancedLabelsComponentProps {
  manager: InstancedLabelsManager;
}

export function InstancedLabelsComponent({
  manager,
}: InstancedLabelsComponentProps) {
  const groupRef = useRef<Group>(null);

  const meshes = useMemo(() => {
    return manager.buildMeshes();
  }, [manager]);

  useEffect(() => {
    if (!groupRef.current) return;

    // Clear old children
    groupRef.current.children.length = 0;

    // Add new meshes
    meshes.forEach((mesh) => groupRef.current?.add(mesh));
  }, [meshes]);

  return <group ref={groupRef} />;
}
