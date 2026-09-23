import { Matrix4, Quaternion, Vector3 } from 'three';
import { type Label, RotationAlignment } from '../Label';
import type { LabelManagerConfig } from '../Types/LabelConfig';
import { sdfBuffer } from '../Shaping/SDFAtlas';

export interface ScreenAABB {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Projects a Label's 4 corners into a screen-aligned bounding box, in whatever
 * pixel resolution `setFrame` was given. The collision engine passes the
 * viewport size, so boxes come out in screen pixels.
 *
 * Set the frame once per frame, then use {@link LabelProjector.checkVisible} to
 * reject labels cheaply and {@link LabelProjector.project} on the survivors.
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
   * Fix the frame every later `checkVisible` and `project` resolves against. Both
   * matrices are copied, so the caller may reuse its own.
   *
   * @param view - Camera `matrixWorldInverse`.
   * @param proj - Camera `projectionMatrix`.
   * @param targetW - Width of the pixel space boxes come out in.
   * @param targetH - Height of that space.
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
   * Transforms the label's position only, against the frustum widened by
   * `config.ndcCullMargin`, so it over-accepts: passing means "worth projecting",
   * not "on screen". A NaN position passes too, since every comparison against
   * NaN is false.
   */
  checkVisible(label: Label): boolean {
    const ve = this._view.elements;
    const pe = this._proj.elements;
    const p = label.position;

    const cvx = ve[0] * p.x + ve[4] * p.y + ve[8] * p.z + ve[12];
    const cvy = ve[1] * p.x + ve[5] * p.y + ve[9] * p.z + ve[13];
    const cvz = ve[2] * p.x + ve[6] * p.y + ve[10] * p.z + ve[14];
    if (cvz >= 0) return false;

    // Off-screen cull on the label position, widened by `ndcCullMargin`. The
    // label's own extent is not accounted for, so `project` still has to test
    // the box this admits.
    const ccx = pe[0] * cvx + pe[4] * cvy + pe[8] * cvz + pe[12];
    const ccy = pe[1] * cvx + pe[5] * cvy + pe[9] * cvz + pe[13];
    const ccw = pe[3] * cvx + pe[7] * cvy + pe[11] * cvz + pe[15];
    if (ccw <= 0) return false;

    const limit = 1 + this._config.ndcCullMargin;
    return Math.abs(ccx / ccw) <= limit && Math.abs(ccy / ccw) <= limit;
  }

  /**
   * Project a label's quad to a screen-aligned bounding box, written into `out`
   * in `setFrame`'s pixel space only when this returns `true`, so one scratch
   * object can serve every label.
   *
   * The box covers the label's bounds plus however far the halo reaches past
   * the padding.
   *
   * The box is not clamped to the target: it may fall partly or wholly outside
   * it, and what to do about that is the caller's policy.
   *
   * @returns `true` if the label has bounds and every corner lies in front of
   * the eye, `false` otherwise.
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

    // Layout already anchored the box and applied the label's offset.
    const bx = label.bounds.minX;
    const by = label.bounds.minY;

    // Clip-space w of the label centre, which the perspective divide undoes.
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
      const localX = (bx + ux * bw) * sizeScale;
      const localY = (by + uy * bh) * sizeScale;
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

    // The halo reaches haloWidth + haloBlur past the ink, in the screen pixels
    // the box is already in, and the padding covers part of that.
    if (label.hasHalo()) {
      // Capped at the field's own reach; a wider halo draws no further.
      const raster = this._config.atlasFontSize;
      const reach = (label.fontSize * sdfBuffer(raster)) / raster;
      const halo = Math.min(label.haloWidth + label.haloBlur, reach);
      const pad = label.padding;
      minX -= Math.max(0, halo - pad.left);
      maxX += Math.max(0, halo - pad.right);
      // y grows downward here, so minY is the label's top edge.
      minY -= Math.max(0, halo - pad.top);
      maxY += Math.max(0, halo - pad.bottom);
    }

    out.x0 = Math.floor(minX);
    out.y0 = Math.floor(minY);
    out.x1 = Math.ceil(maxX);
    out.y1 = Math.ceil(maxY);
    return true;
  }
}
