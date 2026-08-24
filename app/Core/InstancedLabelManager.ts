import type { Camera, WebGLRenderer } from 'three';
import { fontKeyOf, fontKeyString } from './Shaping/FontKey';
import layoutText from './Shaping/TextLayout';
import { LabelFontGroup, DirtyLevel } from './LabelFontGroup';
import type { Label } from './Label';
import { LabelMeshGroup } from './Rendering/LabelMeshGroup';
import type { LabelMesh } from './Rendering/LabelMeshGroup';
import { LabelCollisionEngine } from './Collision/LabelCollisionEngine';
import { type LabelManagerConfig, DefaultLabelConfig } from './Types/LabelConfig';

interface LabelGroup {
  fontGroup: LabelFontGroup;
  meshGroup: LabelMeshGroup;
}

export interface LabelMeshPair {
  fill: LabelMesh;
  halo: LabelMesh;
}

export class InstancedLabelManager {
  readonly config: LabelManagerConfig;
  private _lastCullTime = 0;
  private _lastFrameTime = 0;

  private readonly groups = new Map<string, LabelGroup>();
  private readonly labels: Label[] = [];

  readonly meshes: LabelMeshPair[] = [];

  collision: LabelCollisionEngine;

  constructor(renderer: WebGLRenderer, options?: Partial<LabelManagerConfig>) {
    this.config = { ...DefaultLabelConfig, ...options };
    this.collision = new LabelCollisionEngine(renderer, this.config);
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

    this._lastCullTime = 0;
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
      const idSet = new Set(labels.map(label => label.id));
      const nextLabels: Label[] = [];
      for (const label of this.labels) {
        if (!idSet.has(label.id)) nextLabels.push(label);
      }
      this.labels.length = 0;
      this.labels.push(...nextLabels);
    }

    this._lastCullTime = 0;
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
      this._lastCullTime = 0;
    }
  }

  cull(camera: Camera) {
    const now = performance.now();
    const frameDelta = now - this._lastFrameTime;
    this._lastFrameTime = now;

    let visualNeedUpdate = false;

    const cullDelta = now - this._lastCullTime;

    // Evaluate normally at the culling rate...
    let evaluated = false;
    if (cullDelta >= this.config.cullingRate * 1000) {
      if (this.collision.evaluate(camera)) visualNeedUpdate = true;
      this._lastCullTime = now;
      evaluated = true;
    }

    // keep evaluating on label fading out/in
    const anyMidFade = this.labels.some(
      l => !l.shouldRender && l.occlusionFade > 0,
    );
    if (!evaluated && anyMidFade) {
      if (this.collision.evaluate(camera)) visualNeedUpdate = true;
    }

    const fadeDelta = frameDelta / this.config.fadeDurationMs;

    for (const label of this.labels) {
      const target = label.shouldRender ? 0.0 : 1.0;

      // Lerp the fade state directly on the label object
      if (label.occlusionFade === target) continue;

      visualNeedUpdate = true;

      if (label.occlusionFade < target) {
        label.occlusionFade = Math.min(target, label.occlusionFade + fadeDelta);
      } else {
        label.occlusionFade = Math.max(target, label.occlusionFade - fadeDelta);
      }
    }

    if (!visualNeedUpdate) return;

    for (const group of this.groups.values()) {
      group.meshGroup.cull(group.fontGroup.labels);
    }
  }

  dispose() {
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
      if (!this.config.autoUpdate) return;
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

    this.collision.removeLabels(disposeLabels.map(l => l.id));
    this.collision.addLabels(addLabels);

    const addSet = new Set(addLabels);
    const filteredUpdateLabels = updateLabels.filter(
      label => !addSet.has(label),
    );

    meshGroup.update(
      addLabels.map(label =>
        layoutText(label, atlas.glyphs, this.config.pxPerUnit),
      ),
      disposeLabels.map(label => label.id),
      filteredUpdateLabels.map(label =>
        dirty ? layoutText(label, atlas.glyphs, this.config.pxPerUnit) : label,
      ),
      dirty ? atlas : undefined,
    );

    meshGroup.cull(fontGroup.labels);

    fontGroup.flushDirty();
  }
}
