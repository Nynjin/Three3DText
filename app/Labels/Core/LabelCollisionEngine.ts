import {
  Camera,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  RGBAFormat,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { Label, RotationAlignment, TextAnchorX, TextAnchorY } from "./Label";
import { createCollisionMaterial } from "../Render/Materials/CollisionMaterial";

const MAX_COLLISION_LABELS = 16_777_215; // 255^3, reserve color 0 for background

export interface CollisionDebugSegment {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  shouldRender: boolean;
}


export class LabelCollisionEngine {
  public lastId = 0;
  public minVisibleRatio = 0.95;

  private labels: Label[] = [];
  private dirty = true;

  private readonly pxPerUnit: number;
  private readonly downsample: number;

  private readonly renderer: WebGLRenderer;
  private readonly target: WebGLRenderTarget;
  private readonly scene = new Scene(); // TODO : reuse current scene
  private readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;

  private geometry = new InstancedBufferGeometry();
  private capacity = 0;

  private positionData = new Float32Array(0);
  private boundsData = new Float32Array(0);
  private anchorData = new Float32Array(0);
  private rotationData = new Float32Array(0);
  private alignmentData = new Float32Array(0);
  private colorData = new Float32Array(0);

  private positionAttr = new InstancedBufferAttribute(this.positionData, 3);
  private boundsAttr = new InstancedBufferAttribute(this.boundsData, 2);
  private anchorAttr = new InstancedBufferAttribute(this.anchorData, 2);
  private rotationAttr = new InstancedBufferAttribute(this.rotationData, 4);
  private alignmentAttr = new InstancedBufferAttribute(this.alignmentData, 1);
  private colorAttr = new InstancedBufferAttribute(this.colorData, 3);

  private pixelBuffer: Uint8Array;
  private readonly tmpLocal = new Vector3();
  private readonly tmpWorld = new Vector3();
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();
  private readonly tmpD = new Vector3();
  private readonly tmpView = new Vector4();
  private readonly tmpClip = new Vector4();
  private readonly ndcA = new Vector3();
  private readonly ndcB = new Vector3();
  private readonly ndcC = new Vector3();
  private readonly ndcD = new Vector3();

  constructor(canvas: HTMLCanvasElement, renderer: WebGLRenderer, pxPerUnit = 1024, downsample = 8) {
    this.pxPerUnit = pxPerUnit;
    this.downsample = downsample;
    this.renderer = renderer;

    // TODO: check if fixed size would work better than downsample (avoid weak PC using 4k monitor)
    const targetWidth = Math.max(1, Math.floor(canvas.width / downsample));
    const targetHeight = Math.max(1, Math.floor(canvas.height / downsample));

    this.target = new WebGLRenderTarget(targetWidth, targetHeight, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });

    const base = new PlaneGeometry(1, 1);
    this.geometry.index = base.index;
    this.geometry.attributes.position = base.attributes.position;
    this.geometry.attributes.uv = base.attributes.uv;
    base.dispose();

    this.geometry.setAttribute("instancePosition", this.positionAttr);
    this.geometry.setAttribute("instanceBounds", this.boundsAttr);
    this.geometry.setAttribute("instanceAnchor", this.anchorAttr);
    this.geometry.setAttribute("instanceRotation", this.rotationAttr);
    this.geometry.setAttribute("instanceRotationAlignment", this.alignmentAttr);
    this.geometry.setAttribute("instanceColor", this.colorAttr);

    const material = createCollisionMaterial();

    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.scene.add(this.mesh);

    this.pixelBuffer = new Uint8Array(targetWidth * targetHeight * 4);
  }

  setSize(canvas: HTMLCanvasElement) {
    const targetWidth = Math.max(1, Math.floor(canvas.width / this.downsample));
    const targetHeight = Math.max(1, Math.floor(canvas.height / this.downsample));
    this.target.setSize(targetWidth, targetHeight);
    this.pixelBuffer = new Uint8Array(targetWidth * targetHeight * 4);
    this.dirty = true;
  }

  // TODO : consider update to labels without complete reconstruction ?
  setLabels(labels: Label[]) {
    this.labels = labels;
    this.dirty = true;
  }

  addLabels(labels: Label[]) {
    this.labels.push(...labels);
    this.dirty = true;
  }

  removeLabels(ids: string[]) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    this.labels = this.labels.filter((label) => !idSet.has(label.id));
    this.dirty = true;
  }

  clear() {
    this.labels = [];
    this.dirty = true;
  }

  getDebugSegments(camera: Camera, maxSegments = 50000): CollisionDebugSegment[] {
    const segments: CollisionDebugSegment[] = [];
    const maxLabels = Math.floor(maxSegments / 4);
    const labelCount = Math.min(this.labels.length, maxLabels);

    for (let i = 0; i < labelCount; i++) {
      const label = this.labels[i];
      const bounds = label.bounds;
      if (!bounds) continue;

      const width = bounds.width;
      const height = bounds.height;
      const offsetX = (label.offset.x * label.fontSize) / this.pxPerUnit;
      const offsetY = (label.offset.y * label.fontSize) / this.pxPerUnit;
      const ox = this._anchorOffsetX(label, width) + offsetX;
      const oy = this._anchorOffsetY(label, height) - offsetY;

      this._localToDebugWorld(label, ox, oy, camera, this.tmpA);
      this._localToDebugWorld(label, ox + width, oy, camera, this.tmpB);
      this._localToDebugWorld(label, ox + width, oy + height, camera, this.tmpC);
      this._localToDebugWorld(label, ox, oy + height, camera, this.tmpD);

      segments.push(
        {
          ax: this.tmpA.x,
          ay: this.tmpA.y,
          az: this.tmpA.z,
          bx: this.tmpB.x,
          by: this.tmpB.y,
          bz: this.tmpB.z,
          shouldRender: label.shouldRender,
        },
        {
          ax: this.tmpB.x,
          ay: this.tmpB.y,
          az: this.tmpB.z,
          bx: this.tmpC.x,
          by: this.tmpC.y,
          bz: this.tmpC.z,
          shouldRender: label.shouldRender,
        },
        {
          ax: this.tmpC.x,
          ay: this.tmpC.y,
          az: this.tmpC.z,
          bx: this.tmpD.x,
          by: this.tmpD.y,
          bz: this.tmpD.z,
          shouldRender: label.shouldRender,
        },
        {
          ax: this.tmpD.x,
          ay: this.tmpD.y,
          az: this.tmpD.z,
          bx: this.tmpA.x,
          by: this.tmpA.y,
          bz: this.tmpA.z,
          shouldRender: label.shouldRender,
        },
      );
    }

    return segments;
  }

  evaluate(camera: Camera) {
    if (this.dirty) {
      this._syncGeometry();
      this.dirty = false;
    }

    this._render(this.renderer, camera);

    this.renderer.readRenderTargetPixels(
      this.target,
      0,
      0,
      this.target.width,
      this.target.height,
      this.pixelBuffer,
    );

    const counts = new Uint32Array(this.labels.length + 1);

    for (let i = 0; i < this.pixelBuffer.length; i += 4) {
      const alpha = this.pixelBuffer[i + 3];
      if (alpha === 0) continue;

      const id = this._decodeId(
        this.pixelBuffer[i],
        this.pixelBuffer[i + 1],
        this.pixelBuffer[i + 2],
      );

      if (id > 0 && id < counts.length) {
        counts[id]++;
      }
    }

    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i];
      const expectedPixels = this._expectedPixelsForLabel(label, camera);
      const requiredPixels = expectedPixels * this.minVisibleRatio;
      // TODO: using label.hasRendered this way reduces flicker but causes more overlap
      // TODO : another method would be to increase a Z bias so front labels don't render on top
      label.shouldRender = counts[i + 1] >= requiredPixels || (counts[i + 1] >= (requiredPixels*0.9) && label.hasRendered); 
    }
  }

  dispose() {
    this.geometry.dispose();
    this.mesh.material.dispose();
    this.target.dispose();
  }

  private _render(renderer: WebGLRenderer, camera: Camera) {
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(null);
  }

  private _syncGeometry() {
    const count = Math.min(this.labels.length, MAX_COLLISION_LABELS);
    // todo : max count should be applied globally
    if (this.labels.length > MAX_COLLISION_LABELS) {
      console.warn(
        `LabelCollisionEngine: can only render ${MAX_COLLISION_LABELS} unique label colors. Truncating ${this.labels.length - MAX_COLLISION_LABELS} labels.`,
      );
    }
    this.lastId = count;
    this._ensureCapacity(count);

    for (let i = 0; i < count; i++) {
      const label = this.labels[i];
      const base = i * 3;
      const bounds = label.bounds;

      this.positionData[base + 0] = label.position.x;
      this.positionData[base + 1] = label.position.y;
      this.positionData[base + 2] = label.position.z;

      const sizeBase = i * 2;
      const width = (bounds?.width ?? 0);
      const height = (bounds?.height ?? 0);
      const offsetX = (label.offset.x * label.fontSize) / this.pxPerUnit;
      const offsetY = (label.offset.y * label.fontSize) / this.pxPerUnit;

      this.boundsData[sizeBase + 0] = width;
      this.boundsData[sizeBase + 1] = height;
      this.anchorData[sizeBase + 0] = this._anchorOffsetX(label, width) + offsetX;
      this.anchorData[sizeBase + 1] = this._anchorOffsetY(label, height) - offsetY;

      const rotBase = i * 4;
      this.rotationData[rotBase + 0] = label.rotation.x;
      this.rotationData[rotBase + 1] = label.rotation.y;
      this.rotationData[rotBase + 2] = label.rotation.z;
      this.rotationData[rotBase + 3] = label.rotation.w;

      this.alignmentData[i] = label.rotationAlignment === RotationAlignment.Viewport ? 1 : 0;

      const id = i + 1;
      const color = this._encodeId(id);
      const colorBase = i * 3;
      this.colorData[colorBase + 0] = color[0] / 255;
      this.colorData[colorBase + 1] = color[1] / 255;
      this.colorData[colorBase + 2] = color[2] / 255;
    }

    this.positionAttr.needsUpdate = true;
    this.boundsAttr.needsUpdate = true;
    this.anchorAttr.needsUpdate = true;
    this.rotationAttr.needsUpdate = true;
    this.alignmentAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;

    // TODO: set instanceCount high since can't be reallocated / regen geometry on capacity excess
    this.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
  }

  private _ensureCapacity(count: number) {
    if (count <= this.capacity) return;

    this.capacity = count;
    this.positionData = new Float32Array(count * 3);
    this.boundsData = new Float32Array(count * 2);
    this.anchorData = new Float32Array(count * 2);
    this.rotationData = new Float32Array(count * 4);
    this.alignmentData = new Float32Array(count);
    this.colorData = new Float32Array(count * 3);

    this.positionAttr = new InstancedBufferAttribute(this.positionData, 3);
    this.boundsAttr = new InstancedBufferAttribute(this.boundsData, 2);
    this.anchorAttr = new InstancedBufferAttribute(this.anchorData, 2);
    this.rotationAttr = new InstancedBufferAttribute(this.rotationData, 4);
    this.alignmentAttr = new InstancedBufferAttribute(this.alignmentData, 1);
    this.colorAttr = new InstancedBufferAttribute(this.colorData, 3);

    this.geometry.setAttribute("instancePosition", this.positionAttr);
    this.geometry.setAttribute("instanceBounds", this.boundsAttr);
    this.geometry.setAttribute("instanceAnchor", this.anchorAttr);
    this.geometry.setAttribute("instanceRotation", this.rotationAttr);
    this.geometry.setAttribute("instanceRotationAlignment", this.alignmentAttr);
    this.geometry.setAttribute("instanceColor", this.colorAttr);
  }


  private _anchorOffsetX(label: Label, width: number): number {
    switch (label.anchorX) {
      case TextAnchorX.Left:
        return 0;
      case TextAnchorX.Right:
        return -width;
      case TextAnchorX.Center:
      default:
        return -width * 0.5;
    }
  }

  private _anchorOffsetY(label: Label, height: number): number {
    switch (label.anchorY) {
      case TextAnchorY.Top:
        return -height;
      case TextAnchorY.Bottom:
        return 0;
      case TextAnchorY.Baseline:
      case TextAnchorY.Middle:
      default:
        return -height * 0.5;
    }
  }

  private _encodeId(id: number): [number, number, number] {
    return [id & 255, (id >> 8) & 255, (id >> 16) & 255];
  }

  private _decodeId(r: number, g: number, b: number): number {
    return r | (g << 8) | (b << 16);
  }

  private _distanceScale(label: Label, camera: Camera): number {
    this.tmpView.set(label.position.x, label.position.y, label.position.z, 1).applyMatrix4(camera.matrixWorldInverse);
    return Math.max(1e-6, Math.hypot(this.tmpView.x, this.tmpView.y, this.tmpView.z));
  }

  private _localToDebugWorld(label: Label, lx: number, ly: number, camera: Camera, out: Vector3) {
    const scale = this._distanceScale(label, camera);
    this.tmpLocal.set(lx * scale, ly * scale, 0);

    if (label.rotationAlignment === RotationAlignment.Viewport) {
      // Match shader viewport path in CPU: local offset in view-space, then projection.
      this.tmpView.set(label.position.x, label.position.y, label.position.z, 1).applyMatrix4(camera.matrixWorldInverse);
      this.tmpView.x += this.tmpLocal.x;
      this.tmpView.y += this.tmpLocal.y;
    } else {
      // Match shader map path in CPU: rotate local in world-space, then projection.
      this.tmpWorld.copy(this.tmpLocal).applyQuaternion(label.rotation).add(label.position);
      this.tmpView.set(this.tmpWorld.x, this.tmpWorld.y, this.tmpWorld.z, 1).applyMatrix4(camera.matrixWorldInverse);
    }

    this.tmpClip.copy(this.tmpView).applyMatrix4(camera.projectionMatrix);
    const invW = this.tmpClip.w !== 0 ? 1 / this.tmpClip.w : 1;
    out.set(
      this.tmpClip.x * invW,
      this.tmpClip.y * invW,
      this.tmpClip.z * invW,
    ).unproject(camera);
  }

  private _localToNdc(label: Label, lx: number, ly: number, camera: Camera, out: Vector3) {
    const scale = this._distanceScale(label, camera);
    this.tmpLocal.set(lx * scale, ly * scale, 0);

    if (label.rotationAlignment === RotationAlignment.Viewport) {
      this.tmpView.set(label.position.x, label.position.y, label.position.z, 1).applyMatrix4(camera.matrixWorldInverse);
      this.tmpView.x += this.tmpLocal.x;
      this.tmpView.y += this.tmpLocal.y;
    } else {
      this.tmpWorld.copy(this.tmpLocal).applyQuaternion(label.rotation).add(label.position);
      this.tmpView.set(this.tmpWorld.x, this.tmpWorld.y, this.tmpWorld.z, 1).applyMatrix4(camera.matrixWorldInverse);
    }

    this.tmpClip.copy(this.tmpView).applyMatrix4(camera.projectionMatrix);
    const invW = this.tmpClip.w !== 0 ? 1 / this.tmpClip.w : 1;
    out.set(
      this.tmpClip.x * invW,
      this.tmpClip.y * invW,
      this.tmpClip.z * invW,
    );
  }

  private _expectedPixelsForLabel(label: Label, camera: Camera): number {
    const bounds = label.bounds;
    if (!bounds) return 0;

    const width = bounds.width;
    const height = bounds.height;
    const offsetX = (label.offset.x * label.fontSize) / this.pxPerUnit;
    const offsetY = (label.offset.y * label.fontSize) / this.pxPerUnit;
    const ox = this._anchorOffsetX(label, width) + offsetX;
    const oy = this._anchorOffsetY(label, height) - offsetY;

    this._localToNdc(label, ox, oy, camera, this.ndcA);
    this._localToNdc(label, ox + width, oy, camera, this.ndcB);
    this._localToNdc(label, ox + width, oy + height, camera, this.ndcC);
    this._localToNdc(label, ox, oy + height, camera, this.ndcD);

    const areaNdc = Math.abs(
      this.ndcA.x * this.ndcB.y - this.ndcB.x * this.ndcA.y +
      this.ndcB.x * this.ndcC.y - this.ndcC.x * this.ndcB.y +
      this.ndcC.x * this.ndcD.y - this.ndcD.x * this.ndcC.y +
      this.ndcD.x * this.ndcA.y - this.ndcA.x * this.ndcD.y,
    ) * 0.5;

    if (!Number.isFinite(areaNdc) || areaNdc <= 0) return 0;
    return areaNdc * this.target.width * this.target.height * 0.25;
  }
}
