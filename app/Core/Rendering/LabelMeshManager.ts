import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  type ShaderMaterial,
} from 'three';
import type { SDFAtlas } from '../Shaping/SDFAtlas';
import {
  createFillMaterial,
  updateFillUniforms,
} from './Materials/FillMaterial';
import {
  createHaloMaterial,
  updateHaloUniforms,
} from './Materials/HaloMaterial';
import type { GlyphInstance } from '../Shaping/GlyphRun';
import type { Label } from '../Label';
import { InstancedDataTexture, type ItemAllocation } from './Textures/InstancedDataTexture';

/**
 * T0: label position + opacity (x, y, z, -)
 * T1: label rotation (quat x, y, z, w)
 * T2: color + opacity (r, g, b, a)
 * T3: halo color + opacity (r, g, b, a)
 * T4: halo params (width, blur, -, -)
 * T5: rotation alignment + symbol placement (rotationAlignment, symbolPlacement, -, -)
 */
export const LABEL_TEXELS = 6;

/**
 * T0: label index (i, -, -, -)
 * T1: char offset (x, y) + size (w, h)
 * T2: (px, py) in atlas + (pw, ph) size in atlas
 */
export const GLYPH_TEXELS = 3;

// ---------- Helper functions ----------

/** Floats one label occupies in the label data texture. */
const LABEL_FLOATS = LABEL_TEXELS * 4;

/** Floats one glyph occupies in the glyph data texture. */
const GLYPH_FLOATS = GLYPH_TEXELS * 4;

/**
 * Writes a label's texels as flat floats.
 *
 * @param label - Label to serialize.
 * @param out - Destination, with at least {@link LABEL_FLOATS} free at `at`.
 * @param at - Float offset to write from.
 */
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

  out[at + 16] = label.haloWidth;
  out[at + 17] = label.haloBlur;
  out[at + 18] = 0;
  out[at + 19] = 0;

  out[at + 20] = label.rotationAlignment;
  out[at + 21] = label.symbolPlacement;
  out[at + 22] = 0;
  out[at + 23] = 0;
}

/**
 * Writes a label's glyphs as flat floats, {@link GLYPH_FLOATS} each.
 *
 * @param labelIdx - Texel index of the owning label, which the shader follows
 * to read the label's own data.
 * @param glyphs - Glyph instances to serialize.
 * @param out - Destination, with room for `glyphs.length * GLYPH_FLOATS` at `at`.
 * @param at - Float offset to write from.
 */
function writeGlyphFloats(
  labelIdx: number,
  glyphs: GlyphInstance[],
  out: Float32Array,
  at: number,
) {
  let o = at;
  for (const { offset, glyph } of glyphs) {
    out[o] = labelIdx;
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

/**
 * Grows a staging buffer to hold `floats`, geometrically. Contents are not
 * preserved — every caller rewrites what it reads.
 *
 * @param buf - Current buffer.
 * @param floats - Capacity needed.
 *
 * @returns `buf` if it already fits, otherwise a larger one.
 */
function growStaging(buf: Float32Array<ArrayBuffer>, floats: number): Float32Array<ArrayBuffer> {
  if (buf.length >= floats) return buf;
  return new Float32Array(Math.max(floats, buf.length * 2));
}

// ---------- Mesh Manager Class ----------

export type LabelMesh = Mesh<InstancedBufferGeometry, ShaderMaterial>;

/**
 * @description Owns the two meshes every label draws through — fill and halo,
 * sharing one instanced quad geometry — and the data textures behind them.
 *
 * Label and glyph attributes live in {@link InstancedDataTexture}s keyed by
 * label id, so {@link LabelMeshManager.update} rewrites only the labels that
 * changed. The draw list itself is a separate, cheaper pass:
 * {@link LabelMeshManager.cull} rebuilds it every frame visibility moves.
 */
export class LabelMeshManager {
  readonly geom: InstancedBufferGeometry = new InstancedBufferGeometry();
  readonly fillMesh: LabelMesh = new Mesh(this.geom);
  readonly haloMesh: LabelMesh = new Mesh(this.geom);

  // Static max glyph count
  // todo : make value public and either calculate absolute max or allow resize with geometry rebuild
  // todo : consider moving glyphIndex to textureUniform for dynamic indexing ?
  private _glyphIndex: Int32Array = new Int32Array(1000000);
  private _occlusionFade: Float32Array = new Float32Array(1000000);
  private _glyphIndexAttr: InstancedBufferAttribute = new InstancedBufferAttribute(this._glyphIndex, 1);
  private _occlusionFadeAttr: InstancedBufferAttribute = new InstancedBufferAttribute(this._occlusionFade, 1);

  private _labelDataBuffer = new InstancedDataTexture(LABEL_TEXELS);
  private _glyphDataBuffer = new InstancedDataTexture(GLYPH_TEXELS);

  /**
   * Reused staging buffers for one `update` call. Kept between calls so a
   * steady stream of updates allocates nothing, and grown but never shrunk.
   */
  private _labelStaging = new Float32Array(0);
  private _glyphStaging = new Float32Array(0);

  constructor() {
    const base = new PlaneGeometry(1, 1);
    this.geom.index = base.index;
    this.geom.attributes.position = base.attributes.position;
    this.geom.attributes.uv = base.attributes.uv;
    base.dispose();

    this.fillMesh.frustumCulled = false;
    this.haloMesh.frustumCulled = false;
    this.fillMesh.renderOrder = 1;
    this.haloMesh.renderOrder = 0;
    this.fillMesh.matrixAutoUpdate = false;
    this.haloMesh.matrixAutoUpdate = false;

    this.geom.setAttribute('glyphIndex', this._glyphIndexAttr);
    this.geom.setAttribute('occlusionFade', this._occlusionFadeAttr);
  }

  /** Repoints both materials at the current data textures, keeping the atlas. */
  private _syncUniforms() {
    updateFillUniforms(
      this.fillMesh.material,
      this._labelDataBuffer.texture,
      this._glyphDataBuffer.texture,
    );
    updateHaloUniforms(
      this.haloMesh.material,
      this._labelDataBuffer.texture,
      this._glyphDataBuffer.texture,
    );
    this.fillMesh.material.uniformsNeedUpdate = true;
    this.haloMesh.material.uniformsNeedUpdate = true;
  }

  /**
   * Rebuild both materials against an SDF atlas. Needed when the atlas texture
   * itself changed, not just its contents.
   *
   * @param atlas - Atlas the glyph shaders sample from.
   */
  syncAtlas(atlas: SDFAtlas) {
    this.fillMesh.material = createFillMaterial(
      atlas,
      this._labelDataBuffer.texture,
      this._glyphDataBuffer.texture,
    );
    this.haloMesh.material = createHaloMaterial(
      atlas,
      this._labelDataBuffer.texture,
      this._glyphDataBuffer.texture,
    );
    this.fillMesh.material.uniformsNeedUpdate = true;
    this.haloMesh.material.uniformsNeedUpdate = true;
  }

  /**
   * Write pending label work to the data textures. Does not touch the draw
   * list — call {@link LabelMeshManager.cull} for that.
   *
   * @param toAdd - Labels needing new slots.
   * @param toRemove - Ids whose slots are freed, for both textures.
   * @param toUpdate - Labels whose data changed in place.
   * @param atlas - Pass only when the atlas texture was replaced, which forces
   * a material rebuild instead of a uniform refresh.
   *
   * @throws {Error} If a label has glyphs but no label-data slot.
   */
  update(
    toAdd: Label[],
    toRemove: string[],
    toUpdate: Label[],
    atlas?: SDFAtlas,
  ) {
    // Label data first: glyph texels reference the label's texel index, so the
    // label has to own a slot before its glyphs can point at it.
    const labelStaged = this._stageLabels(toAdd, toUpdate);
    this._labelDataBuffer.update(labelStaged.add, toRemove, labelStaged.update);

    const glyphStaged = this._stageGlyphs(toAdd, toUpdate);
    this._glyphDataBuffer.update(glyphStaged.add, toRemove, glyphStaged.update);

    if (atlas) {
      this.syncAtlas(atlas);
    } else {
      this._syncUniforms();
    }
  }

  /**
   * Serializes both label lists into the label staging buffer.
   *
   * Both lists share one buffer at distinct offsets, because
   * {@link InstancedDataTexture.update} reads add and update allocations in the
   * same call.
   *
   * @param toAdd - Labels needing new slots.
   * @param toUpdate - Labels whose data changed.
   *
   * @returns Allocations viewing the staging buffer, valid until the next call.
   */
  private _stageLabels(toAdd: Label[], toUpdate: Label[]) {
    const total = (toAdd.length + toUpdate.length) * LABEL_FLOATS;
    this._labelStaging = growStaging(this._labelStaging, total);
    const buf = this._labelStaging;

    let at = 0;
    const stage = (labels: Label[]) => {
      const allocs: ItemAllocation[] = [];
      for (const label of labels) {
        writeLabelFloats(label, buf, at);
        allocs.push({ key: label.id, data: buf.subarray(at, at + LABEL_FLOATS) });
        at += LABEL_FLOATS;
      }
      return allocs;
    };

    return { add: stage(toAdd), update: stage(toUpdate) };
  }

  /**
   * Serializes both label lists' glyphs into the glyph staging buffer.
   *
   * Labels with no glyphs are skipped rather than staged empty: a style-only
   * update carries `glyphs: []`, and staging that would free the glyph slots the
   * label still needs.
   *
   * @param toAdd - Labels needing new slots.
   * @param toUpdate - Labels whose data changed.
   *
   * @returns Allocations viewing the staging buffer, valid until the next call.
   *
   * @throws {Error} If a label has glyphs but no label-data slot.
   */
  private _stageGlyphs(toAdd: Label[], toUpdate: Label[]) {
    let total = 0;
    for (const label of toAdd) total += label.glyphs.length;
    for (const label of toUpdate) total += label.glyphs.length;

    this._glyphStaging = growStaging(this._glyphStaging, total * GLYPH_FLOATS);
    const buf = this._glyphStaging;

    let at = 0;
    const stage = (labels: Label[]) => {
      const allocs: ItemAllocation[] = [];
      for (const label of labels) {
        const count = label.glyphs.length;
        if (count === 0) continue;

        const labelIdx = this._labelDataBuffer.getFirstTexelIndexOf(label.id);
        if (labelIdx === undefined) {
          throw new Error(`Missing label data for ${label.id}`);
        }

        const floats = count * GLYPH_FLOATS;
        writeGlyphFloats(labelIdx, label.glyphs, buf, at);
        allocs.push({ key: label.id, data: buf.subarray(at, at + floats) });
        at += floats;
      }
      return allocs;
    };

    return { add: stage(toAdd), update: stage(toUpdate) };
  }

  /**
   * Rewrite the draw list to only the glyphs of visible labels. A fully faded
   * out label is skipped; one mid-fade is kept so it can finish fading.
   *
   * @param labels - Every label the manager owns, in any order.
   */
  cull(labels: Iterable<Label>) {
    let pos = 0;
    let hasHalo = false;

    for (const label of labels) {
      if (!label.shouldRender && label.occlusionFade === 1) continue;

      const glyphIndices = this._glyphDataBuffer.getTexelIndicesOf(label.id);
      if (!glyphIndices) continue;

      for (let i = 0; i < glyphIndices.length; i++) {
        this._glyphIndex[pos] = glyphIndices[i];
        this._occlusionFade[pos] = label.occlusionFade;
        pos++;
      }

      if (label.hasHalo()) {
        hasHalo = true;
      }
    }

    this.geom.instanceCount = pos;
    this._glyphIndexAttr.needsUpdate = true;
    this._occlusionFadeAttr.needsUpdate = true;

    this.fillMesh.visible = pos > 0;
    this.haloMesh.visible = hasHalo;
  }

  /** Releases the geometry, both data textures and both materials. */
  dispose() {
    this.geom.dispose();
    this._labelDataBuffer.dispose();
    this._glyphDataBuffer.dispose();
    this.fillMesh.material.dispose();
    this.haloMesh.material.dispose();
  }
}
