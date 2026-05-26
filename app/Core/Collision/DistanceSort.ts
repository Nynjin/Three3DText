import { Vector3 } from "three";
import { Label } from "../Label";

const RENDER_PENALTY = 1e12; 

export class DistanceSort {
  private distBuffer = new Float32Array(1024);
  private indices = new Uint32Array(1024);
  private tempLabels: Label[] = [];

  sort(labels: Label[], point: Vector3): void {
    const n = labels.length;
    if (n <= 1) return;
    if (this.distBuffer.length < n) {
      this.distBuffer = new Float32Array(Math.max(n, this.distBuffer.length * 2));
      this.indices = new Uint32Array(this.distBuffer.length);
      this.tempLabels = new Array(this.distBuffer.length);
    }

    const px = point.x, py = point.y, pz = point.z;
    const d = this.distBuffer;
    const idx = this.indices;

    for (let i = 0; i < n; i++) {
      const label = labels[i];
      const lp = label.position;
      const dx = lp.x - px, dy = lp.y - py, dz = lp.z - pz;
      
      let dist = dx*dx + dy*dy + dz*dz;

      if (!label.shouldRender) {
        dist += RENDER_PENALTY;
      }

      d[i] = dist;
      idx[i] = i;
    }

    const activeIndices = new Uint32Array(idx.buffer, 0, n);

    activeIndices.sort((a, b) => {
      const diff = d[a] - d[b];
      if (diff === 0) return a - b;
      return diff;
    });

    for (let i = 0; i < n; i++) {
      this.tempLabels[i] = labels[activeIndices[i]];
    }

    for (let i = 0; i < n; i++) {
      labels[i] = this.tempLabels[i];
    }
  }
}