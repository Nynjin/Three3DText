import { Matrix4, Quaternion, Vector3 } from "three";
import { Label, RotationAlignment, TextAnchorX, TextAnchorY } from "../Label";
import { LabelManagerConfig } from "../Types/LabelConfig";

export interface ScreenAABB {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Projects a Label's 4 corners through view/projection matrices into
 * a screen-aligned bounding box, in target-resolution cell coordinates.
 *
 * Stateless apart from preconfigured matrices and target dimensions.
 * Set those once per frame via `setFrame`, then call `project` per label.
 */
export class LabelProjector {
  private readonly view = new Matrix4();
  private readonly proj = new Matrix4();
  private targetW = 1;
  private targetH = 1;
  private readonly config: LabelManagerConfig;

  private readonly _q = new Quaternion();
  private readonly _v3 = new Vector3();

  constructor(config: LabelManagerConfig) {
    this.config = config;
  }

  setFrame(
    view: Matrix4,
    proj: Matrix4,
    targetW: number,
    targetH: number,
  ): void {
    this.view.copy(view);
    this.proj.copy(proj);
    this.targetW = targetW;
    this.targetH = targetH;
  }

  checkVisible(label: Label): boolean {
    const bw = label.bounds.width;
    const bh = label.bounds.height;
    if (bw === 0 || bh === 0) return false;

    const ve = this.view.elements;
    const pe = this.proj.elements;
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
    const marginNDC = (maxBound * pe[0]) / ccw + this.config.ndcCullMargin; // usually gives ~20% breathing room

    if (Math.abs(ndcCx) > 1 + marginNDC || Math.abs(ndcCy) > 1 + marginNDC)
      return false;

    return true;
  }

  /** Project label to screen-space AABB. Returns null if culled. */
  project(label: Label, out: ScreenAABB): boolean {
    const bw = label.bounds.width;
    const bh = label.bounds.height;
    if (bw === 0 || bh === 0) return false;

    const ve = this.view.elements;
    const pe = this.proj.elements;
    const p = label.position;
    const cvx = ve[0] * p.x + ve[4] * p.y + ve[8] * p.z + ve[12];
    const cvy = ve[1] * p.x + ve[5] * p.y + ve[9] * p.z + ve[13];
    const cvz = ve[2] * p.x + ve[6] * p.y + ve[10] * p.z + ve[14];

    const offsetX = (label.offset.x * label.fontSize) / this.config.pxPerUnit;
    const offsetY = (label.offset.y * label.fontSize) / this.config.pxPerUnit;
    const ax = anchorOffsetX(label, bw) + offsetX;
    const ay = anchorOffsetY(label, bh) - offsetY;

    const viewDepth = Math.sqrt(cvx * cvx + cvy * cvy + cvz * cvz);
    const isViewport = label.rotationAlignment === RotationAlignment.Viewport;
    const q = isViewport
      ? null
      : this._q.set(
          label.rotation.x,
          label.rotation.y,
          label.rotation.z,
          label.rotation.w,
        );

    const W = this.targetW,
      H = this.targetH;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (let i = 0; i < 4; i++) {
      const ux = i === 1 || i === 2 ? 1 : 0;
      const uy = i === 2 || i === 3 ? 1 : 0;
      const localX = (ux * bw + ax) * viewDepth;
      const localY = (uy * bh + ay) * viewDepth;
      let vx: number, vy: number, vz: number;
      if (isViewport) {
        vx = cvx + localX;
        vy = cvy + localY;
        vz = cvz;
      } else {
        this._v3.set(localX, localY, 0).applyQuaternion(q!);
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
