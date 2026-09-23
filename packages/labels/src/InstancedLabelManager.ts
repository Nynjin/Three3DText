import type { Camera, WebGLRenderer } from 'three';
import layoutText from './Shaping/TextLayout';
import { LabelAtlasManager } from './LabelAtlasManager';
import type { Label } from './Label';
import type { GlyphResolver } from './Shaping/GlyphRun';
import { LabelMeshManager } from './Rendering/LabelMeshManager';
import type { LabelMesh } from './Rendering/LabelMeshManager';
import { LabelCollisionEngine } from './Collision/LabelCollisionEngine';
import { type LabelManagerConfig, DefaultLabelConfig } from './Types/LabelConfig';

export class InstancedLabelManager {
  /** Live settings: edits land on the next pass. */
  readonly config: LabelManagerConfig;

  /** The mesh to add to the scene. Labels draw ink and halo through it. */
  readonly mesh: LabelMesh;

  /** Placement pass, driven by {@link cull} and exposed for custom cadences. */
  readonly collision: LabelCollisionEngine;

  /** All labels share one atlas and one mesh. */
  private readonly _atlasManager: LabelAtlasManager;
  private readonly _meshManager: LabelMeshManager;

  private _lastCullTime = 0;
  private _lastFrameTime = 0;

  /**
   * @param renderer - Renderer whose drawing-buffer size drives the collision
   * resolution.
   * @param options - Overrides merged over {@link DefaultLabelConfig}.
   */
  constructor(renderer: WebGLRenderer, options?: Partial<LabelManagerConfig>) {
    this.config = { ...DefaultLabelConfig, ...options };
    this.collision = new LabelCollisionEngine(renderer, this.config);
    this._atlasManager = new LabelAtlasManager(this.config);
    this._meshManager = new LabelMeshManager(this.config);
    this.mesh = this._meshManager.mesh;

    this._atlasManager.onChange(() => {
      if (!this.config.autoUpdate) return;
      queueMicrotask(() => this.update());
    });
  }

  /** Adds one label. See {@link InstancedLabelManager.addLabels}. */
  addLabel(label: Label) {
    this.addLabels([label]);
  }

  /**
   * Take ownership of labels: they get glyphs, buffer slots and a first layout
   * on the next sync, and are placed by the next {@link cull}.
   *
   * @param labels - Labels to add; any already owned are ignored.
   */
  addLabels(labels: Label[]) {
    this._atlasManager.addLabels(labels);
    this._lastCullTime = 0;
  }

  /** Removes one label. See {@link InstancedLabelManager.removeLabels}. */
  removeLabel(label: Label) {
    this.removeLabels([label]);
  }

  /**
   * Release labels: their buffer slots are freed on the next sync. The label
   * objects themselves are left alone, so they can be added again later.
   *
   * @param labels - Labels to remove; any not owned are ignored.
   */
  removeLabels(labels: Label[]) {
    this._atlasManager.removeLabels(labels);
    this._lastCullTime = 0;
  }

  /** Releases every label at once. See {@link removeLabels}. */
  clear() {
    this.removeLabels([...this._atlasManager.labels]);
  }

  /**
   * Flush pending label work to the GPU. Runs automatically on the microtask
   * after any change while `config.autoUpdate` is on, and has to be called
   * explicitly when it is off.
   */
  update() {
    if (!this._atlasManager.hasDirty) return;
    this._sync();
    this._lastCullTime = 0;
  }

  /**
   * Re-place labels at `config.cullingRate`, step the fades,
   * and rewrite the draw list if anything changed. Call once per rendered frame,
   * before the renderer draws.
   *
   * @param camera - Its `projectionMatrix` and `matrixWorldInverse` must be up to
   * date.
   */
  cull(camera: Camera) {
    const now = performance.now();
    const frameDelta = now - this._lastFrameTime;
    this._lastFrameTime = now;

    let visualNeedUpdate = false;

    const cullDelta = now - this._lastCullTime;

    // Evaluate normally at the culling rate
    let evaluated = false;
    if (cullDelta >= this.config.cullingRate * 1000) {
      if (this.collision.evaluate(camera)) visualNeedUpdate = true;
      this._lastCullTime = now;
      evaluated = true;
    }

    const labels = this._atlasManager.labels;

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

    this._meshManager.cull(labels);
  }

  /**
   * Release every resource.
   */
  dispose() {
    this._atlasManager.dispose();
    this._meshManager.dispose();
    this.collision.dispose();
  }

  /**
   * Rasterizes pending glyphs, then pushes pending label work to the mesh. The
   * atlas syncs first: a resize moves existing glyphs, which promotes every label
   * to a relayout.
   */
  private _sync() {
    const { atlas } = this._atlasManager;
    const { dirty } = this._atlasManager.syncAtlas();
    const { add, relayout, update, dispose } = this._atlasManager.flushDirty();

    // Both consumers key removals by id, so build the list once.
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

    // Layout writes back onto the label, so both arrays stay valid. Relaid-out
    // labels are appended to `update`, which flushDirty returns fresh.
    for (const label of add) layout(label);
    for (const label of relayout) {
      layout(label);
      update.push(label);
    }

    this._meshManager.update(
      add,
      disposedIds,
      update,
      dirty ? atlas : undefined,
    );

    this._meshManager.cull(this._atlasManager.labels);
  }
}
