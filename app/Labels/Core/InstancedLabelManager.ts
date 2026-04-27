import { Camera, Matrix4, Vector3, WebGLRenderer } from "three";
import { fontKeyOf, fontKeyString } from "../Font/FontKey";
import layoutText from "../Layout/TextLayout";
import { LabelFontGroup, DirtyLevel } from "./LabelFontGroup";
import { Label } from "./Label";
import { LabelMeshGroup } from "../Render/Meshes/LabelMeshGroup";
import type { LabelMesh } from "../Render/Meshes/LabelMeshGroup";
import { CollisionDebugSegment, LabelCollisionEngine } from "./LabelCollisionEngine";

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

  private readonly groups = new Map<string, LabelGroup>();
  private readonly vp = new Matrix4();
  private readonly lastVp = new Matrix4();
  private readonly viewPos = new Vector3();
  private readonly labels: Label[] = [];

  private pxPerUnit: number;

  readonly meshes: LabelMeshPair[] = [];

  private collision: LabelCollisionEngine;

  constructor(pxPerUnit = 48, canvas: HTMLCanvasElement, renderer: WebGLRenderer) {
    this.pxPerUnit = pxPerUnit;
    this.collision = new LabelCollisionEngine(canvas, renderer, pxPerUnit);
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

    this.labels.push(...labels);
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
  }

  update() {
    for (const group of this.groups.values()) {
      let hasDirty = false;
      for (const s of group.fontGroup.dirtyLabelsMap.values()) {
        if (s.size > 0) {
          hasDirty = true;
          break;
        }
      }
      if (hasDirty) this._syncGroup(group);
    }
  }

  cull(camera: Camera) {
    this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!this.vp.equals(this.lastVp)) {
      this.lastVp.copy(this.vp);
    }

    this.collision.setLabels(this.labels);
    this.collision.evaluate(camera);

    // this.sortedLabels.sort((a, b) => {
    //     // 1. Temporal Coherence: Absolute priority goes to labels visible in the previous frame
    //     if (a.hasRendered &&!b.hasRendered) return -1;
    //     if (!a.hasRendered && b.hasRendered) return 1;
        
    //     // 2. Depth/Proximity: If both share the exact same render state, sort by distance to camera
    //     return this._depthOf(a, camera) - this._depthOf(b, camera);
    // });


    for (const group of this.groups.values()) {
      group.meshGroup.cull(group.fontGroup.labels);
    }
  }

  getCollisionDebugSegments(camera: Camera, maxSegments = 50000): CollisionDebugSegment[] {
    return this.collision.getDebugSegments(camera, maxSegments);
  }

  dispose() {
    for (const group of this.groups.values()) {
      group.fontGroup.dispose();
      group.meshGroup.dispose();
    }
    this.groups.clear();
    this.meshes.length = 0;
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

  private _depthOf(label: Label, camera: Camera): number {
    this.viewPos.copy(label.position).applyMatrix4(camera.matrixWorldInverse);
    return -this.viewPos.z;
  }
}
