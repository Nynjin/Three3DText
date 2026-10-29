import {
  type Camera,
  type DataTexture,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  type Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { Label } from '../Label';
import type { ImageAtlas, ImageEntry } from '../Images/ImageAtlas';
import type { LabelManagerConfig } from '../Types/LabelConfig';
import { InstancedDataTexture, type ItemAllocation } from './Textures/InstancedDataTexture';
import { ICON_TEXELS } from './TexelLayout';
import { ICON_FRAG, ICON_VERT } from './Shaders/Icon.glsl';

const ICON_FLOATS = ICON_TEXELS * 4;
const INITIAL_INSTANCES = 1024;
const INSTANCE_SLACK = 1.5;

export type IconMesh = Mesh<InstancedBufferGeometry, ShaderMaterial>;

/** Two stretch ranges as `from0, to0, from1, to1`; a missing second range is empty at the end. */
function ranges(list: [number, number][], length: number, out: Float32Array, at: number) {
  const [a, b] = list[0] ?? [0, length];
  const [c, d] = list[1] ?? [length, length];
  out[at] = a;
  out[at + 1] = b;
  out[at + 2] = c;
  out[at + 3] = d;
}

function writeIconFloats(label: Label, image: ImageEntry, out: Float32Array, at: number) {
  const q = label.iconQuad;
  out[at] = q.cx;
  out[at + 1] = q.cy;
  out[at + 2] = q.width;
  out[at + 3] = q.height;

  out[at + 4] = image.px;
  out[at + 5] = image.py;
  out[at + 6] = image.width;
  out[at + 7] = image.height;

  out[at + 8] = label.iconColor.r;
  out[at + 9] = label.iconColor.g;
  out[at + 10] = label.iconColor.b;
  out[at + 11] = label.iconOpacity;

  const halo = image.sdf && label.iconHaloWidth + label.iconHaloBlur > 0;
  out[at + 12] = label.iconHaloColor.r;
  out[at + 13] = label.iconHaloColor.g;
  out[at + 14] = label.iconHaloColor.b;
  out[at + 15] = halo ? label.iconOpacity : 0;

  out[at + 16] = label.iconHaloWidth;
  out[at + 17] = label.iconHaloBlur;
  out[at + 18] = image.sdf ? 1 : 0;
  out[at + 19] = label.iconSize / image.pixelRatio;

  ranges(image.stretchX, image.width, out, at + 20);
  ranges(image.stretchY, image.height, out, at + 24);
}

/**
 * Owns the icon mesh, one instance per drawn icon, and the icon data texture
 * keyed by label id. Icons read their label's position, rotation and
 * alignment from the label data texture.
 */
export class IconMeshManager {
  readonly mesh: IconMesh;

  private readonly _geom = new InstancedBufferGeometry();
  private _span = new Int32Array(INITIAL_INSTANCES * 2);
  private _fade = new Float32Array(INITIAL_INSTANCES);
  private _spanAttr = new InstancedBufferAttribute(this._span, 2);
  private _fadeAttr = new InstancedBufferAttribute(this._fade, 1);
  private readonly _iconData: InstancedDataTexture;
  private readonly _images: ImageAtlas;
  private readonly _config: LabelManagerConfig;
  private _staging = new Float32Array(0);

  constructor(config: LabelManagerConfig, images: ImageAtlas, labelTexture: DataTexture | null, maxTextureSize: number) {
    this._config = config;
    this._images = images;
    this._iconData = new InstancedDataTexture(ICON_TEXELS, -1, maxTextureSize);

    const base = new PlaneGeometry(1, 1);
    this._geom.index = base.index;
    this._geom.attributes.position = base.attributes.position;
    base.dispose();
    this._geom.setAttribute('iconSpan', this._spanAttr);
    this._geom.setAttribute('iconFade', this._fadeAttr);
    this._geom.instanceCount = 0;

    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: ICON_VERT,
      fragmentShader: ICON_FRAG,
      uniforms: {
        uImages: { value: images.texture },
        uLabelTex: { value: labelTexture },
        uIconTex: { value: this._iconData.texture },
        uViewport: { value: new Vector2(1, 1) },
        uEyeHigh: { value: new Vector3() },
        uEyeLow: { value: new Vector3() },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new Mesh(this._geom, material);
    this.mesh.frustumCulled = false;

    const { uViewport, uEyeHigh, uEyeLow } = material.uniforms;
    const eye = new Vector3();
    this.mesh.onBeforeRender = (renderer: WebGLRenderer, _scene: Scene, camera: Camera) => {
      renderer.getSize(uViewport.value as Vector2);
      eye.setFromMatrixPosition(camera.matrixWorld);
      (uEyeHigh.value as Vector3).set(Math.fround(eye.x), Math.fround(eye.y), Math.fround(eye.z));
      (uEyeLow.value as Vector3).set(eye.x - Math.fround(eye.x), eye.y - Math.fround(eye.y), eye.z - Math.fround(eye.z));
    };
  }

  /**
   * Writes the icons of `labels`; a label without a resolved icon frees its
   * slot, as do `remove` ids.
   *
   * @param labels - Labels to write.
   * @param remove - Ids whose icon slot is freed.
   * @param labelTexture - Current label data texture, replaced when it grows.
   */
  update(labels: Label[], remove: string[], labelTexture: DataTexture) {
    const allocs: ItemAllocation[] = [];
    const drop = [...remove];
    this._staging = this._staging.length >= labels.length * ICON_FLOATS
      ? this._staging
      : new Float32Array(Math.max(labels.length * ICON_FLOATS, this._staging.length * 2));
    let at = 0;
    for (const label of labels) {
      const image = this._images.get(label.iconImage);
      if (!image || label.iconQuad.width === 0) {
        drop.push(label.id);
        continue;
      }
      writeIconFloats(label, image, this._staging, at);
      allocs.push({ key: label.id, data: this._staging.subarray(at, at + ICON_FLOATS) });
      at += ICON_FLOATS;
    }
    this._iconData.update([], drop);
    this._iconData.update(allocs, []);

    const u = this.mesh.material.uniforms;
    u.uIconTex.value = this._iconData.texture;
    u.uLabelTex.value = labelTexture;
    u.uImages.value = this._images.texture;
  }

  /**
   * Rewrites the draw list: one instance per placed or fading-out icon.
   *
   * @param labels - Placed or fading labels, any order.
   * @param labelTexelOf - First texel of a label in the label data texture.
   */
  cull(labels: Iterable<Label>, labelTexelOf: (id: string) => number | undefined) {
    const gamma = this._config.fadeGamma;
    let pos = 0;
    for (const label of labels) {
      if (label.iconFade === 1 && !(label.placedIcon && label.visible)) continue;
      const iconIdx = this._iconData.getFirstTexelIndexOf(label.id);
      const labelIdx = labelTexelOf(label.id);
      if (iconIdx === undefined || labelIdx === undefined) continue;

      if (pos === this._fade.length) this._grow(pos + 1, pos);
      this._span[pos * 2] = labelIdx;
      this._span[pos * 2 + 1] = iconIdx;
      this._fade[pos] = gamma === 1 ? label.iconFade : 1 - (1 - label.iconFade) ** gamma;
      pos++;
    }
    this._geom.instanceCount = pos;
    this._spanAttr.addUpdateRange(0, pos * 2);
    this._spanAttr.needsUpdate = true;
    this._fadeAttr.addUpdateRange(0, pos);
    this._fadeAttr.needsUpdate = true;
  }

  /** Next render uploads the icon data texture whole. */
  requestFullUpload() {
    this._iconData.requestFullUpload();
  }

  dispose() {
    this._geom.dispose();
    this._iconData.dispose();
    this.mesh.material.dispose();
  }

  /** three cannot resize a live attribute: replace both and dispose the geometry. */
  private _grow(min: number, written: number) {
    const n = Math.ceil(min * INSTANCE_SLACK);
    const span = new Int32Array(n * 2);
    const fade = new Float32Array(n);
    span.set(this._span.subarray(0, written * 2));
    fade.set(this._fade.subarray(0, written));
    this._span = span;
    this._fade = fade;
    this._geom.dispose();
    this._spanAttr = new InstancedBufferAttribute(span, 2);
    this._fadeAttr = new InstancedBufferAttribute(fade, 1);
    this._geom.setAttribute('iconSpan', this._spanAttr);
    this._geom.setAttribute('iconFade', this._fadeAttr);
  }
}
