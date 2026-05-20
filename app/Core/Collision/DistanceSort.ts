import { Vector3 } from "three";
import { Label } from "../Label";

/**
 * In-place quicksort of a Label array by squared distance to a point.
 * Stack-bounded (recurses smaller partition, loops larger).
 *
 * The distance buffer is reused across calls — grow only when needed.
 */
export class DistanceSort {
  private distBuffer = new Float32Array(1024);

  sort(labels: Label[], point: Vector3): void {
    const n = labels.length;
    if (n <= 1) return;
    if (this.distBuffer.length < n) {
      this.distBuffer = new Float32Array(Math.max(n, this.distBuffer.length * 2));
    }
    const px = point.x, py = point.y, pz = point.z;
    for (let i = 0; i < n; i++) {
      const lp = labels[i].position;
      const dx = lp.x - px, dy = lp.y - py, dz = lp.z - pz;
      this.distBuffer[i] = dx*dx + dy*dy + dz*dz;
    }
    this.quicksort(labels, 0, n - 1);
  }

  private quicksort(labels: Label[], left: number, right: number) {
    const d = this.distBuffer;
    while (left < right) {
      const pivot = d[(left + right) >> 1];
      let i = left, j = right;
      while (i <= j) {
        while (d[i] < pivot) i++;
        while (d[j] > pivot) j--;
        if (i <= j) {
          const tl = labels[i]; labels[i] = labels[j]; labels[j] = tl;
          const td = d[i]; d[i] = d[j]; d[j] = td;
          i++; j--;
        }
      }
      if (j - left < right - i) {
        if (left < j) this.quicksort(labels, left, j);
        left = i;
      } else {
        if (i < right) this.quicksort(labels, i, right);
        right = j;
      }
    }
  }
}