import {
  Camera,
  Matrix4,
  Quaternion,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { Label, RotationAlignment, TextAnchorX, TextAnchorY } from "./Label";

/** Fraction of a label's bbox that must be clear in the bitmap to place it. */
const PLACEMENT_THRESHOLD = 0.75;

/** Squared distance the camera must move before re-sorting. */
const CAMERA_RESORT_THRESHOLD_SQ = 0.01;

export class LabelCollisionEngine {
  private labels: Label[] = [];
  private dirty = true;
  private _lastCamPos = new Vector3(Infinity, Infinity, Infinity);

  private readonly renderer: WebGLRenderer;
  private readonly pxPerUnit: number;

  /** Bitmap dimensions in cells. Each cell is one bit. */
  private rtW: number;
  private rtH: number;

  /** Packed bitmap: 32 bits per Uint32, row-major. */
  private bitmap = new Uint32Array(1);
  private wordsPerRow = 0;

  // Per-frame cached matrices + scratch
  private readonly _view = new Matrix4();
  private readonly _proj = new Matrix4();
  private readonly _tmpVec2 = new Vector2();
  private readonly _tmpQuat = new Quaternion();
  private readonly _tmpVec3 = new Vector3();

  constructor(renderer: WebGLRenderer, pxPerUnit = 1024, resolution = 256) {
    this.renderer  = renderer;
    this.pxPerUnit = pxPerUnit;

    const size = renderer.getSize(this._tmpVec2);
    const aspect = size.x / size.y;
    if (aspect >= 1) {
      this.rtW = resolution;
      this.rtH = Math.round(resolution / aspect);
    } else {
      this.rtH = resolution;
      this.rtW = Math.round(resolution * aspect);
    }
    this._allocBitmap();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  setLabels(labels: Label[])  { 
    if (labels === this.labels) return;
    this.labels = labels;        
    this.dirty = true; 
  }
  addLabels(labels: Label[])  { this.labels.push(...labels); this.dirty = true; }
  clear()                     { this.labels = [];            this.dirty = true; }

  removeLabels(ids: string[]) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    this.labels = this.labels.filter(l => !idSet.has(l.id));
    this.dirty = true;
  }

  evaluate(camera: Camera) {
    if (this.labels.length === 0) return;

    // Sync bitmap to viewport aspect (preserves the chosen max dim)
    const size = this.renderer.getSize(this._tmpVec2);
    const aspect = size.x / size.y;
    const maxDim = Math.max(this.rtW, this.rtH);
    const wantW = aspect >= 1 ? maxDim : Math.round(maxDim * aspect);
    const wantH = aspect >= 1 ? Math.round(maxDim / aspect) : maxDim;
    if (wantW !== this.rtW || wantH !== this.rtH) {
      this.rtW = wantW;
      this.rtH = wantH;
      this._allocBitmap();
    }

    // Sort front-to-back when labels or camera changed
    const moved = camera.position.distanceToSquared(this._lastCamPos);
    if (this.dirty || moved > CAMERA_RESORT_THRESHOLD_SQ) {
      this.labels.sort((a, b) => {
        // Prioritize labels that have already rendered
        if (a.hasRendered !== b.hasRendered) {
          return (b.hasRendered ? 1 : 0) - (a.hasRendered ? 1 : 0);
        }
        // Then sort by distance (front-to-back)
        return camera.position.distanceToSquared(a.position) -
               camera.position.distanceToSquared(b.position);
      });
      this._lastCamPos.copy(camera.position);
      this.dirty = false;
    }

    // Cache matrices for projection
    this._view.copy(camera.matrixWorldInverse);
    this._proj.copy(camera.projectionMatrix);

    // Reset bitmap
    this.bitmap.fill(0);

    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i];

      const aabb = this._projectLabelAABB(label);
      if (aabb === null) {
        label.shouldRender = false;
        continue;
      }

      const { x0, y0, x1, y1 } = aabb;
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const claimed = this._countSetBits(x0, y0, x1, y1);
      const free = area - claimed;

      const passes = free / area >= PLACEMENT_THRESHOLD;

      if (passes) {
        this._setBits(x0, y0, x1, y1);
        label.shouldRender = true;
      } else {
        label.shouldRender = false;
      }
    }
  }

  dispose() {
    // Nothing GPU-allocated.
  }

  // ─── Projection: 4 quad corners → screen-space AABB ────────────────────────

  private _projectLabelAABB(label: Label): { x0: number, y0: number, x1: number, y1: number } | null {
    const bw = label.bounds?.width  ?? 0;
    const bh = label.bounds?.height ?? 0;
    if (bw === 0 || bh === 0) return null;

    const offsetX = (label.offset.x * label.fontSize) / this.pxPerUnit;
    const offsetY = (label.offset.y * label.fontSize) / this.pxPerUnit;
    const ax = this._anchorOffsetX(label, bw) + offsetX;
    const ay = this._anchorOffsetY(label, bh) - offsetY;

    // Label center in view space (used for distance scaling and viewport path)
    const ve = this._view.elements;
    const p = label.position;
    const cvx = ve[0]*p.x + ve[4]*p.y + ve[8]*p.z  + ve[12];
    const cvy = ve[1]*p.x + ve[5]*p.y + ve[9]*p.z  + ve[13];
    const cvz = ve[2]*p.x + ve[6]*p.y + ve[10]*p.z + ve[14];
    if (cvz >= 0) return null; // behind camera

    const viewDepth = Math.sqrt(cvx*cvx + cvy*cvy + cvz*cvz);

    const isViewport = label.rotationAlignment === RotationAlignment.Viewport;
    const q = isViewport ? null : this._tmpQuat.set(
      label.rotation.x, label.rotation.y, label.rotation.z, label.rotation.w,
    );

    const pe = this._proj.elements;
    let minX =  Infinity, minY =  Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    // 4 corners: (0,0), (1,0), (1,1), (0,1)
    for (let i = 0; i < 4; i++) {
      const ux = (i === 1 || i === 2) ? 1 : 0;
      const uy = (i === 2 || i === 3) ? 1 : 0;
      const localX = (ux * bw + ax) * viewDepth;
      const localY = (uy * bh + ay) * viewDepth;

      let vx: number, vy: number, vz: number;
      if (isViewport) {
        // Corner offset in view-space plane at label's view-space position
        vx = cvx + localX;
        vy = cvy + localY;
        vz = cvz;
      } else {
        // Map-aligned: rotate local offset by quaternion in world space,
        // then transform world corner through view matrix.
        this._tmpVec3.set(localX, localY, 0).applyQuaternion(q!);
        const wx = p.x + this._tmpVec3.x;
        const wy = p.y + this._tmpVec3.y;
        const wz = p.z + this._tmpVec3.z;
        vx = ve[0]*wx + ve[4]*wy + ve[8]*wz  + ve[12];
        vy = ve[1]*wx + ve[5]*wy + ve[9]*wz  + ve[13];
        vz = ve[2]*wx + ve[6]*wy + ve[10]*wz + ve[14];
      }

      // View → clip
      const cx = pe[0]*vx + pe[4]*vy + pe[8]*vz  + pe[12];
      const cy = pe[1]*vx + pe[5]*vy + pe[9]*vz  + pe[13];
      const cw = pe[3]*vx + pe[7]*vy + pe[11]*vz + pe[15];
      if (cw <= 0) return null;

      const ndcX = cx / cw;
      const ndcY = cy / cw;

      const px = (ndcX *  0.5 + 0.5) * this.rtW;
      const py = (ndcY * -0.5 + 0.5) * this.rtH;

      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    const x0 = Math.max(0,            Math.floor(minX));
    const x1 = Math.min(this.rtW - 1, Math.ceil (maxX));
    const y0 = Math.max(0,            Math.floor(minY));
    const y1 = Math.min(this.rtH - 1, Math.ceil (maxY));

    if (x0 > x1 || y0 > y1) return null;
    return { x0, y0, x1, y1 };
  }

  // ─── Bitmap ops ────────────────────────────────────────────────────────────

  private _allocBitmap() {
    this.wordsPerRow = Math.ceil(this.rtW / 32);
    this.bitmap = new Uint32Array(this.wordsPerRow * this.rtH);
  }

  private _countSetBits(x0: number, y0: number, x1: number, y1: number): number {
    let count = 0;
    const wA = x0 >> 5;
    const wB = x1 >> 5;
    const maskA = (0xffffffff << (x0 & 31)) >>> 0;
    const maskB = (0xffffffff >>> (31 - (x1 & 31)));

    for (let y = y0; y <= y1; y++) {
      const row = y * this.wordsPerRow;
      if (wA === wB) {
        count += popcount32(this.bitmap[row + wA] & maskA & maskB);
      } else {
        count += popcount32(this.bitmap[row + wA] & maskA);
        for (let w = wA + 1; w < wB; w++) {
          count += popcount32(this.bitmap[row + w]);
        }
        count += popcount32(this.bitmap[row + wB] & maskB);
      }
    }
    return count;
  }

  private _setBits(x0: number, y0: number, x1: number, y1: number): void {
    const wA = x0 >> 5;
    const wB = x1 >> 5;
    const maskA = (0xffffffff << (x0 & 31)) >>> 0;
    const maskB = (0xffffffff >>> (31 - (x1 & 31)));

    for (let y = y0; y <= y1; y++) {
      const row = y * this.wordsPerRow;
      if (wA === wB) {
        this.bitmap[row + wA] |= maskA & maskB;
      } else {
        this.bitmap[row + wA] |= maskA;
        for (let w = wA + 1; w < wB; w++) {
          this.bitmap[row + w] = 0xffffffff;
        }
        this.bitmap[row + wB] |= maskB;
      }
    }
  }

  // ─── Anchor helpers ────────────────────────────────────────────────────────

  private _anchorOffsetX(label: Label, bw: number): number {
    switch (label.anchorX) {
      case TextAnchorX.Left:  return 0;
      case TextAnchorX.Right: return -bw;
      default:                return -bw * 0.5;
    }
  }

  private _anchorOffsetY(label: Label, bh: number): number {
    switch (label.anchorY) {
      case TextAnchorY.Top:    return -bh;
      case TextAnchorY.Bottom: return 0;
      default:                 return -bh * 0.5;
    }
  }
}

/** Hamming weight of a 32-bit unsigned int. */
function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}