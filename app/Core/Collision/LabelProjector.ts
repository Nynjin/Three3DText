import { Matrix4, Quaternion, Vector3 } from 'three';
import { type Label, RotationAlignment, TextAnchorX, TextAnchorY } from '../Label';
import type { LabelManagerConfig } from '../Types/LabelConfig';

export interface ScreenAABB {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * @description Projects a Label's 4 corners through view/projection matrices
 * into a screen-aligned bounding box, in whatever pixel resolution `setFrame`
 * was given. The collision engine passes the viewport size, so boxes come out
 * in screen pixels for the occupancy grid to downscale to cells.
 *
 * Stateless apart from preconfigured matrices and target dimensions.
 * Set those once per frame via {@link LabelProjector.setFrame}, then call
 * {@link LabelProjector.checkVisible} to reject labels cheaply and
 * {@link LabelProjector.project} on the ones that survive.
 */
export class LabelProjector {
  private readonly _view = new Matrix4();
  private readonly _proj = new Matrix4();
  private _targetW = 1;
  private _targetH = 1;
  private readonly _config: LabelManagerConfig;

  private readonly _q = new Quaternion();
  private readonly _v3 = new Vector3();

  constructor(config: LabelManagerConfig) {
    this._config = config;
  }

  /**
   * Fix the frame every later `checkVisible` and `project` call resolves
   * against. Both matrices are copied, so the caller may reuse its own.
   *
   * @param view - Camera `matrixWorldInverse`.
   * @param proj - Camera `projectionMatrix`.
   * @param targetW - Width of the coordinate space boxes come out in, pixels.
   * @param targetH - Height of that space, pixels.
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
   * Cheap rejection test to run before the much costlier
   * {@link LabelProjector.project}.
   *
   * Transforms the label's *centre* only, against the frustum widened by the
   * label's extent and `config.ndcCullMargin`, so it over-accepts: passing
   * means "worth projecting", not "on screen". A NaN position passes too,
   * since every comparison against NaN is false.
   *
   * @param label - Label to test.
   *
   * @returns `false` only when the label is certainly not worth projecting.
   */
  checkVisible(label: Label): boolean {
    const bw = label.bounds.width;
    const bh = label.bounds.height;
    if (bw === 0 || bh === 0) return false;

    const ve = this._view.elements;
    const pe = this._proj.elements;
    const p = label.position;

    const cvx = ve[0] * p.x + ve[4] * p.y + ve[8] * p.z + ve[12];
    const cvy = ve[1] * p.x + ve[5] * p.y + ve[9] * p.z + ve[13];
    const cvz = ve[2] * p.x + ve[6] * p.y + ve[10] * p.z + ve[14];
    if (cvz >= 0) return false;

    // Off-screen center cull with generous text margins
    const ccx = pe[0] * cvx + pe[4] * cvy + pe[8] * cvz + pe[12];
    const ccy = pe[1] * cvx + pe[5] * cvy + pe[9] * cvz + pe[13];
    const ccw = pe[3] * cvx + pe[7] * cvy + pe[11] * cvz + pe[15];
    if (ccw <= 0) return false;

    const ndcCx = ccx / ccw,
      ndcCy = ccy / ccw;
    const maxBound = Math.max(bw, bh);
    const marginNDC = (maxBound * pe[0]) / ccw + this._config.ndcCullMargin; // usually gives ~20% breathing room

    if (Math.abs(ndcCx) > 1 + marginNDC || Math.abs(ndcCy) > 1 + marginNDC)
      return false;

    return true;
  }

  /**
   * Project a label's quad to a screen-aligned bounding box.
   *
   * @param label - Label to project.
   * @param out - Filled with the box, in `setFrame`'s pixel space and clamped
   * to it, only when this returns `true`. Left untouched otherwise, so it is
   * safe to pass one scratch object for every label.
   *
   * @returns `true` if the label projects to a non-empty on-screen box, `false`
   * if any corner falls behind the eye or the box misses the target entirely.
   */
  project(label: Label, out: ScreenAABB): boolean {
    const bw = label.bounds.width;
    const bh = label.bounds.height;
    if (bw === 0 || bh === 0) return false;

    const ve = this._view.elements;
    const pe = this._proj.elements;
    const p = label.position;
    const cvx = ve[0] * p.x + ve[4] * p.y + ve[8] * p.z + ve[12];
    const cvy = ve[1] * p.x + ve[5] * p.y + ve[9] * p.z + ve[13];
    const cvz = ve[2] * p.x + ve[6] * p.y + ve[10] * p.z + ve[14];

    const offsetX = (label.offset.x * label.fontSize) / this._config.pxPerUnit;
    const offsetY = (label.offset.y * label.fontSize) / this._config.pxPerUnit;
    const ax = anchorOffsetX(label, bw) + offsetX;
    const ay = anchorOffsetY(label, bh) - offsetY;

    // Must match `getScreenSizeScale` in the glyph vertex shader: the clip-space
    // w of the label centre, which is what the perspective divide will undo.
    // Euclidean distance would overshoot off-axis by 1 / cos(angle from the view
    // axis), so the box would grow as the label pans away from the centre while
    // the drawn glyphs did not.
    const sizeScale = Math.abs(
      pe[3] * cvx + pe[7] * cvy + pe[11] * cvz + pe[15],
    );
    const isViewport = label.rotationAlignment === RotationAlignment.Viewport;
    if (!isViewport) {
      this._q.set(
        label.rotation.x,
        label.rotation.y,
        label.rotation.z,
        label.rotation.w,
      );
    }

    const W = this._targetW,
      H = this._targetH;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    // The 4 corners as a 2-bit code; only their min/max matters, not the order.
    for (let i = 0; i < 4; i++) {
      const ux = i & 1;
      const uy = (i >> 1) & 1;
      const localX = (ux * bw + ax) * sizeScale;
      const localY = (uy * bh + ay) * sizeScale;
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
      const ndcX = cx / cw,
        ndcY = cy / cw;
      const px = (ndcX * 0.5 + 0.5) * W;
      const py = (ndcY * -0.5 + 0.5) * H;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    const x0 = Math.max(0, Math.floor(minX));
    const x1 = Math.min(W - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(H - 1, Math.ceil(maxY));
    if (x0 > x1 || y0 > y1) return false;
    out.x0 = x0;
    out.y0 = y0;
    out.x1 = x1;
    out.y1 = y1;
    return true;
  }
}

// ─── Anchor helpers ─────────────────────────────────────────────────────────

function anchorOffsetX(label: Label, bw: number): number {
  switch (label.anchorX) {
    case TextAnchorX.Left:
      return 0;
    case TextAnchorX.Right:
      return -bw;
    default:
      return -bw * 0.5;
  }
}

function anchorOffsetY(label: Label, bh: number): number {
  switch (label.anchorY) {
    case TextAnchorY.Top:
      return -bh;
    case TextAnchorY.Bottom:
      return 0;
    default:
      return -bh * 0.5;
  }
}
