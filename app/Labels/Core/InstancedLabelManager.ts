import { fontKeyOf, fontKeyString } from "../Font/FontKey";
import layoutText from "../Layout/TextLayout";
import { LabelFontGroup, DirtyLevel } from "./LabelFontGroup";
import { Label } from "./Label";
import { LabelMeshGroup } from "../Render/Meshes/LabelMeshGroup";
import type { LabelMesh } from "../Render/Meshes/LabelMeshGroup";
import { Camera, Frustum, Matrix4 } from "three";
import { toLabelInstance } from "../Utils/LabelUtils";

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
  cullingRate = 0.1; // seconds

  private groups = new Map<string, LabelGroup>();
  private pxPerUnit: number;

  private readonly _frustum = new Frustum();
  private readonly _mat4 = new Matrix4();
  private readonly _lastVP = new Matrix4();
  private _vpChanged = true;

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

    this._vpChanged = true;
  }

  removeLabel(label: Label) {
    this.removeLabels([label]);
  }

  /** Remove labels from their font group and mesh group. */
  removeLabels(labels: Label[]) {
    const byKey = new Map<string, Label[]>();
    for (const label of labels) {
      const key = fontKeyString(fontKeyOf(label));
      if (!key) {
        console.warn(`InstancedLabelManager.removeLabels - Label ${label.id} not found in manager`);
        continue;
      }
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
    }
  }

  /** Manually flush all dirty groups (use when autoUpdate = false). */
  update() {
    for (const group of this.groups.values()) {
      let hasDirty = false;
      for (const s of group.fontGroup.dirtyLabelsMap.values()) {
        if (s.size > 0) { hasDirty = true; break; }
      }
      if (hasDirty) this._syncGroup(group);
    }
    this._vpChanged = true;
  }

  // todo : use listeners to avoid looping every frame ?
  cull(camera: Camera) {
    this._mat4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!this._vpChanged && this._mat4.equals(this._lastVP)) return;
    this._lastVP.copy(this._mat4);
    this._vpChanged = false;
    this._frustum.setFromProjectionMatrix(this._mat4);

    for (const group of this.groups.values()) {
      group.meshGroup.cullByFrustum(group.fontGroup.labels, this._frustum);
    }
  }

  /** Release all font groups, mesh groups, and GPU resources. */
  dispose() {
    for (const group of this.groups.values()) {
      group.fontGroup.dispose();
      group.meshGroup.dispose();
    }
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
      queueMicrotask(() => {
        this._syncGroup(group);
        this._vpChanged = true;
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
      disposeLabels.push(...changeGroup);
      this.addLabels(changeGroup);
    }

    const { atlas, dirty } = fontGroup.getAtlas();

    if (dirty) {
      meshGroup.syncAtlas(atlas);
    }

    meshGroup.update(
      addLabels.map(l => layoutText(l, atlas.glyphs, this.pxPerUnit)),
      disposeLabels.map(l => l.id),
      updateLabels.map(l => dirty ? layoutText(l, atlas.glyphs, this.pxPerUnit) : toLabelInstance(l)),
    );

    fontGroup.flushDirty();
  }
}
