import { Camera, Matrix4, Vector2, WebGLRenderer } from "three";
import { Label } from "../Label";
import { HierarchicalBitmap } from "./HierarchicalBitmap";
import { LabelProjector, ScreenAABB } from "./LabelProjector";
import { DistanceSort } from "./DistanceSort";

const ACCEPTABLE_OCCLUSION = 0.1;
const MAX_OCCLUSION = 0.2;

const VIEW_PROJ_THRESHOLD = 0.05; 

export class LabelCollisionEngine {
  private labels: Label[] = [];
  private candidates: Label[] = [];
  private dirty = true;

  private readonly renderer: WebGLRenderer;
  private readonly downscaleShift: number;
  private readonly bitmap: HierarchicalBitmap;
  private readonly projector: LabelProjector;
  private readonly sorter = new DistanceSort();

  private readonly _lastVP = new Matrix4();
  private readonly _lastVPSort = new Matrix4();
  
  private readonly _scratchAABB: ScreenAABB = { x0: 0, y0: 0, x1: 0, y1: 0 };

  private readonly _frustumMatrix = new Matrix4();

  private readonly _tmpVec2 = new Vector2();
  
  constructor(
    renderer: WebGLRenderer,
    pxPerUnit = 1024,
    downscale = 4,
    coarseScale = 32,
  ) {
    this.renderer = renderer;
    this.downscaleShift = log2OfPow2(downscale, "downscale");
    this.bitmap = new HierarchicalBitmap(coarseScale);
    this.projector = new LabelProjector(pxPerUnit);
    this.syncToViewport();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  setLabels(labels: Label[]) {
    if (labels === this.labels) return;
    this.labels = labels;
    this.candidates = [];
    this.dirty = true;
  }
  addLabels(labels: Label[]) {
    for (const label of labels) {
      if (!this.labels.includes(label)) {
        this.labels.push(label);
        this.dirty = true;
      }
    }
  }
  clear() {
    this.labels = [];
    this.candidates = [];
    this.dirty = true;
  }
  removeLabels(ids: string[]) {
    if (ids.length === 0) return;
    const s = new Set(ids);
    this.labels = this.labels.filter(l => !s.has(l.id));
    this.candidates = this.candidates.filter(l => !s.has(l.id));
    this.dirty = true;
  }

  evaluate(camera: Camera) {
    if (this.labels.length === 0) return;
    const viewportChanged = this.syncToViewport();

    this._frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const viewDiff = matrixMaxDiff(this._frustumMatrix, this._lastVP);

    if (!this.dirty && viewDiff <= VIEW_PROJ_THRESHOLD && !viewportChanged) {
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

    // Trim dead items off the end without reallocating
    this.candidates = [];

    // 2. Scan for NEW items to append
    for (let i = 0; i < this.labels.length; i++) {
        const label = this.labels[i];

        const isValid = label.visible && label.opacity > 0 && 
                        label.glyphs.length > 0 && label.bounds.width > 0 && 
                        this.projector.checkVisible(label);

        if (isValid) {
            label.isCandidate = true;
            this.candidates.push(label);
        }
    }

    // 3. Only sort when array changed or camera moved!
    this.sorter.sort(this.candidates, camera.position);
    this._lastVPSort.copy(this._frustumMatrix);
    this.dirty = false;
    

    const aabb = this._scratchAABB;
    for (let i = 0; i < this.candidates.length; i++) {
      const label = this.candidates[i];

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
        isVisible = occlusion <= MAX_OCCLUSION;
      } else {
        isVisible = occlusion <= ACCEPTABLE_OCCLUSION;
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

  dispose() {}

  // ─── Internals ────────────────────────────────────────────────────────────

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

function log2OfPow2(n: number, name: string): number {
  if (n < 1 || (n & (n - 1)) !== 0) {
    throw new Error(`${name} must be a power of 2, got ${n}`);
  }
  let s = 0;
  while (1 << s < n) s++;
  return s;
}

function matrixMaxDiff(a: Matrix4, b: Matrix4): number {
  let max = 0;
  for (let i = 0; i < 16; i++) {
    max = Math.max(max, Math.abs(a.elements[i] - b.elements[i]));
  }
  return max;
}