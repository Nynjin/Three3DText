import type { Camera, WebGLRenderer } from 'three';
import layoutText from './Shaping/TextLayout';
import { LabelAtlasManager } from './LabelAtlasManager';
import type { Label } from './Label';
import type { GlyphResolver } from './Shaping/GlyphRun';
import { LabelMeshManager, type LabelMesh } from './Rendering/LabelMeshManager';
import { LabelCollisionEngine } from './Collision/LabelCollisionEngine';
import { type LabelManagerConfig, DefaultLabelConfig } from './Types/LabelConfig';

/** Longest step, in ms, one `cull` advances a fade by. */
const MAX_FADE_STEP_MS = 100;

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

  private readonly _renderer: WebGLRenderer;
  private readonly _atlasManager: LabelAtlasManager;
  private readonly _meshManager: LabelMeshManager;

  /** Earliest `performance.now()` at which a pass may open. */
  private _nextPassTime = 0;
  private _lastFrameTime = 0;
  /** `labelNear`, `labelFar`, `ndcCullMargin` and `renderPenaltyMultiplier` as the last pass saw them. */
  private readonly _placementOptions = [NaN, NaN, NaN, NaN];

  /**
   * Labels the fade loop and the draw list read: every label that is fading, or
   * placed and visible. A hidden label that has fully faded is not in it.
   */
  private readonly _live = new Set<Label>();
  /** The set of drawn labels or their order changed since the draw list was written. */
  private _drawListStale = false;
  private _updateQueued = false;

  /**
   * @param renderer - Renderer the labels are drawn with. Its canvas size, in
   * CSS px, sets label size and placement.
   * @param options - Overrides merged over {@link DefaultLabelConfig}; an
   * `undefined` value keeps the default.
   */
  constructor(renderer: WebGLRenderer, options: Partial<LabelManagerConfig> = {}) {
    const config: LabelManagerConfig = { ...DefaultLabelConfig };
    for (const [key, value] of Object.entries(options) as [string, unknown][]) {
      if (value !== undefined) (config as unknown as Record<string, unknown>)[key] = value;
    }
    this.config = config;

    this._renderer = renderer;
    renderer.domElement.addEventListener('webglcontextrestored', this._onContextRestored);
    const maxTextureSize = renderer.capabilities.maxTextureSize;
    this.collision = new LabelCollisionEngine(renderer, config, label => this._touch(label));
    this._atlasManager = new LabelAtlasManager(config, maxTextureSize);
    this._meshManager = new LabelMeshManager(config, this._atlasManager.atlas, maxTextureSize);
    this.mesh = this._meshManager.mesh;

    this._atlasManager.onChange(() => {
      if (!this.config.autoUpdate || this._updateQueued) return;
      this._updateQueued = true;
      queueMicrotask(() => {
        this._updateQueued = false;
        this.update();
      });
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
   * Runs placement, steps the fades and rewrites the draw list when something
   * changed. Call once per rendered frame, before the renderer draws. A fade
   * advances by at most 100 ms per call.
   *
   * @param camera - Its `projectionMatrix`, `matrixWorld` and
   * `matrixWorldInverse` must be up to date.
   */
  cull(camera: Camera) {
    const now = performance.now();
    const frameDelta = Math.min(now - this._lastFrameTime, MAX_FADE_STEP_MS);
    this._lastFrameTime = now;

    // A change to an option a pass reads opens a pass.
    const { labelNear, labelFar, ndcCullMargin, renderPenaltyMultiplier } = this.config;
    const seen = this._placementOptions;
    if (labelNear !== seen[0] || labelFar !== seen[1] || ndcCullMargin !== seen[2] || renderPenaltyMultiplier !== seen[3]) {
      seen[0] = labelNear;
      seen[1] = labelFar;
      seen[2] = ndcCullMargin;
      seen[3] = renderPenaltyMultiplier;
      this.collision.invalidate();
    }

    if (now >= this._nextPassTime) {
      const interval = this.config.placementIntervalMs;
      if (this.collision.isPassActive) {
        // A pass still running at its own tick skips that slot.
        this._nextPassTime += interval;
      } else if (this.collision.beginPass(camera)) {
        this._nextPassTime = now + interval;
      }
      // A refused pass leaves the slot open.
    }
    this.collision.stepPass(this.config.placementBudgetMs);

    const duration = this.config.fadeDurationMs;
    const fadeDelta = duration > 0 ? frameDelta / duration : Infinity;
    let stale = this._drawListStale;

    for (const label of this._live) {
      // Placement drops a hidden label on its next pass.
      const target = label.shouldRender && label.visible ? 0 : 1;
      if (label.occlusionFade !== target) {
        stale = true;
        label.occlusionFade = label.occlusionFade < target
          ? Math.min(target, label.occlusionFade + fadeDelta)
          : Math.max(target, label.occlusionFade - fadeDelta);
      }
      if (label.occlusionFade === 1 && target === 1) this._live.delete(label);
    }

    if (stale) this._writeDrawList();
  }

  /** Puts `label` in the live set if its fade or placement calls for it, and marks the draw list stale. */
  private _touch(label: Label) {
    this._live.add(label);
    this._drawListStale = true;
  }

  private _writeDrawList() {
    this._drawListStale = false;
    this._meshManager.cull(this._live);
  }

  /**
   * Releases every GPU resource and every label, which stop rendering and can be
   * added to another manager. The mesh stays in its parent.
   */
  dispose() {
    for (const label of this._atlasManager.labels) {
      label.shouldRender = false;
      label.occlusionFade = 1;
    }
    this._live.clear();
    this._renderer.domElement.removeEventListener('webglcontextrestored', this._onContextRestored);
    this._atlasManager.dispose();
    this._meshManager.dispose();
    this.collision.dispose();
  }

  /** A restored context starts with empty textures: the data textures are uploaded whole. */
  private readonly _onContextRestored = () => {
    this._meshManager.requestFullUpload();
  };

  /**
   * Rasterizes pending glyphs, then lays out and writes pending label work.
   */
  private _sync() {
    const { atlas } = this._atlasManager;
    const { resize } = this._atlasManager.syncAtlas();
    const { placement, add, relayout, update, dispose } = this._atlasManager.flushDirty();

    const disposedIds = dispose.map(label => label.id);
    for (const label of dispose) {
      label.shouldRender = false;
      label.occlusionFade = 1;
      this._live.delete(label);
    }
    // A visibility or opacity change is a fade target change.
    for (const label of update) this._touch(label);
    for (const label of relayout) this._touch(label);

    this.collision.removeLabels(disposedIds);
    this.collision.addLabels(add);
    // A label removed and added back before this sync arrives as a relayout.
    this.collision.addLabels(relayout);
    if (placement) this.collision.invalidate();

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
    this._writeDrawList();
  }
}
