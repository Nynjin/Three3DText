import type { Camera, WebGLRenderer } from 'three';
import layoutText from './Shaping/TextLayout';
import { LabelAtlasManager } from './LabelAtlasManager';
import type { Label } from './Label';
import type { GlyphResolver } from './Shaping/GlyphRun';
import { LabelMeshManager, type LabelMesh } from './Rendering/LabelMeshManager';
import { LabelCollisionEngine } from './Collision/LabelCollisionEngine';
import { type LabelManagerConfig, DefaultLabelConfig } from './Types/LabelConfig';

/** Longest fade step per `cull`, in ms. */
const MAX_FADE_STEP_MS = 100;

/**
 * Draws labels through one mesh, placed without overlap.
 *
 * Add {@link mesh} to the scene, add labels, call {@link cull} each frame
 * before rendering. {@link update} commits label changes; automatic while
 * `config.autoUpdate` is on. {@link dispose} does not remove the mesh from its parent.
 */
export class InstancedLabelManager {
  /** Settings, read live unless their docs say otherwise. */
  readonly config: LabelManagerConfig;

  /** Add to the scene. Its own transform is ignored. */
  readonly mesh: LabelMesh;

  /**
   * Placement pass, driven by {@link cull}. Its label set belongs to this
   * manager: call only its pass methods.
   */
  readonly collision: LabelCollisionEngine;

  private readonly _renderer: WebGLRenderer;
  private readonly _atlasManager: LabelAtlasManager;
  private readonly _meshManager: LabelMeshManager;

  /** Earliest `performance.now()` for the next pass. */
  private _nextPassTime = 0;
  private _lastFrameTime = 0;
  /** `labelNear`, `labelFar`, `ndcCullMargin`, `renderPenaltyMultiplier` as last seen by `cull`. */
  private readonly _placementOptions = [NaN, NaN, NaN, NaN];

  /** Labels fading, or placed and visible. Read by the fade loop and the draw list. */
  private readonly _live = new Set<Label>();
  /** Drawn set or order changed since the draw list was written. */
  private _drawListStale = false;
  private _updateQueued = false;

  /**
   * @param renderer - Its canvas size, in CSS px, sets label size and placement.
   * @param options - Merged over {@link DefaultLabelConfig}; `undefined` keeps the default.
   *
   * @throws {RangeError} If `atlasFontSize` implies a glyph cell larger than the
   * device's texture size.
   * @throws {Error} If `downscale` is not a power of two.
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
    this.mesh.material.depthTest = config.depthTest;

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
   * Takes ownership: labels get glyphs, buffer slots and a first layout on the
   * next update, and are placed by the next pass.
   *
   * @param labels - Already owned ones are ignored.
   */
  addLabels(labels: Iterable<Label>) {
    this._atlasManager.addLabels(labels);
  }

  /** Removes one label. See {@link InstancedLabelManager.removeLabels}. */
  removeLabel(label: Label) {
    this.removeLabels([label]);
  }

  /**
   * Releases labels; their buffer slots are freed on the next update. The labels
   * stay usable and can be added again.
   *
   * @param labels - Unowned ones are ignored.
   */
  removeLabels(labels: Iterable<Label>) {
    this._atlasManager.removeLabels(labels);
  }

  /** Releases every label. See {@link removeLabels}. */
  clear() {
    this.removeLabels([...this._atlasManager.labels]);
  }

  /**
   * Commits pending label work to the GPU. Runs on the microtask after a change
   * while `config.autoUpdate` is on. With it off, call it after changes, after
   * `rtlReady` settles, and after a web font a label uses finishes loading.
   *
   * Labels past the data texture limit (4096 texels a side, or the device's
   * limit if smaller) are not drawn until others are removed.
   */
  update() {
    if (!this._atlasManager.hasDirty) return;
    this._sync();
  }

  /**
   * Runs placement, steps fades, rewrites the draw list if needed. Call once per
   * rendered frame, before drawing. A fade advances at most 100 ms per call.
   *
   * @param camera - `projectionMatrix`, `matrixWorld` and `matrixWorldInverse`
   * must be current.
   */
  cull(camera: Camera) {
    const now = performance.now();
    const frameDelta = Math.min(now - this._lastFrameTime, MAX_FADE_STEP_MS);
    this._lastFrameTime = now;

    this.mesh.material.depthTest = this.config.depthTest;

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

  /** Adds `label` to the live set and marks the draw list stale. */
  private _touch(label: Label) {
    this._live.add(label);
    this._drawListStale = true;
  }

  private _writeDrawList() {
    this._drawListStale = false;
    this._meshManager.cull(this._live);
  }

  /**
   * Releases every GPU resource and every label; the labels stop rendering and
   * can join another manager. The manager is unusable afterwards. The mesh stays
   * in its parent.
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

  /** A restored context has empty textures: re-upload the data textures whole. */
  private readonly _onContextRestored = () => {
    this._meshManager.requestFullUpload();
  };

  /** Rasterizes pending glyphs, then lays out and writes pending label work. */
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

    const deferred = this._meshManager.update({ add, relayout, update, remove: disposedIds }, resize);
    if (deferred.length > 0) {
      this.collision.removeLabels(deferred.map(label => label.id));
      for (const label of deferred) {
        label.shouldRender = false;
        this._touch(label);
      }
      this._atlasManager.requeue(deferred);
    }
    this._writeDrawList();
  }
}
