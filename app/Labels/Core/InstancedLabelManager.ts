import { Camera, Matrix4, WebGLRenderer } from "three";
import { fontKeyOf, fontKeyString } from "../Font/FontKey";
import layoutText from "../Layout/TextLayout";
import { LabelFontGroup, DirtyLevel } from "./LabelFontGroup";
import { Label } from "./Label";
import { LabelMeshGroup } from "../Render/Meshes/LabelMeshGroup";
import type { LabelMesh } from "../Render/Meshes/LabelMeshGroup";
import { LabelCollisionEngine } from "./LabelCollisionEngine";

interface LabelGroup {
  fontGroup: LabelFontGroup;
  meshGroup: LabelMeshGroup;
}

export interface LabelMeshPair {
  fill: LabelMesh;
  halo: LabelMesh;
}

export class InstancedLabelManager {
  autoUpdate = true;
  cullingRate = 0.05; // seconds
  private lastCull = 0;

  private readonly groups = new Map<string, LabelGroup>();
  private readonly vp = new Matrix4();
  private readonly lastVp = new Matrix4();
  private readonly labels: Label[] = [];

  private pxPerUnit: number;

  readonly meshes: LabelMeshPair[] = [];

  collision: LabelCollisionEngine;

  constructor(pxPerUnit = 48, renderer: WebGLRenderer) {
    console.log("[label manager] created");
    this.pxPerUnit = pxPerUnit;
    this.collision = new LabelCollisionEngine(renderer, pxPerUnit);
  }

  addLabel(label: Label) {
    this.addLabels([label]);
  }

  addLabels(labels: Label[]) {
    const byKey = new Map<string, Label[]>();
    for (const label of labels) {
      const key = fontKeyString(fontKeyOf(label));
      const bucket = byKey.get(key) ?? [];
      if (!byKey.has(key)) byKey.set(key, bucket);
      bucket.push(label);
    }

    for (const [key, bucket] of byKey) {
      const group = this._getOrCreate(key, bucket[0]);
      group.fontGroup.addLabels(bucket);
    }

    for (const label of labels) {
      if (!this.labels.includes(label)) {
        this.labels.push(label);
      }
    }

    this.lastCull = 0;
  }

  removeLabel(label: Label) {
    this.removeLabels([label]);
  }

  removeLabels(labels: Label[]) {
    const byKey = new Map<string, Label[]>();
    for (const label of labels) {
      const key = fontKeyString(fontKeyOf(label));
      if (!key) continue;
      const bucket = byKey.get(key) ?? [];
      if (!byKey.has(key)) byKey.set(key, bucket);
      bucket.push(label);
    }

    for (const [key, bucket] of byKey) {
      this.groups.get(key)?.fontGroup.removeLabels(bucket);
    }

    if (labels.length > 0) {
      const idSet = new Set(labels.map((label) => label.id));
      const nextLabels: Label[] = [];
      for (const label of this.labels) {
        if (!idSet.has(label.id)) nextLabels.push(label);
      }
      this.labels.length = 0;
      this.labels.push(...nextLabels);
    }

    this.lastCull = 0;
  }

  update() {
    let anyDirty = false;
    for (const group of this.groups.values()) {
      let hasDirty = false;
      for (const s of group.fontGroup.dirtyLabelsMap.values()) {
        if (s.size > 0) {
          hasDirty = true;
          break;
        }
      }
      if (hasDirty) {
        anyDirty = true;
        this._syncGroup(group);
      }
    }

    if (anyDirty) {
      this.lastCull = 0;
    }
  }

  cull(camera: Camera) {
    if (performance.now() - this.lastCull < this.cullingRate * 1000) {
      return;
    }

    this.collision.setLabels(this.labels);
    this.collision.evaluate(camera);

    for (const group of this.groups.values()) {
      group.meshGroup.cull(group.fontGroup.labels);
    }

    this.lastCull = performance.now();
  }

  dispose() {
    console.log("[label manager] disposing");
    for (const group of this.groups.values()) {
      group.fontGroup.dispose();
      group.meshGroup.dispose();
    }
    this.groups.clear();
    this.meshes.length = 0;
    this.collision.dispose();
  }

  private _getOrCreate(key: string, sample: Label): LabelGroup {
    const existing = this.groups.get(key);
    if (existing) return existing;

    const meshGroup = new LabelMeshGroup();
    const fontGroup = new LabelFontGroup(fontKeyOf(sample));
    const group = { fontGroup, meshGroup };

    fontGroup.onChange(() => {
      if (!this.autoUpdate) return;
      queueMicrotask(() => {
        this._syncGroup(group);
      });
    });

    this.groups.set(key, group);
    this.meshes.push({ fill: meshGroup.fillMesh, halo: meshGroup.haloMesh });
    return group;
  }

  private _syncGroup(group: LabelGroup) {
    const { fontGroup, meshGroup } = group;
    const { atlas, dirty } = fontGroup.getAtlas();
    const dirtyMap = fontGroup.dirtyLabelsMap;

    const changeGroup = [...(dirtyMap.get(DirtyLevel.ChangeGroup) ?? [])];
    const disposeLabels = [...(dirtyMap.get(DirtyLevel.Dispose) ?? [])];
    const updateLabels = [...(dirtyMap.get(DirtyLevel.Update) ?? [])];
    const addLabels = [...(dirtyMap.get(DirtyLevel.Add) ?? [])];

    if (changeGroup.length) {
      disposeLabels.push(...changeGroup);
      this.addLabels(changeGroup);
    }

    const addSet = new Set(addLabels);
    const filteredUpdateLabels = updateLabels.filter((label) => !addSet.has(label));

    meshGroup.update(
      addLabels.map((label) => layoutText(label, atlas.glyphs, this.pxPerUnit)),
      disposeLabels.map((label) => label.id),
      filteredUpdateLabels.map((label) => dirty ? layoutText(label, atlas.glyphs, this.pxPerUnit) : label),
      dirty ? atlas : undefined,
    );

    fontGroup.flushDirty();
  }
}
