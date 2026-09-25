import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  type ShaderMaterial,
  type Vector2,
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

/** Instances the draw lists start at, and the slack a grow takes. */
const INITIAL_INSTANCES = 4096;
const INSTANCE_SLACK = 1.5;

/** Writes a label's texels as flat floats, {@link LABEL_FLOATS} of them at `at`. */
function writeLabelFloats(label: Label, out: Float32Array, at: number) {
  out[at] = label.position.x;
  out[at + 1] = label.position.y;
  out[at + 2] = label.position.z;
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
}

/** Writes glyphs as flat floats, {@link GLYPH_FLOATS} each, from `at`. */
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

/** Grows a staging buffer to hold `floats`, geometrically, without keeping its contents. */
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
 * Owns the mesh every label draws through, and the data textures behind it.
 * One instance per label.
 *
 * Label and glyph data live in {@link InstancedDataTexture}s keyed by label id,
 * so {@link LabelMeshManager.update} rewrites only the labels that changed.
 * The draw list is separate: {@link LabelMeshManager.cull} rebuilds it.
 *
 * The mesh's own transform is ignored: label positions are world coordinates.
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

  /** Staging buffers for one `update` call, reused across calls and never shrunk. */
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

    const material = createLabelMaterial(atlas, this._labelData.texture, this._glyphData.texture);
    this.mesh = new Mesh(this.geom, material);
    this.mesh.frustumCulled = false;
    const viewport = material.uniforms.uViewport.value as Vector2;
    this.mesh.onBeforeRender = (renderer: WebGLRenderer) => {
      renderer.getSize(viewport);
    };
  }

  /**
   * Regrows the instance lists to hold `min` labels, keeping the `written`
   * already staged by this cull. three refuses to resize a live attribute, so
   * the attribute objects are replaced and the geometry disposed.
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
   * Write label work to the data textures. Does not touch the draw list; call
   * {@link LabelMeshManager.cull} for that.
   *
   * @param changes - Labels to write, and ids to free.
   * @param atlasReplaced - The atlas grew, replacing its texture.
   */
  update(changes: MeshChanges, atlasReplaced: boolean) {
    const { add, relayout, update, remove } = changes;

    this._labelData.update(this._stageLabels([add, relayout, update]), remove);
    this._glyphData.update(this._stageGlyphs([add, relayout]), remove);

    const uniforms = this.mesh.material.uniforms;
    uniforms.uLabelTex.value = this._labelData.texture;
    uniforms.uGlyphTex.value = this._glyphData.texture;
    if (atlasReplaced) uniforms.uAtlas.value = this._atlas.texture;
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
   * Rewrite the draw list: one instance per label that is placed or still
   * fading out, carrying its glyph run and eased fade.
   *
   * @param labels - Every label the manager owns, in any order.
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

    // Upload only the slice drawn: the lists keep the high-water mark of every
    // cull so far.
    this.geom.instanceCount = pos;
    this._labelSpanAttr.addUpdateRange(0, pos * 3);
    this._labelSpanAttr.needsUpdate = true;
    this._labelFadeAttr.addUpdateRange(0, pos);
    this._labelFadeAttr.needsUpdate = true;

    this.mesh.visible = pos > 0;
  }

  /** Releases the geometry, both data textures and the material. */
  dispose() {
    this.geom.dispose();
    this._labelData.dispose();
    this._glyphData.dispose();
    this.mesh.material.dispose();
  }
}
