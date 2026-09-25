import { type Camera, Matrix4, Vector2, Vector3, type WebGLRenderer } from 'three';
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
 * Greedy nearest-first label placement.
 *
 * A pass projects every candidate to a screen-space box and tries to claim that
 * region in a {@link BitmapOccupancy}, nearest label first. Boxes are in CSS
 * px of the renderer's canvas; the bitmap converts them to its cell grid.
 *
 * Two rules favour the status quo: a label not placed by the last pass has its
 * squared distance multiplied by `config.renderPenaltyMultiplier`, and one
 * already placed may claim a region up to `config.occlusionTolerance` taken
 * where a new label needs a free one.
 *
 * Drive it with {@link LabelCollisionEngine.beginPass} and
 * {@link LabelCollisionEngine.stepPass} to spread a pass across frames, or
 * {@link LabelCollisionEngine.evaluate} to run one to completion. Label edits
 * are not observed: call {@link LabelCollisionEngine.invalidate} after them.
 */
export class LabelCollisionEngine {
  /** Tracked labels, by id. */
  private readonly _byId = new Map<string, Label>();

  /**
   * Scan order of a pass. May still hold removed labels until the next
   * {@link beginPass} compacts it; `_listed` mirrors its contents.
   */
  private _labels: Label[] = [];
  private _listed = new Set<Label>();
  private _needsCompact = false;

  /** Labels that passed the open pass's gates, refilled in place per pass. */
  private _candidates: Label[] = [];

  /**
   * Sort keys parallel to `_candidates`. Capacity tracks `_labels.length`, so only
   * the first `_candidates.length` entries are meaningful.
   */
  private _sortKeys = new Float32Array(0);

  /** Forces the next {@link beginPass} to open a pass. */
  private _dirty = true;

  private readonly _renderer: WebGLRenderer;
  private readonly _bitmap: BitmapOccupancy;
  private readonly _projector: LabelProjector;
  private readonly _sorter: RadixSorter;

  /** Canvas size in CSS px, refreshed by `_syncToViewport`. */
  private _screenW = 1;
  private _screenH = 1;

  private readonly _lastVP = new Matrix4();
  private readonly _frustumMatrix = new Matrix4();
  private readonly _scratchAABB: ScreenAABB = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly _tmpVec2 = new Vector2();

  /** The in-flight pass, suspended between chunks. `null` when none is open. */
  private _pass: Generator<void, void, void> | null = null;

  private readonly _config: LabelManagerConfig;

  /**
   * @param renderer - Renderer whose CSS size (`getSize`) is the pixel space of
   * the bitmap. Borrowed, never disposed; re-read on every pass.
   * @param config - Read live, except `downscale` and `atlasFontSize`, read once.
   *
   * @throws {Error} If `config.downscale` is not a power of two.
   */
  constructor(renderer: WebGLRenderer, config: LabelManagerConfig) {
    this._renderer = renderer;
    this._config = config;
    this._bitmap = new BitmapOccupancy(config.downscale);
    this._projector = new LabelProjector(config);
    this._sorter = new RadixSorter();
    this._syncToViewport();
  }

  /**
   * Track labels; any already tracked are skipped. A pass in flight keeps
   * running and does not consider them.
   */
  addLabels(labels: Iterable<Label>) {
    for (const label of labels) {
      if (this._byId.get(label.id) === label) continue;
      this._byId.set(label.id, label);
      if (!this._listed.has(label)) {
        this._labels.push(label);
        this._listed.add(label);
      }
      this._dirty = true;
    }
  }

  /**
   * Stop tracking labels by id; untracked ids are ignored. A pass in flight
   * skips them from here on. Their `shouldRender` is left as it was.
   */
  removeLabels(ids: Iterable<string>) {
    for (const id of ids) {
      if (!this._byId.delete(id)) continue;
      this._needsCompact = true;
      this._dirty = true;
    }
  }

  /** Force the next {@link beginPass} to open a pass, after a tracked label changed. */
  invalidate() {
    this._dirty = true;
  }

  /** Whether a placement pass is part-way through. */
  get isPassActive(): boolean {
    return this._pass !== null;
  }

  /**
   * Open a placement pass for this camera, replacing any open one.
   *
   * Skipped when there are no labels, or when nothing called for one: the engine
   * is not dirty, the bitmap's cell grid is unchanged, and no element of the
   * view-projection matrix moved more than `config.viewProjThreshold`.
   *
   * @param camera - Its `projectionMatrix`, `matrixWorld` and `matrixWorldInverse`
   * must be up to date.
   *
   * @returns `true` if a pass opened.
   */
  beginPass(camera: Camera): boolean {
    if (this._needsCompact) this._compact();
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
    this._pass = this._run(new Vector3().setFromMatrixPosition(camera.matrixWorld), n);
    return true;
  }

  /**
   * One whole pass over the first `n` labels, suspending between chunks. The eye
   * position is fixed when the pass opens.
   */
  private* _run(eye: Vector3, n: number): Generator<void, void, void> {
    let count = 0;
    for (let at = 0; at < n; at += COLLECT_CHUNK) {
      count = this._collectChunk(at, Math.min(n, at + COLLECT_CHUNK), count, eye);
      yield;
    }

    const order = this._sorter.sort(this._sortKeys, count);
    yield;

    for (let at = 0; at < count; at += PLACE_CHUNK) {
      this._placeChunk(order, at, Math.min(count, at + PLACE_CHUNK));
      yield;
    }
  }

  /**
   * Advance the open pass until `budgetMs` has elapsed or the pass ends. Runs
   * at least one step and reads the clock only between steps, so a call can
   * overrun; the sort is a single step. Labels the pass has not reached keep
   * their `shouldRender`.
   *
   * @param budgetMs - Milliseconds to spend. `Infinity` finishes the pass.
   *
   * @returns `true` if a pass was open and advanced.
   */
  stepPass(budgetMs: number): boolean {
    const pass = this._pass;
    if (!pass) return false;

    const deadline = performance.now() + budgetMs;
    do {
      if (pass.next().done) {
        this._pass = null;
        return true;
      }
    } while (performance.now() < deadline);
    return true;
  }

  /**
   * Run a whole pass now: a new one if {@link beginPass} opens one, otherwise
   * the rest of the open pass.
   *
   * @returns `true` if a pass ran.
   */
  evaluate(camera: Camera): boolean {
    if (!this.beginPass(camera) && !this._pass) return false;
    this.stepPass(Infinity);
    return true;
  }

  /** No-op: this engine holds no GPU resources, and the renderer is borrowed. */
  dispose() {}

  // ─── Internals ────────────────────────────────────────────────────────────

  private _isTracked(label: Label): boolean {
    return this._byId.get(label.id) === label;
  }

  /** Drops removed labels from the scan order. */
  private _compact() {
    this._labels = this._labels.filter(label => this._isTracked(label));
    this._listed = new Set(this._labels);
    this._needsCompact = false;
    this._pass = null;
  }

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
      if (!this._isTracked(label)) continue;

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
   * `candidates`, with their sort keys. A label failing a gate stops rendering.
   *
   * @returns `count` plus the candidates this chunk appended.
   */
  private _collectChunk(from: number, to: number, count: number, eye: Vector3): number {
    const keys = this._sortKeys;
    const candidates = this._candidates;

    const ex = eye.x,
      ey = eye.y,
      ez = eye.z;
    const penalty = this._config.renderPenaltyMultiplier;
    const nearSq = this._config.labelNear ** 2;
    const farSq = this._config.labelFar ** 2;

    for (let i = from; i < to; i++) {
      const label = this._labels[i];
      if (!this._isTracked(label)) continue;

      const p = label.position;
      const dx = p.x - ex,
        dy = p.y - ey,
        dz = p.z - ez;

      // The penalty applies to the sort key only; the range test uses raw distance.
      const distSq = dx * dx + dy * dy + dz * dz;
      const key = label.shouldRender ? distSq : distSq * penalty;

      const isValid
        = distSq >= nearSq
          && distSq <= farSq
          && label.visible
          && label.glyphs.length > 0
          // The sorter throws on an infinite key.
          && Number.isFinite(key)
          && this._projector.checkVisible(label);

      if (!isValid) {
        label.shouldRender = false;
        continue;
      }

      keys[count] = key;
      candidates[count] = label;
      count++;
    }

    return count;
  }

  /**
   * Re-read the canvas size and match the bitmap to it.
   *
   * @returns `true` if the bitmap's cell grid changed, which clears it; a
   * resize within the same grid returns `false`.
   */
  private _syncToViewport(): boolean {
    const size = this._renderer.getSize(this._tmpVec2);
    this._screenW = Math.max(1, size.x);
    this._screenH = Math.max(1, size.y);
    return this._bitmap.resize(this._screenW, this._screenH);
  }
}

/**
 * Largest absolute element-wise difference between two matrices, compared
 * against `config.viewProjThreshold`.
 */
function matrixMaxDiff(a: Matrix4, b: Matrix4): number {
  let max = 0;
  for (let i = 0; i < 16; i++) {
    max = Math.max(max, Math.abs(a.elements[i] - b.elements[i]));
  }
  return max;
}
