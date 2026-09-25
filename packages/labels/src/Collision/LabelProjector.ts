import { Matrix4, Quaternion, Vector3 } from 'three';
import { type Label, RotationAlignment } from '../Label';
import type { LabelManagerConfig } from '../Types/LabelConfig';
import { sdfBuffer } from '../Shaping/SDFAtlas';

/** Pixel bounds in `setFrame`'s target space, inclusive on both ends, y down. */
export interface ScreenAABB {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Projects labels to screen-aligned boxes, placing each exactly as the label
 * shader does, with sizes in CSS px of the target. Label positions are world
 * coordinates.
 *
 * Call {@link LabelProjector.setFrame} first, then
 * {@link LabelProjector.checkVisible} to reject labels by position and
 * {@link LabelProjector.project} on the rest.
 */
export class LabelProjector {
  private readonly _view = new Matrix4();
  private readonly _proj = new Matrix4();
  private _targetW = 1;
  private _targetH = 1;
  private readonly _config: LabelManagerConfig;
  /** How far the distance field reaches past the ink, in em. */
  private readonly _haloReachEm: number;

  private readonly _q = new Quaternion();
  private readonly _v3 = new Vector3();

  /** @param config - Read live, except `atlasFontSize`, read once. */
  constructor(config: LabelManagerConfig) {
    this._config = config;
    this._haloReachEm = sdfBuffer(config.atlasFontSize) / config.atlasFontSize;
  }

  /**
   * Fix the frame every later `checkVisible` and `project` resolves against. Both
   * matrices are copied, so the caller may reuse its own.
   *
   * @param view - Camera `matrixWorldInverse`.
   * @param proj - Camera `projectionMatrix`.
   * @param targetW - Width of the target, in CSS px.
   * @param targetH - Height of the target, in CSS px.
   */
  setFrame(
    view: Matrix4,
    proj: Matrix4,
    targetW: number,
    targetH: number,
  ): void {
    this._view.copy(view);
    this._proj.copy(proj);
    this._targetW = targetW;
    this._targetH = targetH;
  }

  /**
   * Whether the label's position lies in front of the camera and inside the
   * frustum widened by `config.ndcCullMargin`. The label's extent is not
   * considered, so passing means worth projecting, not on screen. A NaN
   * position fails.
   */
  checkVisible(label: Label): boolean {
    const ve = this._view.elements;
    const pe = this._proj.elements;
    const p = label.position;

    const cvx = ve[0] * p.x + ve[4] * p.y + ve[8] * p.z + ve[12];
    const cvy = ve[1] * p.x + ve[5] * p.y + ve[9] * p.z + ve[13];
    const cvz = ve[2] * p.x + ve[6] * p.y + ve[10] * p.z + ve[14];
    if (cvz >= 0) return false;

    const ccx = pe[0] * cvx + pe[4] * cvy + pe[8] * cvz + pe[12];
    const ccy = pe[1] * cvx + pe[5] * cvy + pe[9] * cvz + pe[13];
    const ccw = pe[3] * cvx + pe[7] * cvy + pe[11] * cvz + pe[15];
    if (ccw <= 0) return false;

    const limit = 1 + this._config.ndcCullMargin;
    return Math.abs(ccx / ccw) <= limit && Math.abs(ccy / ccw) <= limit;
  }

  /**
   * Project a label's bounds, grown by however far its halo reaches past the
   * padding, into `out`. `out` is written only when this returns `true`, and is
   * not clamped to the target.
   *
   * @returns `true` if the label has bounds and every corner lies in front of
   * the eye.
   */
  project(label: Label, out: ScreenAABB): boolean {
    let { minX: bx, minY: by, width: bw, height: bh } = label.bounds;
    if (bw === 0 || bh === 0) return false;

    if (label.hasHalo()) {
      const halo = Math.min(label.haloWidth + label.haloBlur, label.fontSize * this._haloReachEm);
      const pad = label.padding;
      const left = Math.max(0, halo - pad.left);
      const right = Math.max(0, halo - pad.right);
      const bottom = Math.max(0, halo - pad.bottom);
      const top = Math.max(0, halo - pad.top);
      bx -= left;
      bw += left + right;
      by -= bottom;
      bh += bottom + top;
    }

    const ve = this._view.elements;
    const pe = this._proj.elements;
    const p = label.position;
    const cvx = ve[0] * p.x + ve[4] * p.y + ve[8] * p.z + ve[12];
    const cvy = ve[1] * p.x + ve[5] * p.y + ve[9] * p.z + ve[13];
    const cvz = ve[2] * p.x + ve[6] * p.y + ve[10] * p.z + ve[14];

    // World units per CSS px at the label's depth.
    const w = Math.abs(pe[3] * cvx + pe[7] * cvy + pe[11] * cvz + pe[15]);
    const worldPerPx = (2 * w) / (pe[5] * this._targetH);

    const isViewport = label.rotationAlignment === RotationAlignment.Viewport;
    if (!isViewport) this._q.copy(label.rotation);

    const W = this._targetW,
      H = this._targetH;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    // The 4 corners as a 2-bit code; only their min/max matters, not the order.
    for (let i = 0; i < 4; i++) {
      const localX = (bx + (i & 1) * bw) * worldPerPx;
      const localY = (by + ((i >> 1) & 1) * bh) * worldPerPx;
      let vx: number, vy: number, vz: number;
      if (isViewport) {
        vx = cvx + localX;
        vy = cvy + localY;
        vz = cvz;
      } else {
        this._v3.set(localX, localY, 0).applyQuaternion(this._q);
        const wx = p.x + this._v3.x;
        const wy = p.y + this._v3.y;
        const wz = p.z + this._v3.z;
        vx = ve[0] * wx + ve[4] * wy + ve[8] * wz + ve[12];
        vy = ve[1] * wx + ve[5] * wy + ve[9] * wz + ve[13];
        vz = ve[2] * wx + ve[6] * wy + ve[10] * wz + ve[14];
      }
      const cx = pe[0] * vx + pe[4] * vy + pe[8] * vz + pe[12];
      const cy = pe[1] * vx + pe[5] * vy + pe[9] * vz + pe[13];
      const cw = pe[3] * vx + pe[7] * vy + pe[11] * vz + pe[15];
      if (cw <= 0) return false;
      const px = (cx / cw * 0.5 + 0.5) * W;
      const py = (cy / cw * -0.5 + 0.5) * H;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    out.x0 = Math.floor(minX);
    out.y0 = Math.floor(minY);
    out.x1 = Math.ceil(maxX);
    out.y1 = Math.ceil(maxY);
    return true;
  }
}
