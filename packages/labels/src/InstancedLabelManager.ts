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

  /** Earliest `performance.now()` at which a pass may open. */
  private _nextCullTime = 0;
  private _lastFrameTime = 0;

  /**
   * @param renderer - Renderer the labels are drawn with. Its canvas size, in
   * CSS px, sets label size and placement.
   * @param options - Overrides merged over {@link DefaultLabelConfig}.
   */
  constructor(renderer: WebGLRenderer, options?: Partial<LabelManagerConfig>) {
    this.config = { ...DefaultLabelConfig, ...options };
    const maxTextureSize = renderer.capabilities.maxTextureSize;
    this.collision = new LabelCollisionEngine(renderer, this.config);
    this._atlasManager = new LabelAtlasManager(this.config, maxTextureSize);
    this._meshManager = new LabelMeshManager(this.config, this._atlasManager.atlas, maxTextureSize);
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
   * on the next sync, and are placed by the next placement pass.
   *
   * @param labels - Labels to add; any already owned are ignored.
   */
  addLabels(labels: Label[]) {
    this._atlasManager.addLabels(labels);
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
  }

  /** Releases every label at once. See {@link removeLabels}. */
  clear() {
    this.removeLabels([...this._atlasManager.labels]);
  }

  /**
   * Flush pending label work to the GPU. Runs automatically on the microtask
   * after any change while `config.autoUpdate` is on, and has to be called
   * explicitly when it is off.
   *
   * @throws {RangeError} If the label data outgrows the device's texture size.
   */
  update() {
    if (!this._atlasManager.hasDirty) return;
    this._sync();
  }

  /**
   * Re-place labels at `config.cullingRate`, step the fades,
   * and rewrite the draw list if anything changed. Call once per rendered frame,
   * before the renderer draws.
   *
   * @param camera - Its `projectionMatrix`, `matrixWorld` and
   * `matrixWorldInverse` must be up to date.
   */
  cull(camera: Camera) {
    const now = performance.now();
    const frameDelta = now - this._lastFrameTime;
    this._lastFrameTime = now;

    let visualNeedUpdate = false;

    if (now >= this._nextCullTime) {
      const interval = this.config.cullingRate * 1000;
      if (this.collision.isPassActive) {
        // A pass still running at its own tick skips that slot, so starts stay
        // a whole multiple of the rate apart.
        this._nextCullTime += interval;
      } else if (this.collision.beginPass(camera)) {
        this._nextCullTime = now + interval;
      }
      // A refused pass leaves the slot open, so placement starts on the frame
      // the view moves.
    }
    if (this.collision.stepPass(this.config.placementBudgetMs)) visualNeedUpdate = true;

    const labels = this._atlasManager.labels;

    // Fades step every frame, independently of the placement cadence above.
    const fadeDelta = frameDelta / this.config.fadeDurationMs;

    for (const label of labels) {
      // 0 is fully drawn. A hidden label disappears at once; placement drops it
      // on its next pass.
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
    const { resize } = this._atlasManager.syncAtlas();
    const { add, relayout, update, dispose } = this._atlasManager.flushDirty();

    // Both consumers key removals by id, so build the list once.
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

    // One resolver per distinct font, not per label.
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
