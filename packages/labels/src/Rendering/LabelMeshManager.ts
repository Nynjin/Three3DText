import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  type ShaderMaterial,
  Vector2,
  type WebGLRenderer,
} from 'three';
import type { SDFAtlas } from '../Shaping/SDFAtlas';
import {
  createLabelMaterial,
  updateLabelUniforms,
} from './Materials/LabelMaterial';
import type { GlyphInstance } from '../Shaping/GlyphRun';
import type { Label } from '../Label';
import { InstancedDataTexture, type ItemAllocation } from './Textures/InstancedDataTexture';
import type { LabelManagerConfig } from '../Types/LabelConfig';
import { GLYPH_NEXT_FLOAT, GLYPH_TEXELS, LABEL_TEXELS } from './TexelLayout';

// ---------- Helper functions ----------

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

/**
 * Writes a label's glyphs as flat floats, {@link GLYPH_FLOATS} each.
 *
 * @param labelIdx - Texel index of the owning label.
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
    // Next glyph of this label. The data texture rewrites it as it hands out
    // slots, since which slot a glyph lands in is not known until then.
    out[o + 1] = -1;
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
 * preserved: every caller rewrites what it reads.
 */
function growStaging(buf: Float32Array<ArrayBuffer>, floats: number): Float32Array<ArrayBuffer> {
  if (buf.length >= floats) return buf;
  return new Float32Array(Math.max(floats, buf.length * 2));
}

// ---------- Mesh Manager Class ----------

export type LabelMesh = Mesh<InstancedBufferGeometry, ShaderMaterial>;

/**
 * Owns the mesh every label draws through, and the data textures behind it.
 *
 * One instance per label, ink and halo in the same pass: both follow from the
 * distance to the label's nearest ink, so the fragment shader gets them out of
 * one walk over the label's glyphs.
 *
 * Label and glyph attributes live in {@link InstancedDataTexture}s keyed by
 * label id, so {@link LabelMeshManager.update} rewrites only the labels that
 * changed. The draw list is a separate pass: {@link LabelMeshManager.cull}
 * rebuilds it every frame visibility moves.
 *
 * The mesh's own transform is ignored: label positions are world coordinates.
 */
export class LabelMeshManager {
  readonly geom: InstancedBufferGeometry = new InstancedBufferGeometry();
  readonly mesh: LabelMesh = new Mesh(this.geom);

  /** `labelTexelIndex, glyphRunHead, glyphCount` per drawn label. */
  private _labelSpan: Int32Array = new Int32Array(INITIAL_INSTANCES * 3);
  private _labelFade: Float32Array = new Float32Array(INITIAL_INSTANCES);
  private _labelSpanAttr: InstancedBufferAttribute = new InstancedBufferAttribute(this._labelSpan, 3);
  private _labelFadeAttr: InstancedBufferAttribute = new InstancedBufferAttribute(this._labelFade, 1);

  private _labelDataBuffer = new InstancedDataTexture(LABEL_TEXELS);
  // T0.y holds the link to the label's next glyph, which the shader walks.
  private _glyphDataBuffer = new InstancedDataTexture(GLYPH_TEXELS, GLYPH_NEXT_FLOAT);

  /** Staging buffers for one `update` call, reused across calls and never shrunk. */
  private _labelStaging = new Float32Array(0);
  private _glyphStaging = new Float32Array(0);

  private readonly _config: LabelManagerConfig;

  /** Canvas size in CSS px, refreshed before every draw. */
  private readonly _viewport = new Vector2(1, 1);

  /**
   * @param config - Shared label-manager settings, held by reference so later
   * edits take effect on the next cull.
   */
  constructor(config: LabelManagerConfig) {
    this._config = config;

    const base = new PlaneGeometry(1, 1);
    this.geom.index = base.index;
    this.geom.attributes.position = base.attributes.position;
    this.geom.attributes.uv = base.attributes.uv;
    base.dispose();

    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = (renderer: WebGLRenderer) => {
      renderer.getSize(this._viewport);
    };

    this.geom.setAttribute('labelSpan', this._labelSpanAttr);
    this.geom.setAttribute('occlusionFade', this._labelFadeAttr);
  }

  /**
   * Regrows the instance lists to hold `min` labels, keeping the `written`
   * already staged by this cull.
   *
   * three refuses to resize a live attribute, so the attribute objects are
   * replaced. Disposing the geometry frees the buffers they had and drops the
   * bound state that named them; the next render rebuilds both.
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

  /** Repoints the material at the current data textures, keeping the atlas. */
  private _syncUniforms() {
    updateLabelUniforms(
      this.mesh.material,
      this._labelDataBuffer.texture,
      this._glyphDataBuffer.texture,
    );
    this.mesh.material.uniformsNeedUpdate = true;
  }

  /**
   * Rebuild the material against an SDF atlas. Needed when the atlas texture
   * itself changed, not just its contents.
   *
   * @param atlas - Atlas the shader samples from.
   */
  syncAtlas(atlas: SDFAtlas) {
    this.mesh.material.dispose();
    this.mesh.material = createLabelMaterial(
      atlas,
      this._labelDataBuffer.texture,
      this._glyphDataBuffer.texture,
      this._viewport,
    );
    this.mesh.material.uniformsNeedUpdate = true;
  }

  /**
   * Write pending label work to the data textures. Does not touch the draw
   * list; call {@link LabelMeshManager.cull} for that.
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
   * Labels with no glyphs are skipped. A style-only update carries
   * `glyphs: []`, and staging that frees glyph slots the label still needs.
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
   * Rewrite the draw list: one instance per visible label, carrying its glyph
   * run and its eased fade. A fully faded out label is skipped; one mid-fade is
   * kept so it can finish fading.
   *
   * @param labels - Every label the manager owns, in any order.
   */
  cull(labels: Iterable<Label>) {
    let pos = 0;
    const gamma = this._config.fadeGamma;

    for (const label of labels) {
      if (!label.shouldRender && label.occlusionFade === 1) continue;

      const glyphIndices = this._glyphDataBuffer.getTexelIndicesOf(label.id);
      if (!glyphIndices || glyphIndices.length === 0) continue;

      const labelIdx = this._labelDataBuffer.getFirstTexelIndexOf(label.id);
      if (labelIdx === undefined) continue;

      // Shaped once per label, not per glyph: every glyph shares the value.
      const fade = gamma === 1
        ? label.occlusionFade
        : 1 - (1 - label.occlusionFade) ** gamma;

      if (pos === this._labelFade.length) this._grow(pos + 1, pos);

      // The shader walks the glyph run from its head; the count only bounds
      // the walk, so a broken link cannot hang it.
      const s = pos * 3;
      this._labelSpan[s] = labelIdx;
      this._labelSpan[s + 1] = glyphIndices[0];
      this._labelSpan[s + 2] = glyphIndices.length;
      this._labelFade[pos] = fade;
      pos++;
    }

    // Upload only the slice actually drawn: the lists keep the high-water mark
    // of every cull so far.
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
    this._labelDataBuffer.dispose();
    this._glyphDataBuffer.dispose();
    this.mesh.material.dispose();
  }
}
