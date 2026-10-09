import {
  type Camera,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  type Scene,
  type ShaderMaterial,
  type Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { SDFAtlas } from '../Shaping/SDFAtlas';
import { createLabelMaterial } from './Materials/LabelMaterial';
import type { GlyphInstance } from '../Shaping/GlyphRun';
import type { Label } from '../Label';
import { InstancedDataTexture, type ItemAllocation } from './Textures/InstancedDataTexture';
import type { LabelManagerConfig } from '../Types/LabelConfig';
import { GLYPH_NEXT_FLOAT, GLYPH_TEXELS, LABEL_TEXELS } from './TexelLayout';

/** Floats one label occupies in the label data texture. */
const LABEL_FLOATS = LABEL_TEXELS * 4;

/** Floats one glyph occupies in the glyph data texture. */
const GLYPH_FLOATS = GLYPH_TEXELS * 4;

/** Initial draw-list capacity, in instances, and the growth factor. */
const INITIAL_INSTANCES = 4096;
const INSTANCE_SLACK = 1.5;

/** Write a label's {@link LABEL_FLOATS} floats at `at`. */
function writeLabelFloats(label: Label, out: Float32Array, at: number) {
  const { x, y, z } = label.position;
  out[at] = x;
  out[at + 1] = y;
  out[at + 2] = z;
  out[at + 3] = 0;

  out[at + 4] = label.rotation.x;
  out[at + 5] = label.rotation.y;
  out[at + 6] = label.rotation.z;
  out[at + 7] = label.rotation.w;

  out[at + 8] = label.color.r;
  out[at + 9] = label.color.g;
  out[at + 10] = label.color.b;
  out[at + 11] = label.opacity;

  out[at + 12] = label.haloColor.r;
  out[at + 13] = label.haloColor.g;
  out[at + 14] = label.haloColor.b;
  out[at + 15] = label.getDisplayedHaloOpacity();

  const quad = label.quad;

  out[at + 16] = label.haloWidth;
  out[at + 17] = label.haloBlur;
  out[at + 18] = quad.cx;
  out[at + 19] = quad.cy;

  out[at + 20] = label.rotationAlignment;
  out[at + 21] = label.symbolPlacement;
  out[at + 22] = quad.width;
  out[at + 23] = quad.height;

  out[at + 24] = x - Math.fround(x);
  out[at + 25] = y - Math.fround(y);
  out[at + 26] = z - Math.fround(z);
  out[at + 27] = 0;
}

/** Split `v` into its float32 rounding (`high`) and the remainder (`low`). */
function splitDouble(v: Vector3, high: Vector3, low: Vector3) {
  high.set(Math.fround(v.x), Math.fround(v.y), Math.fround(v.z));
  low.set(v.x - high.x, v.y - high.y, v.z - high.z);
}

/** Write glyphs from `at`, {@link GLYPH_FLOATS} floats each. */
function writeGlyphFloats(glyphs: GlyphInstance[], out: Float32Array, at: number) {
  let o = at;
  for (const { offset, glyph } of glyphs) {
    out[o + GLYPH_NEXT_FLOAT] = -1; // next: written on allocation
    out[o + 1] = 0;
    out[o + 2] = 0;
    out[o + 3] = 0;

    out[o + 4] = offset.x;
    out[o + 5] = offset.y;
    out[o + 6] = glyph.w;
    out[o + 7] = glyph.h;

    out[o + 8] = glyph.px;
    out[o + 9] = glyph.py;
    out[o + 10] = glyph.pw;
    out[o + 11] = glyph.ph;

    o += GLYPH_FLOATS;
  }
}

/** Grow a staging buffer to hold `floats`, geometrically. Contents are not kept. */
function growStaging(buf: Float32Array<ArrayBuffer>, floats: number): Float32Array<ArrayBuffer> {
  if (buf.length >= floats) return buf;
  return new Float32Array(Math.max(floats, buf.length * 2));
}

export type LabelMesh = Mesh<InstancedBufferGeometry, ShaderMaterial>;

/** Label work for one {@link LabelMeshManager.update}. */
export interface MeshChanges {
  /** Labels new to the mesh, laid out. */
  add: Label[];
  /** Labels laid out again: their data and glyphs are rewritten. */
  relayout: Label[];
  /** Labels whose data changed and glyphs did not. */
  update: Label[];
  /** Ids whose slots are freed. */
  remove: string[];
}

/**
 * Owns the label mesh, one instance per label, and its data textures.
 *
 * Label and glyph data live in {@link InstancedDataTexture}s keyed by label id;
 * {@link LabelMeshManager.update} rewrites the given labels.
 * {@link LabelMeshManager.cull} rebuilds the draw list.
 *
 * The mesh's transform is ignored: label positions are world coordinates.
 */
export class LabelMeshManager {
  readonly geom: InstancedBufferGeometry = new InstancedBufferGeometry();
  readonly mesh: LabelMesh;

  /** `labelTexelIndex, glyphRunHead, glyphCount` per drawn label. */
  private _labelSpan: Int32Array = new Int32Array(INITIAL_INSTANCES * 3);
  private _labelFade: Float32Array = new Float32Array(INITIAL_INSTANCES);
  private _labelSpanAttr: InstancedBufferAttribute = new InstancedBufferAttribute(this._labelSpan, 3);
  private _labelFadeAttr: InstancedBufferAttribute = new InstancedBufferAttribute(this._labelFade, 1);

  private readonly _labelData: InstancedDataTexture;
  private readonly _glyphData: InstancedDataTexture;
  private readonly _atlas: SDFAtlas;

  private _warnedFull = false;

  /** Staging for `update`. Reused, never shrunk. */
  private _labelStaging = new Float32Array(0);
  private _glyphStaging = new Float32Array(0);

  private readonly _config: LabelManagerConfig;

  /**
   * @param config - Read live.
   * @param atlas - Atlas the shader samples.
   * @param maxTextureSize - Largest texture side the device accepts, in texels.
   */
  constructor(config: LabelManagerConfig, atlas: SDFAtlas, maxTextureSize: number) {
    this._config = config;
    this._atlas = atlas;
    this._labelData = new InstancedDataTexture(LABEL_TEXELS, -1, maxTextureSize);
    this._glyphData = new InstancedDataTexture(GLYPH_TEXELS, GLYPH_NEXT_FLOAT, maxTextureSize);

    const base = new PlaneGeometry(1, 1);
    this.geom.index = base.index;
    this.geom.attributes.position = base.attributes.position;
    this.geom.attributes.uv = base.attributes.uv;
    base.dispose();
    this.geom.setAttribute('labelSpan', this._labelSpanAttr);
    this.geom.setAttribute('occlusionFade', this._labelFadeAttr);
    this.geom.instanceCount = 0;

    const material = createLabelMaterial(atlas, this._labelData.texture, this._glyphData.texture);
    this.mesh = new Mesh(this.geom, material);
    this.mesh.frustumCulled = false;
    const { uViewport, uEyeHigh, uEyeLow } = material.uniforms;
    const eye = new Vector3();
    this.mesh.onBeforeRender = (renderer: WebGLRenderer, _scene: Scene, camera: Camera) => {
      renderer.getSize(uViewport.value as Vector2);
      splitDouble(eye.setFromMatrixPosition(camera.matrixWorld), uEyeHigh.value as Vector3, uEyeLow.value as Vector3);
    };
  }

  /**
   * Regrow the instance lists to hold `min` labels, keeping the first `written`.
   * three cannot resize a live attribute: the attributes are replaced and the
   * geometry disposed.
   */
  private _grow(min: number, written: number) {
    const n = Math.ceil(min * INSTANCE_SLACK);
    const span = new Int32Array(n * 3);
    const fade = new Float32Array(n);
    span.set(this._labelSpan.subarray(0, written * 3));
    fade.set(this._labelFade.subarray(0, written));
    this._labelSpan = span;
    this._labelFade = fade;

    this.geom.dispose();
    this._labelSpanAttr = new InstancedBufferAttribute(span, 3);
    this._labelFadeAttr = new InstancedBufferAttribute(fade, 1);
    this.geom.setAttribute('labelSpan', this._labelSpanAttr);
    this.geom.setAttribute('occlusionFade', this._labelFadeAttr);
  }

  /**
   * Write label work to the data textures. The draw list is left to
   * {@link LabelMeshManager.cull}.
   *
   * @param changes - Labels to write, ids to free.
   * @param atlasReplaced - The atlas grew, replacing its texture.
   *
   * @returns Labels that did not fit, and were not written.
   */
  update(changes: MeshChanges, atlasReplaced: boolean): Label[] {
    const { add, relayout, update, remove } = changes;
    const uniforms = this.mesh.material.uniforms;
    this._labelData.update([], remove);
    this._glyphData.update([], remove);
    const deferred: Label[] = [];
    const [addFit, relayoutFit] = this._fit([add, relayout], deferred);
    this._labelData.update(this._stageLabels([addFit, relayoutFit, update]), []);
    this._glyphData.update(this._stageGlyphs([addFit, relayoutFit]), []);

    uniforms.uLabelTex.value = this._labelData.texture;
    uniforms.uGlyphTex.value = this._glyphData.texture;
    if (atlasReplaced) uniforms.uAtlas.value = this._atlas.texture;

    if (deferred.length > 0 && !this._warnedFull) {
      this._warnedFull = true;
      console.warn(`LabelMeshManager: texture size limit reached; ${deferred.length} labels not drawn`);
    }
    return deferred;
  }

  /** Keep the labels that fit from each list; append the rest to `deferred`. */
  private _fit(lists: Label[][], deferred: Label[]): Label[][] {
    let labelRoom = this._labelData.freeItems;
    let glyphRoom = this._glyphData.freeItems;
    return lists.map(labels => labels.filter((label) => {
      const labelItems = this._labelData.itemCountOf(label.id) === 0 ? 1 : 0;
      const glyphItems = label.glyphs.length - this._glyphData.itemCountOf(label.id);
      if (labelItems > labelRoom || glyphItems > glyphRoom) {
        deferred.push(label);
        return false;
      }
      labelRoom -= labelItems;
      glyphRoom -= glyphItems;
      return true;
    }));
  }

  /** Next render uploads both data textures whole. */
  requestFullUpload() {
    this._labelData.requestFullUpload();
    this._glyphData.requestFullUpload();
  }

  /** @returns One allocation per label, viewing the staging buffer until the next call. */
  private _stageLabels(lists: Label[][]): ItemAllocation[] {
    let total = 0;
    for (const labels of lists) total += labels.length;
    this._labelStaging = growStaging(this._labelStaging, total * LABEL_FLOATS);
    const buf = this._labelStaging;

    const allocs: ItemAllocation[] = [];
    let at = 0;
    for (const labels of lists) {
      for (const label of labels) {
        writeLabelFloats(label, buf, at);
        allocs.push({ key: label.id, data: buf.subarray(at, at + LABEL_FLOATS) });
        at += LABEL_FLOATS;
      }
    }
    return allocs;
  }

  /**
   * @returns One allocation per label, viewing the staging buffer until the
   * next call. A label with no glyphs gets an empty one, which frees its glyphs.
   */
  private _stageGlyphs(lists: Label[][]): ItemAllocation[] {
    let total = 0;
    for (const labels of lists) for (const label of labels) total += label.glyphs.length;
    this._glyphStaging = growStaging(this._glyphStaging, total * GLYPH_FLOATS);
    const buf = this._glyphStaging;

    const allocs: ItemAllocation[] = [];
    let at = 0;
    for (const labels of lists) {
      for (const label of labels) {
        const floats = label.glyphs.length * GLYPH_FLOATS;
        writeGlyphFloats(label.glyphs, buf, at);
        allocs.push({ key: label.id, data: buf.subarray(at, at + floats) });
        at += floats;
      }
    }
    return allocs;
  }

  /**
   * Rewrite the draw list: one instance per placed or fading-out label, with its
   * glyph run and eased fade.
   *
   * @param labels - Placed or fading labels, any order.
   */
  cull(labels: Iterable<Label>) {
    let pos = 0;
    const gamma = this._config.fadeGamma;

    for (const label of labels) {
      if (label.occlusionFade === 1 && !(label.shouldRender && label.visible)) continue;

      const glyphIndices = this._glyphData.getTexelIndicesOf(label.id);
      if (!glyphIndices || glyphIndices.length === 0) continue;

      const labelIdx = this._labelData.getFirstTexelIndexOf(label.id);
      if (labelIdx === undefined) continue;

      const eased = gamma === 1
        ? label.occlusionFade
        : 1 - (1 - label.occlusionFade) ** gamma;

      if (pos === this._labelFade.length) this._grow(pos + 1, pos);

      const s = pos * 3;
      this._labelSpan[s] = labelIdx;
      this._labelSpan[s + 1] = glyphIndices[0];
      this._labelSpan[s + 2] = glyphIndices.length;
      this._labelFade[pos] = eased;
      pos++;
    }

    // Upload only the drawn slice; the lists keep their high-water mark.
    this.geom.instanceCount = pos;
    this._labelSpanAttr.addUpdateRange(0, pos * 3);
    this._labelSpanAttr.needsUpdate = true;
    this._labelFadeAttr.addUpdateRange(0, pos);
    this._labelFadeAttr.needsUpdate = true;
  }

  /** Release the geometry, both data textures and the material. */
  dispose() {
    this.geom.dispose();
    this._labelData.dispose();
    this._glyphData.dispose();
    this.mesh.material.dispose();
  }
}
