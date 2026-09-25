import type { Camera, WebGLRenderer } from 'three';
import layoutText from './Shaping/TextLayout';
import { LabelAtlasManager } from './LabelAtlasManager';
import type { Label } from './Label';
import type { GlyphResolver } from './Shaping/GlyphRun';
import { LabelMeshManager, type LabelMesh } from './Rendering/LabelMeshManager';
import { LabelCollisionEngine } from './Collision/LabelCollisionEngine';
import { type LabelManagerConfig, DefaultLabelConfig } from './Types/LabelConfig';

/**
 * Draws a set of labels through one mesh, placing them so they do not overlap.
 *
 * Add {@link mesh} to the scene, add labels, and call {@link cull} once per
 * frame before rendering. Label changes are committed by {@link update}, which
 * runs by itself while `config.autoUpdate` is on. {@link dispose} releases GPU
 * resources; it does not remove the mesh from its parent.
 */
export class InstancedLabelManager {
  /** Settings, read live except where their docs say otherwise. */
  readonly config: LabelManagerConfig;

  /** The mesh to add to the scene. Its own transform is ignored. */
  readonly mesh: LabelMesh;

  /**
   * Placement pass, driven by {@link cull}. Its label set belongs to this
   * manager: call only its pass methods.
   */
  readonly collision: LabelCollisionEngine;

  private readonly _atlasManager: LabelAtlasManager;
  private readonly _meshManager: LabelMeshManager;

  /** Earliest `performance.now()` at which a pass may open. */
  private _nextPassTime = 0;
  private _lastFrameTime = 0;

  /**
   * @param renderer - Renderer the labels are drawn with. Its canvas size, in
   * CSS px, sets label size and placement.
   * @param options - Overrides merged over {@link DefaultLabelConfig}.
   */
  constructor(renderer: WebGLRenderer, options?: Partial<LabelManagerConfig>) {
    const config: LabelManagerConfig = { ...DefaultLabelConfig, ...options };
    this.config = config;

    const maxTextureSize = renderer.capabilities.maxTextureSize;
    this.collision = new LabelCollisionEngine(renderer, config);
    this._atlasManager = new LabelAtlasManager(config, maxTextureSize);
    this._meshManager = new LabelMeshManager(config, this._atlasManager.atlas, maxTextureSize);
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
   * on the next update, and are placed by the next placement pass.
   *
   * @param labels - Labels to add; any already owned are ignored.
   */
  addLabels(labels: Iterable<Label>) {
    this._atlasManager.addLabels(labels);
  }

  /** Removes one label. See {@link InstancedLabelManager.removeLabels}. */
  removeLabel(label: Label) {
    this.removeLabels([label]);
  }

  /**
   * Release labels: their buffer slots are freed on the next update. The label
   * objects are left usable and can be added again.
   *
   * @param labels - Labels to remove; any not owned are ignored.
   */
  removeLabels(labels: Iterable<Label>) {
    this._atlasManager.removeLabels(labels);
  }

  /** Releases every label at once. See {@link removeLabels}. */
  clear() {
    this.removeLabels([...this._atlasManager.labels]);
  }

  /**
   * Commit pending label work to the GPU. Runs on the microtask after a change
   * while `config.autoUpdate` is on. With it off, call it after changes, and
   * after `rtlReady` settles: the shaper queues a relayout of RTL labels.
   *
   * @throws {RangeError} If the label data outgrows the device's texture size.
   */
  update() {
    if (!this._atlasManager.hasDirty) return;
    this._sync();
  }

  /**
   * Opens a placement pass every `config.placementIntervalMs` when the view or
   * the labels changed, advances it within `config.placementBudgetMs`, steps
   * the fades, and rewrites the draw list if anything moved. Call once per
   * rendered frame, before the renderer draws.
   *
   * @param camera - Its `projectionMatrix`, `matrixWorld` and
   * `matrixWorldInverse` must be up to date.
   */
  cull(camera: Camera) {
    const now = performance.now();
    const frameDelta = now - this._lastFrameTime;
    this._lastFrameTime = now;

    let visualNeedUpdate = false;

    if (now >= this._nextPassTime) {
      const interval = this.config.placementIntervalMs;
      if (this.collision.isPassActive) {
        // A pass still running at its own tick skips that slot, so starts stay
        // a whole multiple of the interval apart.
        this._nextPassTime += interval;
      } else if (this.collision.beginPass(camera)) {
        this._nextPassTime = now + interval;
      }
      // A refused pass leaves the slot open, so placement starts on the frame
      // the view moves.
    }
    if (this.collision.stepPass(this.config.placementBudgetMs)) visualNeedUpdate = true;

    const labels = this._atlasManager.labels;
    const fadeDelta = frameDelta / this.config.fadeDurationMs;

    for (const label of labels) {
      // A hidden label disappears at once; placement drops it on its next pass.
      const target = label.shouldRender && label.visible ? 0 : 1;
      if (label.occlusionFade === target) continue;

      visualNeedUpdate = true;

      if (!label.visible) {
        label.occlusionFade = 1;
      } else if (label.occlusionFade < target) {
        label.occlusionFade = Math.min(target, label.occlusionFade + fadeDelta);
      } else {
        label.occlusionFade = Math.max(target, label.occlusionFade - fadeDelta);
      }
    }

    if (visualNeedUpdate) this._meshManager.cull(labels);
  }

  /** Releases every GPU resource. The mesh stays in its parent. */
  dispose() {
    this._atlasManager.dispose();
    this._meshManager.dispose();
    this.collision.dispose();
  }

  /**
   * Rasterizes pending glyphs, then lays out and writes pending label work. The
   * atlas syncs first: a resize moves existing glyphs, which promotes every
   * label to a relayout.
   */
  private _sync() {
    const { atlas } = this._atlasManager;
    const { resize } = this._atlasManager.syncAtlas();
    const { add, relayout, update, dispose } = this._atlasManager.flushDirty();

    const disposedIds = dispose.map(label => label.id);
    for (const label of dispose) {
      label.shouldRender = false;
      label.occlusionFade = 1;
    }

    this.collision.removeLabels(disposedIds);
    this.collision.addLabels(add);
    // A label removed and added back before this sync arrives as a relayout.
    this.collision.addLabels(relayout);
    if (relayout.length > 0 || update.length > 0) this.collision.invalidate();

    const resolvers = new Map<string, GlyphResolver>();
    const layout = (label: Label) => {
      let resolve = resolvers.get(label.fontKeyStr);
      if (!resolve) {
        resolve = atlas.resolverFor(label.fontKey);
        resolvers.set(label.fontKeyStr, resolve);
      }
      layoutText(label, resolve, atlas.metrics);
    };
    for (const label of add) layout(label);
    for (const label of relayout) layout(label);

    this._meshManager.update({ add, relayout, update, remove: disposedIds }, resize);
    this._meshManager.cull(this._atlasManager.labels);
  }
}
