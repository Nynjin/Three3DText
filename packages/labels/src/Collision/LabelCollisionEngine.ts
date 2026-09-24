import { type Camera, Matrix4, Vector2, type Vector3, type WebGLRenderer } from 'three';
import type { Label } from '../Label';
import { BitmapOccupancy } from './BitmapOccupancy';
import { LabelProjector, type ScreenAABB } from './LabelProjector';
import { RadixSorter } from '../Utils/Sort';
import type { LabelManagerConfig } from '../Types/LabelConfig';

/** Labels scanned per clock check while collecting candidates. */
const COLLECT_CHUNK = 4096;

/** Candidates projected and claimed per clock check while placing. */
const PLACE_CHUNK = 512;

/**
 * Greedy nearest-first label culling.
 *
 * A pass projects every candidate to a screen-space AABB and tries to claim
 * that region in a {@link BitmapOccupancy}, nearest label first, so a near
 * label takes its region before anything behind it can contest it. Everything
 * works in screen pixels; the bitmap converts to its cell grid.
 *
 * Two rules favour the status quo: a label culled last pass sorts as if it were
 * `config.renderPenaltyMultiplier` further away, and one already on screen may
 * claim a region up to `config.occlusionTolerance` taken where a new label
 * needs a free one.
 *
 * Drive it with {@link LabelCollisionEngine.beginPass} and
 * {@link LabelCollisionEngine.stepPass} to spread a pass across frames, or
 * {@link LabelCollisionEngine.evaluate} to run one to completion in a call.
 */
export class LabelCollisionEngine {
  private _labels: Label[] = [];

  /** Membership mirror of `labels`, for constant-time append checks. */
  private _tracked = new Set<Label>();

  /** Labels that passed the open pass's gates, refilled in place per pass. */
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

  /** The in-flight pass, suspended between chunks. `null` when none is open. */
  private _pass: Generator<void, void, void> | null = null;

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
      this._pass = null;
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
    this._pass = null;
  }

  /** Whether a placement pass is part-way through. */
  get isPassActive(): boolean {
    return this._pass !== null;
  }

  /**
   * Open a placement pass for this camera.
   *
   * Skipped, touching nothing, while the view has moved no further than
   * `config.viewProjThreshold` and nothing has marked the engine dirty.
   *
   * @param camera - Its `projectionMatrix` and `matrixWorldInverse` must be up to
   * date.
   *
   * @returns `true` if a pass opened, `false` if there was nothing to do.
   */
  beginPass(camera: Camera): boolean {
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
    const n = this._labels.length;
    if (this._sortKeys.length < n) {
      this._sortKeys = new Float32Array(Math.max(n, this._sortKeys.length * 2));
    }
    this._candidates.length = 0;
    this._pass = this._run(camera.position.clone());
    return true;
  }

  /**
   * One whole pass, suspending between chunks so a caller can spend a frame
   * budget on it. The camera is snapshotted here, so the pass finishes against
   * the view it opened with.
   */
  private* _run(camPos: Vector3): Generator<void, void, void> {
    const n = this._labels.length;

    let count = 0;
    for (let at = 0; at < n; at += COLLECT_CHUNK) {
      count = this._collectChunk(at, Math.min(n, at + COLLECT_CHUNK), count, camPos);
      yield;
    }

    // One indivisible step, so a pass can exceed its budget here.
    const order = this._sorter.sort(this._sortKeys, count);
    yield;

    for (let at = 0; at < count; at += PLACE_CHUNK) {
      this._placeChunk(order, at, Math.min(count, at + PLACE_CHUNK));
      yield;
    }
  }

  /**
   * Advance the open pass for up to `budgetMs`, then yield the frame.
   *
   * Labels are decided in priority order, so those the pass has not reached
   * keep their previous `shouldRender`.
   *
   * @param budgetMs - Wall-clock milliseconds to spend. `Infinity` finishes the
   * pass in one call.
   *
   * @returns `true` if any label was reconsidered, so the draw list needs a
   * rebuild.
   */
  stepPass(budgetMs: number): boolean {
    const pass = this._pass;
    if (!pass) return false;

    const deadline = performance.now() + budgetMs;
    let worked = false;
    do {
      if (pass.next().done) {
        this._pass = null;
        return true;
      }
      worked = true;
    } while (performance.now() < deadline);
    return worked;
  }

  /**
   * Run a whole pass now, ignoring the frame budget.
   *
   * @returns `true` if the pass ran, `false` if it was skipped.
   */
  evaluate(camera: Camera): boolean {
    if (!this.beginPass(camera)) return false;
    this.stepPass(Infinity);
    return true;
  }

  /** No-op: this engine holds no GPU resources, and the renderer is borrowed. */
  dispose() {}

  // ─── Internals ────────────────────────────────────────────────────────────

  /**
   * Project and claim a run of candidates in priority order.
   *
   * @param order - Permutation of `candidates`, nearest first.
   */
  private _placeChunk(order: Int32Array, from: number, to: number) {
    const occlusionTolerance = this._config.occlusionTolerance;
    const maxX = this._screenW - 1;
    const maxY = this._screenH - 1;
    const aabb = this._scratchAABB;

    for (let i = from; i < to; i++) {
      const label = this._candidates[order[i]];

      // A box reaching past the viewport edge fails placement.
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
  }

  /**
   * Append the labels in `[from, to)` that pass this pass's gates to
   * `candidates`, with their sort keys.
   *
   * Keys are squared distances, so `config.renderPenaltyMultiplier` scales
   * squared distance and quantisation is coarser near the camera.
   *
   * @returns `count` plus the candidates this chunk appended.
   */
  private _collectChunk(from: number, to: number, count: number, camPos: Vector3): number {
    const keys = this._sortKeys;
    const candidates = this._candidates;

    const cx = camPos.x,
      cy = camPos.y,
      cz = camPos.z;
    const penalty = this._config.renderPenaltyMultiplier;

    const near = this._config.labelNear;
    const nearSq = near > 0 ? near * near : 0;
    const far = this._config.labelFar;
    const farSq = far === Infinity ? Infinity : far * far;

    for (let i = from; i < to; i++) {
      const label = this._labels[i];
      const p = label.position;
      const dx = p.x - cx,
        dy = p.y - cy,
        dz = p.z - cz;

      // Range test uses raw distance: the penalty below reorders labels but
      // must not move them across the bounds. Out of range clears
      // `shouldRender`, so a label the camera leaves behind stops drawing.
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < nearSq || distSq > farSq) {
        label.shouldRender = false;
        continue;
      }

      const key = label.shouldRender ? distSq : distSq * penalty;

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
