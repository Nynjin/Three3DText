import { fontKeyOf, fontKeyString } from "../Font/FontKey";
import layoutText from "../Layout/TextLayout";
import { LabelFontGroup, DirtyLevel } from "./LabelFontGroup";
import { Label } from "./Label";
import { LabelMeshGroup } from "../Render/Meshes/LabelMeshGroup";
import type { LabelMesh } from "../Render/Meshes/LabelMeshGroup";
import type { LabelInstance } from "../Layout/GlyphRun";

interface LabelGroup {
  fontGroup: LabelFontGroup;
  meshGroup: LabelMeshGroup;
}

export interface LabelMeshPair {
  fill: LabelMesh;
  halo: LabelMesh;
}

/** Build the label-level subset of a LabelInstance (no glyphs or layout). */
function labelStyleOf(label: Label): LabelInstance {
  return {
    id: label.id,
    position: label.position.clone(),
    rotation: label.rotation.clone(),
    color: label.color.clone(),
    haloColor: label.haloColor.clone(),
    opacity: label.opacity,
    haloOpacity: label.hasHalo() ? label.haloOpacity : 0,
    haloWidth: label.haloWidth,
    haloBlur: label.haloBlur,
    visible: (label.visible && label.opacity + label.haloOpacity > 0) ? 1 : 0,
    rotationAlignment: label.rotationAlignment,
    symbolPlacement: label.symbolPlacement,
    glyphs: [],
  };
}

export class InstancedLabelManager {
  autoUpdate = true;

  private labelToKey = new Map<Label, string>();
  private groups = new Map<string, LabelGroup>();
  private pxPerUnit: number;
  private _pendingGroups = new Set<LabelGroup>();

  readonly meshes: LabelMeshPair[] = [];

  constructor(pxPerUnit = 48) {
    this.pxPerUnit = pxPerUnit;
  }

  addLabel(label: Label) {
    this.addLabels([label]);
  }

  /** Add labels then groups them by font key and delegates to font groups. */
  addLabels(labels: Label[]) {
    const byKey = new Map<string, Label[]>();
    for (const label of labels) {
      const key = fontKeyString(fontKeyOf(label));
      this.labelToKey.set(label, key);
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = [];
        byKey.set(key, bucket);
      }
      bucket.push(label);
    }

    for (const [key, bucket] of byKey) {
      const group = this._getOrCreate(key, bucket[0]);
      group.fontGroup.addLabels(bucket);
    }
  }

  removeLabel(label: Label) {
    this.removeLabels([label]);
  }

  /** Remove labels from their font group and mesh group. */
  removeLabels(labels: Label[]) {
    const byKey = new Map<string, Label[]>();
    for (const label of labels) {
      const key = this.labelToKey.get(label);
      if (!key) {
        console.warn(`InstancedLabelManager.removeLabels - Label ${label.id} not found in manager`);
        continue;
      }
      this.labelToKey.delete(label);
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = [];
        byKey.set(key, bucket);
      }
      bucket.push(label);
    }

    for (const [key, bucket] of byKey) {
      const group = this.groups.get(key);
      if (!group) continue;
      group.fontGroup.removeLabels(bucket);
      group.meshGroup.removeLabels(bucket.map(l => l.id));
    }
  }

  /** Manually flush all dirty groups (use when autoUpdate = false). */
  update() {
    for (const group of this.groups.values()) {
      const hasDirty = [...group.fontGroup.dirtyLabelsMap.values()].some(s => s.size > 0);
      if (hasDirty) this._syncGroup(group);
    }
  }

  /** Release all font groups, mesh groups, and GPU resources. */
  dispose() {
    for (const group of this.groups.values()) {
      group.fontGroup.dispose();
      group.meshGroup.dispose();
    }
    this.labelToKey.clear();
    this.groups.clear();
    this.meshes.length = 0;
  }

  private _getOrCreate(key: string, sample: Label): LabelGroup {
    let group = this.groups.get(key);
    if (group) return group;

    const meshGroup = new LabelMeshGroup(this.pxPerUnit);
    const fontGroup = new LabelFontGroup(fontKeyOf(sample));
    group = { fontGroup, meshGroup };

    fontGroup.onChange(() => {
      if (!this.autoUpdate) return;
      if (this._pendingGroups.has(group)) return;
      this._pendingGroups.add(group);
      queueMicrotask(() => {
        this._pendingGroups.delete(group);
        this._syncGroup(group);
      });
    });

    this.groups.set(key, group);
    this.meshes.push({ fill: meshGroup.fillMesh, halo: meshGroup.haloMesh });
    return group;
  }

  private _syncGroup(group: LabelGroup) {
    const { fontGroup, meshGroup } = group;
    const dirtyMap = fontGroup.dirtyLabelsMap;

    const changeGroup = [...(dirtyMap.get(DirtyLevel.ChangeGroup) ?? [])];
    const disposeLabels = [...(dirtyMap.get(DirtyLevel.Dispose) ?? [])];
    const updateLabels = [...(dirtyMap.get(DirtyLevel.Update) ?? [])];
    const addLabels = [...(dirtyMap.get(DirtyLevel.Add) ?? [])];

    if (changeGroup.length) {
      for (const label of changeGroup) this.labelToKey.delete(label);
      disposeLabels.push(...changeGroup);
      this.addLabels(changeGroup);
    }

    if (disposeLabels.length) {
      for (const label of disposeLabels) {
        if (!changeGroup.includes(label)) this.labelToKey.delete(label);
      }
    }

    const { atlas, dirty } = fontGroup.getAtlas();

    if (dirty) {
      meshGroup.syncAtlas(atlas);
    }

    meshGroup.update(
      addLabels.map(l => layoutText(l, atlas.glyphs, this.pxPerUnit)),
      disposeLabels.map(l => l.id),
      updateLabels.map(l => dirty ? layoutText(l, atlas.glyphs, this.pxPerUnit) : labelStyleOf(l)),
    );

    fontGroup.flushDirty();
  }
}
