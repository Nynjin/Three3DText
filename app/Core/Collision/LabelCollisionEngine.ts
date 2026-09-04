import { type Camera, Matrix4, Vector2, type WebGLRenderer } from 'three';
import type { Label } from '../Label';
import { BitmapOccupancy } from './BitmapOccupancy';
import { LabelProjector, type ScreenAABB } from './LabelProjector';
import { RadixSorter } from '../Utils/Sort';
import type { LabelManagerConfig } from '../Types/LabelConfig';

/**
 * @description Greedy nearest-first label culling.
 *
 * Each evaluation projects every candidate to a screen-space AABB and tries to
 * claim that region in a {@link BitmapOccupancy}, nearest label first, so a
 * near label takes its region before anything behind it can contest it.
 * Everything works in screen pixels; the bitmap converts to its cell grid.
 *
 * Two rules favour the status quo, or labels flicker between frames: a label
 * culled last frame sorts as if it were further away, and one already on screen
 * may claim a region up to `config.occlusionTolerance` taken where a new label
 * needs a free one.
 *
 * @see {@link LabelCollisionEngine.evaluate} for the per-frame entry point.
 */
export class LabelCollisionEngine {
  private _labels: Label[] = [];

  /** Membership mirror of `labels`, so an append does not have to scan it. */
  private _tracked = new Set<Label>();

  /** Labels that passed this frame's gates, refilled in place per evaluation. */
  private _candidates: Label[] = [];

  /**
   * Sort keys parallel to `candidates`. Capacity tracks `labels.length`, so only
   * the first `candidates.length` entries are meaningful.
   */
  private _sortKeys = new Float32Array(0);

  /** Set by any label-set mutation to force the next evaluation to run. */
  private _dirty = true;

  private readonly _renderer: WebGLRenderer;
  private readonly _bitmap: BitmapOccupancy;
  private readonly _projector: LabelProjector;
  private readonly _sorter: RadixSorter;

  /** Viewport size in pixels, refreshed by `syncToViewport`. */
  private _screenW = 1;
  private _screenH = 1;

  private readonly _lastVP = new Matrix4();

  private readonly _scratchAABB: ScreenAABB = { x0: 0, y0: 0, x1: 0, y1: 0 };

  private readonly _frustumMatrix = new Matrix4();

  private readonly _tmpVec2 = new Vector2();

  private readonly _config: LabelManagerConfig;

  /**
   * @param renderer - Renderer whose drawing-buffer size drives the bitmap
   * resolution. Borrowed, never disposed; re-read on every evaluation.
   * @param config - Shared label-manager settings, held by reference so later
   * edits take effect on the next evaluation.
   *
   * @throws {Error} If `config.downscale` is not a power of two.
   */
  constructor(renderer: WebGLRenderer, config: LabelManagerConfig) {
    this._renderer = renderer;
    this._config = config;
    this._bitmap = new BitmapOccupancy(config.downscale);
    this._projector = new LabelProjector(config);
    this._sorter = new RadixSorter(20, 10);
    this._syncToViewport();
  }

  /**
   * Append labels that are not tracked yet.
   *
   * @param labels - Labels to add; any already tracked are skipped.
   */
  addLabels(labels: Label[]) {
    for (const label of labels) {
      if (this._tracked.has(label)) continue;
      this._tracked.add(label);
      this._labels.push(label);
      this._dirty = true;
    }
  }

  /**
   * Stop tracking labels by id. Untracked ids are ignored, and removed labels
   * keep whatever `shouldRender` they last had.
   */
  removeLabels(ids: string[]) {
    if (ids.length === 0) return;
    const s = new Set(ids);
    this._labels = this._labels.filter(l => !s.has(l.id));
    this._tracked = new Set(this._labels);
    this._candidates.length = 0;
    this._dirty = true;
  }

  /**
   * Recompute `shouldRender` across the tracked labels for this camera.
   *
   * Skipped, touching nothing, while the view has moved no further than
   * `config.viewProjThreshold` and nothing has marked the engine dirty. Labels
   * failing the candidate gate — invisible, transparent, empty or off screen —
   * keep their previous `shouldRender`.
   *
   * @param camera - Its `projectionMatrix` and `matrixWorldInverse` must be up to
   * date.
   *
   * @returns `true` if the pass ran, `false` if it was skipped.
   */
  evaluate(camera: Camera): boolean {
    if (this._labels.length === 0) return false;

    const viewportChanged = this._syncToViewport();

    this._frustumMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const viewDiff = matrixMaxDiff(this._frustumMatrix, this._lastVP);

    if (
      !this._dirty
      && !viewportChanged
      && viewDiff <= this._config.viewProjThreshold
    ) {
      return false;
    }

    this._projector.setFrame(
      camera.matrixWorldInverse,
      camera.projectionMatrix,
      this._screenW,
      this._screenH,
    );

    this._lastVP.copy(this._frustumMatrix);
    this._bitmap.clear();
    this._dirty = false;

    const count = this._collectCandidates(camera);
    const order = this._sorter.sort(this._sortKeys, count);

    const occlusionTolerance = this._config.occlusionTolerance;
    const maxX = this._screenW - 1;
    const maxY = this._screenH - 1;

    const aabb = this._scratchAABB;
    for (let i = 0; i < count; i++) {
      const label = this._candidates[order[i]];

      // A label hanging off the viewport edge is dropped rather than clipped:
      // a clipped box would claim less space than the glyphs actually cover.
      const placeable
        = this._projector.project(label, aabb)
          && aabb.x0 >= 0
          && aabb.y0 >= 0
          && aabb.x1 <= maxX
          && aabb.y1 <= maxY;

      if (!placeable) {
        label.shouldRender = false;
        continue;
      }

      label.shouldRender = this._bitmap.tryClaim(
        aabb.x0,
        aabb.y0,
        aabb.x1,
        aabb.y1,
        label.shouldRender ? occlusionTolerance : 0,
      );
    }

    return true;
  }

  /** No-op: this engine holds no GPU resources, and the renderer is borrowed. */
  dispose() {}

  // ─── Internals ────────────────────────────────────────────────────────────

  /**
   * Refill `candidates` and `sortKeys` from `labels` for the current frame.
   *
   * Keys are squared distances, left unrooted since the sort only compares them,
   * so `config.renderPenaltyMultiplier` scales squared distance and the order is
   * coarser near the camera than far from it.
   *
   * @returns Number of candidates written.
   */
  private _collectCandidates(camera: Camera): number {
    const n = this._labels.length;

    if (this._sortKeys.length < n) {
      this._sortKeys = new Float32Array(Math.max(n, this._sortKeys.length * 2));
    }
    const keys = this._sortKeys;

    // Refill in place; a fresh array here would churn the GC every frame.
    const candidates = this._candidates;
    candidates.length = 0;

    const camPos = camera.position;
    const cx = camPos.x,
      cy = camPos.y,
      cz = camPos.z;
    const penalty = this._config.renderPenaltyMultiplier;

    let count = 0;
    for (let i = 0; i < n; i++) {
      const label = this._labels[i];
      const p = label.position;
      const dx = p.x - cx,
        dy = p.y - cy,
        dz = p.z - cz;

      let key = dx * dx + dy * dy + dz * dz;
      if (!label.shouldRender) key *= penalty;

      const isValid
        = label.visible
          && label.opacity > 0
          && label.glyphs.length > 0
          // A NaN position slips past checkVisible, since every comparison
          // against NaN is false, and would make the sorter throw.
          && Number.isFinite(key)
          && this._projector.checkVisible(label);

      if (!isValid) continue;

      keys[count] = key;
      candidates[count] = label;
      count++;
    }

    return count;
  }

  /**
   * Re-read the viewport size and match the bitmap to it.
   *
   * @returns `true` if the bitmap's cell grid changed, which has to force a
   * re-evaluation because every region claimed at the old size is gone. A
   * pixel-level resize too small to change the cell grid returns `false`.
   */
  private _syncToViewport(): boolean {
    const size = this._renderer.getSize(this._tmpVec2);
    this._screenW = Math.max(1, size.x);
    this._screenH = Math.max(1, size.y);
    return this._bitmap.resize(this._screenW, this._screenH);
  }
}

// Helper functions

/**
 * Cheap "has the view moved?" metric for `config.viewProjThreshold`.
 *
 * @returns The largest absolute element-wise difference between the two.
 */
function matrixMaxDiff(a: Matrix4, b: Matrix4): number {
  let max = 0;
  for (let i = 0; i < 16; i++) {
    max = Math.max(max, Math.abs(a.elements[i] - b.elements[i]));
  }
  return max;
}
