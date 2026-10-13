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
 * A pass projects each candidate to a screen box and claims it in a
 * {@link BitmapOccupancy}, nearest first. Boxes in CSS px of the renderer's canvas.
 *
 * A label not placed by the last pass has its squared distance multiplied by
 * `config.renderPenaltyMultiplier`.
 *
 * {@link LabelCollisionEngine.beginPass} and {@link LabelCollisionEngine.stepPass}
 * spread a pass across frames; {@link LabelCollisionEngine.evaluate} runs one to
 * completion. Label edits are not observed: call
 * {@link LabelCollisionEngine.invalidate} after them.
 */
export class LabelCollisionEngine {
  /** Tracked labels, by id. */
  private readonly _byId = new Map<string, Label>();

  /**
   * Scan order of a pass. May hold removed labels until the next
   * {@link beginPass} compacts it. `_listed` mirrors it.
   */
  private _labels: Label[] = [];
  private _listed = new Set<Label>();
  private _needsCompact = false;

  /** Labels that passed the open pass's gates. */
  private _candidates: Label[] = [];

  /**
   * Sort keys parallel to `_candidates`. Sized to `_labels.length`; only the
   * first `_candidates.length` entries are valid.
   */
  private _sortKeys = new Float32Array(0);

  /** Forces the next {@link beginPass} to open a pass. */
  private _dirty = true;

  private readonly _renderer: WebGLRenderer;
  private readonly _bitmap: BitmapOccupancy;
  private readonly _projector: LabelProjector;
  private readonly _sorter: RadixSorter;

  /** Canvas size, CSS px. Set by `_syncToViewport`. */
  private _screenW = 1;
  private _screenH = 1;

  /** View-projection matrix of the last pass opened. */
  private readonly _lastVP = new Matrix4();
  private readonly _frustumMatrix = new Matrix4();

  /** Labels the last pass placed, and their anchors' screen position then, in CSS px. */
  private readonly _shown: Label[] = [];
  private readonly _shownXY: number[] = [];
  private readonly _scratchXY = [0, 0];
  private readonly _scratchAABB: ScreenAABB = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly _scratchIconAABB: ScreenAABB = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly _tmpVec2 = new Vector2();

  /** In-flight pass, suspended between chunks. */
  private _pass: Generator<void, void, void> | null = null;

  private readonly _config: LabelManagerConfig;
  private readonly _onPlacementChange: (label: Label) => void;

  /**
   * @param renderer - Its canvas size (`getSize`, CSS px) is the bitmap's pixel
   * space, re-read every pass. Borrowed, not disposed.
   * @param config - Read live, except `downscale` and `atlasFontSize`, read once.
   * @param onPlacementChange - Called after the engine changes a label's `shouldRender`.
   *
   * @throws {Error} If `config.downscale` is not a power of two.
   */
  constructor(
    renderer: WebGLRenderer,
    config: LabelManagerConfig,
    onPlacementChange: (label: Label) => void = () => {},
  ) {
    this._renderer = renderer;
    this._config = config;
    this._onPlacementChange = onPlacementChange;
    this._bitmap = new BitmapOccupancy(config.downscale);
    this._projector = new LabelProjector(config);
    this._sorter = new RadixSorter();
    this._syncToViewport();
  }

  /**
   * Track labels; already tracked ones are skipped. An open pass ignores them.
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
   * Untrack labels by id; unknown ids are ignored. An open pass skips them from
   * here on. Their `shouldRender` is left as is.
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
   * Skipped with no labels, or when the engine is clean, the cell grid unchanged
   * and the view has not moved (see `config.moveThresholdPx`).
   *
   * @param camera - `projectionMatrix`, `matrixWorld` and `matrixWorldInverse`
   * must be current.
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
    if (!this._dirty && !viewportChanged && !this._viewMoved(this._frustumMatrix)) return false;

    this._projector.setFrame(
      camera.matrixWorldInverse,
      camera.projectionMatrix,
      this._screenW,
      this._screenH,
    );

    this._lastVP.copy(this._frustumMatrix);
    this._shown.length = 0;
    this._shownXY.length = 0;
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
   * One pass over the first `n` labels, yielding between chunks. `eye` is fixed
   * for the pass.
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
   * Advance the open pass until `budgetMs` elapses or the pass ends. Runs at
   * least one step; the clock is read between steps, so a call can overrun.
   * The sort is one step. Labels not yet reached keep their `shouldRender`.
   *
   * @param budgetMs - In ms. `Infinity` finishes the pass.
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

  /** Forget every label and the open pass. */
  dispose() {
    this._byId.clear();
    this._labels = [];
    this._listed.clear();
    this._candidates.length = 0;
    this._shown.length = 0;
    this._shownXY.length = 0;
    this._pass = null;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private _isTracked(label: Label): boolean {
    return this._byId.get(label.id) === label;
  }

  /** Drop removed labels from the scan order. */
  private _compact() {
    this._labels = this._labels.filter(label => this._isTracked(label));
    this._listed = new Set(this._labels);
    this._needsCompact = false;
    this._pass = null;
  }

  /**
   * Project and claim candidates in priority order.
   *
   * @param order - Permutation of `_candidates`, nearest first.
   */
  private _placeChunk(order: Int32Array, from: number, to: number) {
    const text = this._scratchAABB;
    const icon = this._scratchIconAABB;

    for (let i = from; i < to; i++) {
      const label = this._candidates[order[i]];
      if (!this._isTracked(label)) continue;

      const hasText = label.glyphs.length > 0;
      const ib = label.iconBounds;
      const hasIcon = ib.width > 0;

      // A part fails if its box crosses the viewport edge or the label was hidden since collection.
      let placeText = hasText && label.visible && this._projector.project(label, text) && this._onScreen(text)
        && this._bitmap.test(text.x0, text.y0, text.x1, text.y1, label.allowOverlap);
      let placeIcon = hasIcon && label.visible
        && this._projector.projectRect(label, ib.minX, ib.minY, ib.width, ib.height, icon) && this._onScreen(icon)
        && this._bitmap.test(icon.x0, icon.y0, icon.x1, icon.y1, label.iconAllowOverlap);

      // MapLibre's pairing: a part not marked optional needs the other.
      const iconWithoutText = label.textOptional || !hasText;
      const textWithoutIcon = label.iconOptional || !hasIcon;
      if (!iconWithoutText && !textWithoutIcon) {
        placeText = placeIcon = placeText && placeIcon;
      } else if (!textWithoutIcon) {
        placeText = placeText && placeIcon;
      } else if (!iconWithoutText) {
        placeIcon = placeIcon && placeText;
      }

      // Both parts are tested before either claims, so they never collide with each other.
      if (placeText) this._bitmap.claim(text.x0, text.y0, text.x1, text.y1);
      if (placeIcon) this._bitmap.claim(icon.x0, icon.y0, icon.x1, icon.y1);

      this._setPlaced(label, placeText, placeIcon);
      if (label.shouldRender && this._screenOf(this._lastVP, label.position, this._scratchXY)) {
        this._shown.push(label);
        this._shownXY.push(this._scratchXY[0], this._scratchXY[1]);
      }
    }
  }

  /**
   * Append the labels in `[from, to)` that pass the gates to `_candidates`, with
   * sort keys. A label failing a gate stops rendering.
   *
   * @returns `count` plus the number appended.
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

      // Penalty applies to the key only, not the range test. Log key: the sorter buckets linearly.
      const distSq = dx * dx + dy * dy + dz * dz;
      const key = Math.log((label.shouldRender ? distSq : distSq * penalty) || Number.MIN_VALUE);

      const isValid
        = distSq >= nearSq
          && distSq <= farSq
          && label.visible
          && (label.glyphs.length > 0 || label.iconBounds.width > 0)
          // The sorter throws on an infinite key.
          && Number.isFinite(key)
          && this._projector.checkVisible(label);

      if (!isValid) {
        this._setPlaced(label, false);
        continue;
      }

      keys[count] = key;
      candidates[count] = label;
      count++;
    }

    return count;
  }

  /** Writes the placed parts; `shouldRender` is either. Notifies on any change. */
  private _setPlaced(label: Label, text: boolean, icon = text) {
    const any = text || icon;
    if (label.placedText === text && label.placedIcon === icon && label.shouldRender === any) return;
    label.placedText = text;
    label.placedIcon = icon;
    label.shouldRender = any;
    this._onPlacementChange(label);
  }

  /** Whether a projected box lies wholly on the canvas. */
  private _onScreen(box: ScreenAABB): boolean {
    return box.x0 >= 0 && box.y0 >= 0 && box.x1 <= this._screenW - 1 && box.y1 <= this._screenH - 1;
  }

  /**
   * Whether a label the last pass placed moved more than `config.moveThresholdPx`
   * on screen under `vp`. With none placed, whether `vp` changed.
   */
  private _viewMoved(vp: Matrix4): boolean {
    const n = this._shown.length;
    if (n === 0) return !vp.equals(this._lastVP);

    const limitSq = this._config.moveThresholdPx ** 2;
    const xy = this._scratchXY;
    for (let i = 0; i < n; i++) {
      if (!this._screenOf(vp, this._shown[i].position, xy)) return true;
      const dx = xy[0] - this._shownXY[2 * i];
      const dy = xy[1] - this._shownXY[2 * i + 1];
      if (dx * dx + dy * dy > limitSq) return true;
    }
    return false;
  }

  /**
   * Screen position of a world point under `vp`, CSS px, y down, into `out`.
   *
   * @returns `false`, `out` untouched, if the point is not in front of the camera.
   */
  private _screenOf(vp: Matrix4, p: Vector3, out: number[]): boolean {
    const e = vp.elements;
    const w = e[3] * p.x + e[7] * p.y + e[11] * p.z + e[15];
    if (!(w > 0)) return false;
    out[0] = ((e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12]) / w + 1) * 0.5 * this._screenW;
    out[1] = (1 - (e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13]) / w) * 0.5 * this._screenH;
    return true;
  }

  /**
   * Re-read the canvas size and match the bitmap to it.
   *
   * @returns `true` if the cell grid changed, which clears it.
   */
  private _syncToViewport(): boolean {
    const size = this._renderer.getSize(this._tmpVec2);
    this._screenW = Math.max(1, size.x);
    this._screenH = Math.max(1, size.y);
    return this._bitmap.resize(this._screenW, this._screenH);
  }
}
