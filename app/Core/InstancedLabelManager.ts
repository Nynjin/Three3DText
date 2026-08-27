import type { Camera, WebGLRenderer } from 'three';
import layoutText from './Shaping/TextLayout';
import { LabelAtlasManager } from './LabelAtlasManager';
import type { Label } from './Label';
import type { GlyphResolver } from './Shaping/GlyphRun';
import { LabelMeshGroup } from './Rendering/LabelMeshGroup';
import type { LabelMesh } from './Rendering/LabelMeshGroup';
import { LabelCollisionEngine } from './Collision/LabelCollisionEngine';
import { type LabelManagerConfig, DefaultLabelConfig } from './Types/LabelConfig';

export interface LabelMeshPair {
  fill: LabelMesh;
  halo: LabelMesh;
}

export class InstancedLabelManager {
  readonly config: LabelManagerConfig;
  private _lastCullTime = 0;
  private _lastFrameTime = 0;

  /** All labels share one atlas and one mesh pair, whatever font they use. */
  private readonly atlasManager: LabelAtlasManager;
  private readonly meshGroup = new LabelMeshGroup();

  readonly mesh: LabelMeshPair;

  collision: LabelCollisionEngine;

  constructor(renderer: WebGLRenderer, options?: Partial<LabelManagerConfig>) {
    this.config = { ...DefaultLabelConfig, ...options };
    this.collision = new LabelCollisionEngine(renderer, this.config);
    this.atlasManager = new LabelAtlasManager(this.config);
    this.mesh = { fill: this.meshGroup.fillMesh, halo: this.meshGroup.haloMesh };

    this.atlasManager.onChange(() => {
      if (!this.config.autoUpdate) return;
      queueMicrotask(() => this.update());
    });
  }

  addLabel(label: Label) {
    this.addLabels([label]);
  }

  addLabels(labels: Label[]) {
    this.atlasManager.addLabels(labels);
    this._lastCullTime = 0;
  }

  removeLabel(label: Label) {
    this.removeLabels([label]);
  }

  removeLabels(labels: Label[]) {
    this.atlasManager.removeLabels(labels);
    this._lastCullTime = 0;
  }

  update() {
    if (!this.atlasManager.hasDirty) return;
    this._sync();
    this._lastCullTime = 0;
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

    const labels = this.atlasManager.labels;

    // keep evaluating on label fading out/in
    if (!evaluated) {
      for (const label of labels) {
        if (label.shouldRender || label.occlusionFade === 0) continue;
        if (this.collision.evaluate(camera)) visualNeedUpdate = true;
        break;
      }
    }

    const fadeDelta = frameDelta / this.config.fadeDurationMs;

    for (const label of labels) {
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

    this.meshGroup.cull(labels);
  }

  dispose() {
    this.atlasManager.dispose();
    this.meshGroup.dispose();
    this.collision.dispose();
  }

  /**
   * Rasterizes pending glyphs, then pushes the pending label work to the mesh.
   * The atlas syncs first: a resize moves existing glyphs, which promotes every
   * label to a relayout.
   */
  private _sync() {
    const { atlas } = this.atlasManager;
    const { dirty } = this.atlasManager.syncAtlas();
    const { add, relayout, update, dispose } = this.atlasManager.flushDirty();

    // Both consumers key removals by id — build the list once.
    const disposedIds = dispose.map(label => label.id);

    this.collision.removeLabels(disposedIds);
    this.collision.addLabels(add);

    // One resolver per distinct font, not per label.
    const resolvers = new Map<string, GlyphResolver>();
    const layout = (label: Label) => {
      let resolve = resolvers.get(label.fontKeyStr);
      if (!resolve) {
        resolve = atlas.resolverFor(label.fontKey);
        resolvers.set(label.fontKeyStr, resolve);
      }
      return layoutText(label, resolve, atlas.metrics, this.config.pxPerUnit);
    };

    // Layout mutates the label in place, so these arrays are reused as-is.
    // `update` is ours from flushDirty: extend it rather than build a third array.
    for (const label of add) layout(label);
    for (const label of relayout) {
      layout(label);
      update.push(label);
    }

    this.meshGroup.update(
      add,
      disposedIds,
      update,
      dirty ? atlas : undefined,
    );

    this.meshGroup.cull(this.atlasManager.labels);
  }
}
