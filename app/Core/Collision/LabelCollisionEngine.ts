import { Camera, Vector2, Vector3, WebGLRenderer } from "three";
import { Label } from "../Label";
import { HierarchicalBitmap } from "./HierarchicalBitmap";
import { LabelProjector, ScreenAABB } from "./LabelProjector";
import { DistanceSort } from "./DistanceSort";

const MIN_OCCLUSION = 0;
const MAX_OCCLUSION = 0.2;
const CAMERA_RESORT_THRESHOLD_SQ = 1.0;

function log2OfPow2(n: number, name: string): number {
  if (n < 1 || (n & (n - 1)) !== 0) {
    throw new Error(`${name} must be a power of 2, got ${n}`);
  }
  let s = 0;
  while (1 << s < n) s++;
  return s;
}

export class LabelCollisionEngine {
  private labels: Label[] = [];
  private dirty = true;

  private readonly renderer: WebGLRenderer;
  private readonly downscaleShift: number;
  private readonly bitmap: HierarchicalBitmap;
  private readonly projector: LabelProjector;
  private readonly sorter = new DistanceSort();

  private readonly _lastCamPos = new Vector3(Infinity, Infinity, Infinity);
  private readonly _tmpVec2 = new Vector2();
  private readonly _scratchAABB: ScreenAABB = { x0: 0, y0: 0, x1: 0, y1: 0 };

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
    this.dirty = true;
  }
  addLabels(labels: Label[]) {
    this.labels.push(...labels);
    this.dirty = true;
  }
  clear() {
    this.labels = [];
    this.dirty = true;
  }
  removeLabels(ids: string[]) {
    if (ids.length === 0) return;
    const s = new Set(ids);
    this.labels = this.labels.filter(l => !s.has(l.id));
    this.dirty = true;
  }

  evaluate(camera: Camera) {
    if (this.labels.length === 0) return;

    this.syncToViewport();

    const moved = camera.position.distanceToSquared(this._lastCamPos);
    if (this.dirty || moved > CAMERA_RESORT_THRESHOLD_SQ) {
      this.sorter.sort(this.labels, camera.position);
      this._lastCamPos.copy(camera.position);
      this.dirty = false;
    }

    this.projector.setFrame(
      camera.matrixWorldInverse,
      camera.projectionMatrix,
      this.bitmap.width,
      this.bitmap.height,
    );
    this.bitmap.clear();

    const aabb = this._scratchAABB;
    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i];

      if (!this.projector.project(label, aabb)) {
        label.shouldRender = false;
        continue;
      }
      const { x0, y0, x1, y1 } = aabb;

      // Fast-pass: coarse-empty → guaranteed clear.
      if (this.bitmap.isCoarseEmpty(x0, y0, x1, y1)) {
        this.bitmap.setRegion(x0, y0, x1, y1);
        label.shouldRender = true;
        label.occludedOpacity = 1;
        continue;
      }

      // Slow path: precise count.
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const claimed = this.bitmap.countFine(x0, y0, x1, y1);
      const occlusion = claimed / area;
      if (occlusion <= MAX_OCCLUSION) {
        this.bitmap.setRegion(x0, y0, x1, y1);
        label.shouldRender = true;
        label.occludedOpacity = occlusion <= MIN_OCCLUSION
          ? 1
          : 1 - (occlusion - MIN_OCCLUSION) / (MAX_OCCLUSION - MIN_OCCLUSION);
      } else {
        label.shouldRender = false;
        label.occludedOpacity = 0;
      }
    }
  }

  dispose() {}

  // ─── Internals ────────────────────────────────────────────────────────────

  private syncToViewport() {
    const size = this.renderer.getSize(this._tmpVec2);
    const w = Math.max(1, size.x >> this.downscaleShift);
    const h = Math.max(1, size.y >> this.downscaleShift);
    if (w !== this.bitmap.width || h !== this.bitmap.height) {
      this.bitmap.resize(w, h);
    }
  }
}
