import { type Camera, Matrix4, Vector2, type WebGLRenderer } from 'three';
import type { Label } from '../Label';
import { HierarchicalBitmap } from './HierarchicalBitmap';
import { LabelProjector, type ScreenAABB } from './LabelProjector';
import { RadixSorter } from '../Utils/Sort';
import type { LabelManagerConfig } from '../Types/LabelConfig';

export class LabelCollisionEngine {
  private labels: Label[] = [];

  /**
   * Labels that passed the validity and frustum gates this frame, in `labels`
   * order. Refilled in place by
   * {@link LabelCollisionEngine["collectCandidates"]}; `length` is the live count.
   */
  private candidates: Label[] = [];

  /**
   * Sort keys parallel to `candidates`: squared camera distance scaled by
   * `config.renderPenaltyMultiplier`. Capacity tracks `labels.length`, so only
   * the first `candidates.length` entries are meaningful.
   */
  private sortKeys = new Float32Array(0);

  /** Set by any label-set mutation to force the next evaluation to run. */
  private dirty = true;

  private readonly renderer: WebGLRenderer;
  private readonly downscaleShift: number;
  private readonly bitmap: HierarchicalBitmap;
  private readonly projector: LabelProjector;
  private readonly sorter: RadixSorter;

  private readonly _lastVP = new Matrix4();
  private readonly _lastVPSort = new Matrix4();

  private readonly _scratchAABB: ScreenAABB = { x0: 0, y0: 0, x1: 0, y1: 0 };

  private readonly _frustumMatrix = new Matrix4();

  private readonly _tmpVec2 = new Vector2();

  private readonly config: LabelManagerConfig;

  /**
   * @param renderer - Renderer whose drawing-buffer size drives the bitmap
   * resolution. Borrowed, never disposed; re-read on every evaluation.
   * @param config - Shared label-manager settings, held by reference so later
   * edits take effect on the next evaluation.
   *
   * @throws {Error} If `config.downscale` or `config.coarseScale` is not a
   * power of two.
   */
  constructor(renderer: WebGLRenderer, config: LabelManagerConfig) {
    this.renderer = renderer;
    this.config = config;
    this.downscaleShift = log2OfPow2(config.downscale, 'downscale');
    this.bitmap = new HierarchicalBitmap(config.coarseScale);
    this.projector = new LabelProjector(config);
    this.sorter = new RadixSorter(20, 10);
    this.syncToViewport();
  }

  /**
   * Replace the tracked label set. The array is held by reference, not copied,
   * so later mutations of it are picked up by the next evaluation.
   *
   * @param labels - New label set. Ignored when it is already the tracked
   * array, even if its contents changed — use
   * {@link LabelCollisionEngine.addLabels} to append in that case.
   */
  setLabels(labels: Label[]) {
    if (labels === this.labels) return;
    this.labels = labels;
    // `dirty` forces a refill before `candidates` is read again, so dropping
    // the stale references is all that is needed here.
    this.candidates.length = 0;
    this.dirty = true;
  }

  /**
   * Append labels that are not tracked yet.
   *
   * @param labels - Labels to add; any already tracked are skipped. Costs
   * `O(labels.length * tracked)`, so prefer
   * {@link LabelCollisionEngine.setLabels} for a bulk replacement.
   */
  addLabels(labels: Label[]) {
    for (const label of labels) {
      if (!this.labels.includes(label)) {
        this.labels.push(label);
        this.dirty = true;
      }
    }
  }

  /**
   * Drop every tracked label. Their `shouldRender` keeps whatever value the
   * last evaluation left, since nothing is evaluated after this.
   */
  clear() {
    this.labels = [];
    this.candidates.length = 0;
    this.dirty = true;
  }

  /**
   * Stop tracking labels by id.
   *
   * @param ids - Ids to remove; untracked ids are ignored. Removed labels keep
   * whatever `shouldRender` they last had.
   */
  removeLabels(ids: string[]) {
    if (ids.length === 0) return;
    const s = new Set(ids);
    this.labels = this.labels.filter(l => !s.has(l.id));
    this.candidates.length = 0;
    this.dirty = true;
  }

  /**
   * Recompute `shouldRender` across the tracked labels for this camera.
   *
   * Skipped entirely, touching nothing, when the view-projection matrix has
   * moved no further than `config.viewProjThreshold`, the viewport is
   * unchanged, and no label-set mutation has marked the engine dirty.
   *
   * Labels that fail the candidate gate — invisible, transparent, empty, or
   * outside the frustum — keep their previous `shouldRender`.
   *
   * @param camera - Camera to evaluate against. Its `projectionMatrix` and
   * `matrixWorldInverse` must already be up to date.
   *
   * @returns `true` if the pass ran and some label's `shouldRender` may have
   * changed, `false` if it was skipped.
   */
  evaluate(camera: Camera): boolean {
    if (this.labels.length === 0) return false;
    const viewportChanged = this.syncToViewport();

    this._frustumMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const viewDiff = matrixMaxDiff(this._frustumMatrix, this._lastVP);

    if (
      !this.dirty
      && viewDiff <= this.config.viewProjThreshold
      && !viewportChanged
    ) {
      return false;
    }

    this._lastVP.copy(this._frustumMatrix);

    this.projector.setFrame(
      camera.matrixWorldInverse,
      camera.projectionMatrix,
      this.bitmap.width,
      this.bitmap.height,
    );
    this.bitmap.clear();

    const count = this.collectCandidates(camera);
    const order = this.sorter.sort(this.sortKeys, count);

    this._lastVPSort.copy(this._frustumMatrix);
    this.dirty = false;

    const aabb = this._scratchAABB;
    for (let i = 0; i < count; i++) {
      const label = this.candidates[order[i]];

      if (!this.projector.project(label, aabb)) {
        label.shouldRender = false;
        continue;
      }
      const { x0, y0, x1, y1 } = aabb;

      // Fast-pass: coarse-empty -> guaranteed clear.
      if (this.bitmap.isCoarseEmpty(x0, y0, x1, y1)) {
        this.bitmap.setRegion(x0, y0, x1, y1);
        label.shouldRender = true;
        continue;
      }

      // Slow path: precise count.
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const claimed = this.bitmap.countFine(x0, y0, x1, y1);
      const occlusion = claimed / area;

      let isVisible: boolean;
      if (label.shouldRender) {
        isVisible = occlusion <= this.config.maxOcclusion;
      } else {
        isVisible = occlusion <= this.config.acceptableOcclusion;
      }

      if (isVisible) {
        this.bitmap.setRegion(x0, y0, x1, y1);
        label.shouldRender = true;
      } else {
        label.shouldRender = false;
      }
    }

    return true;
  }

  /**
   * No-op. Everything this engine owns is plain JS or typed-array memory with
   * no GPU resource behind it, and the renderer is borrowed. Kept for symmetry
   * with the disposable parts of the label pipeline.
   */
  dispose() {}

  // ─── Internals ────────────────────────────────────────────────────────────

  /**
   * Refill `candidates` and `sortKeys` from `labels` for the current frame.
   *
   * Distances stay squared: {@link RadixSorter} only ever compares keys and
   * squaring is monotonic, so `config.renderPenaltyMultiplier` keeps the exact
   * meaning it had under the previous comparison sort. The cost is that
   * quantisation buckets are uniform in *squared* distance, making the order
   * coarser near the camera than far from it — immaterial at 20 bits over any
   * plausible scene depth.
   *
   * @param camera - Camera whose position the distances are measured from.
   *
   * @returns Number of candidates written, always `candidates.length`.
   */
  private collectCandidates(camera: Camera): number {
    const labels = this.labels;
    const n = labels.length;

    if (this.sortKeys.length < n) {
      this.sortKeys = new Float32Array(Math.max(n, this.sortKeys.length * 2));
    }
    const keys = this.sortKeys;

    // Refill in place; a fresh array here would churn the GC every frame.
    const candidates = this.candidates;
    candidates.length = 0;

    const camPos = camera.position;
    const cx = camPos.x,
      cy = camPos.y,
      cz = camPos.z;
    const penalty = this.config.renderPenaltyMultiplier;

    let count = 0;
    for (let i = 0; i < n; i++) {
      const label = labels[i];
      const p = label.position;
      const dx = p.x - cx,
        dy = p.y - cy,
        dz = p.z - cz;

      let key = dx * dx + dy * dy + dz * dz;
      // Labels culled last frame sort as if further away, so a label already on
      // screen keeps its region instead of trading it back and forth.
      if (!label.shouldRender) key *= penalty;

      const isValid
        = label.visible
          && label.opacity > 0
          && label.glyphs.length > 0
          && label.bounds.width > 0
          // A NaN position slips past checkVisible, since every comparison
          // against NaN is false, and would make the sorter throw.
          && Number.isFinite(key)
          && this.projector.checkVisible(label);

      label.isCandidate = isValid;
      if (!isValid) continue;

      keys[count] = key;
      candidates[count] = label;
      count++;
    }

    return count;
  }

  /**
   * Resize the bitmap to the renderer's current drawing buffer, scaled down by
   * `config.downscale`.
   *
   * @returns `true` if the bitmap was resized, which has to force a
   * re-evaluation because every region claimed at the old resolution is stale.
   */
  private syncToViewport() {
    const size = this.renderer.getSize(this._tmpVec2);
    const w = Math.max(1, size.x >> this.downscaleShift);
    const h = Math.max(1, size.y >> this.downscaleShift);
    if (w !== this.bitmap.width || h !== this.bitmap.height) {
      this.bitmap.resize(w, h);
      return true;
    }

    return false;
  }
}

// Helper functions

/**
 * Convert a power-of-two factor into the shift amount that applies it.
 *
 * @param n - Value expected to be a power of two.
 * @param name - Argument name, used in the error message.
 *
 * @returns `log2(n)`.
 *
 * @throws {Error} If `n` is below 1 or not a power of two.
 */
function log2OfPow2(n: number, name: string): number {
  if (n < 1 || (n & (n - 1)) !== 0) {
    throw new Error(`${name} must be a power of 2, got ${n}`);
  }
  let s = 0;
  while (1 << s < n) s++;
  return s;
}

/**
 * Cheap "has the view moved?" metric, compared against
 * `config.viewProjThreshold` to decide whether an evaluation can be skipped.
 *
 * @param a - First matrix.
 * @param b - Second matrix.
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
