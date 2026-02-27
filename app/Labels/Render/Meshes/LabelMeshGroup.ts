import {
  Frustum,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from "three";
import { SDFAtlas } from "../../Font/SDFAtlas";
import {
  createFillMaterial,
  updateFillAtlas,
  updateFillUniforms,
} from "../Materials/FillMaterial";
import {
  createHaloMaterial,
  updateHaloAtlas,
  updateHaloUniforms,
} from "../Materials/HaloMaterial";
import { GlyphInstance, LabelInstance } from "../../Layout/GlyphRun";
import { Label } from "../../Core/Label";
import { InstancedDataTexture, Texel } from "../Textures/InstancedDataTexture";

/**
 * T0: label position + opacity (x, y, z, visible)
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

function makeLabelTexels(label: LabelInstance): Texel[] {
  return [
    {
      x: label.position.x,
      y: label.position.y,
      z: label.position.z,
      w: label.visible,
    },
    {
      x: label.rotation.x,
      y: label.rotation.y,
      z: label.rotation.z,
      w: label.rotation.w,
    },
    { x: label.color.x, y: label.color.y, z: label.color.z, w: label.opacity },
    {
      x: label.haloColor.x,
      y: label.haloColor.y,
      z: label.haloColor.z,
      w: label.haloOpacity,
    },
    {
      x: label.haloWidth,
      y: label.haloBlur,
      z: 0,
      w: 0,
    },
    { x: label.rotationAlignment, y: label.symbolPlacement, z: 0, w: 0 },
  ];
}

function makeGlyphTexels(labelIdx: number, glyphs: GlyphInstance[]) {
  const texels: Texel[] = [];
  for (const glyph of glyphs) {
    texels.push({
      x: labelIdx,
      y: 0,
      z: 0,
      w: 0,
    },
    {
      x: glyph.offset.x,
      y: glyph.offset.y,
      z: glyph.glyph.w,
      w: glyph.glyph.h,
    },
    {
      x: glyph.glyph.px,
      y: glyph.glyph.py,
      z: glyph.glyph.pw,
      w: glyph.glyph.ph,
    },);
  }
  return texels;
}

// ---------- Geometry Manager Class ----------

export type LabelMesh = Mesh<InstancedBufferGeometry, ShaderMaterial>;

export class LabelMeshGroup {
  readonly geom: InstancedBufferGeometry = new InstancedBufferGeometry();
  readonly fillMesh: LabelMesh = new Mesh(this.geom);
  readonly haloMesh: LabelMesh = new Mesh(this.geom);

  private readonly _pxPerUnit: number;

  private _glyphIndex: Uint32Array = new Uint32Array(0);
  private _glyphIndexAttr: InstancedBufferAttribute | null = null;

  private _labelDataBuffer = new InstancedDataTexture(LABEL_TEXELS);
  private _glyphDataBuffer = new InstancedDataTexture(GLYPH_TEXELS);

  constructor(pxPerUnit: number) {
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

    this._pxPerUnit = pxPerUnit;
  }

  private _syncUniforms() {
    if (!this.fillMesh.material?.uniforms) return;
    updateFillUniforms(
      this.fillMesh.material,
      this._labelDataBuffer.texture,
      this._glyphDataBuffer.texture,
      this._labelDataBuffer.width,
      this._glyphDataBuffer.width,
    );
    updateHaloUniforms(
      this.haloMesh.material,
      this._labelDataBuffer.texture,
      this._glyphDataBuffer.texture,
      this._labelDataBuffer.width,
      this._glyphDataBuffer.width,
    );
  }

  /**
   * Append new labels
   */
  addLabels(labels: LabelInstance[]) {
    if (labels.length === 0) return;
    this._labelDataBuffer.addToKeys(
      labels.map(l => ({
        key: l.id,
        flatData: makeLabelTexels(l),
      })),
    );
    this._glyphDataBuffer.addToKeys(
      labels
        .filter(l => l.glyphs.length > 0)
        .map(l => ({
          key: l.id,
          flatData: makeGlyphTexels(this._labelDataBuffer.getFirstIdxOf(l.id)!, l.glyphs),
        })),
    );
  }

  /**
   * Update existing labels
   * - Same glyph count: label + glyph data overwritten in-place at existing slots
   * - Different glyph count: old slots freed, new slots allocated from free list
   */
  updateLabels(labels: LabelInstance[]) {
    if (labels.length === 0) return;

    this._labelDataBuffer.updateKeys(
      labels.map(l => ({
        key: l.id,
        flatData: makeLabelTexels(l),
      })),
    );
    this._glyphDataBuffer.updateKeys(
      labels.map(l => ({
        key: l.id,
        flatData: makeGlyphTexels(this._labelDataBuffer.getFirstIdxOf(l.id)!, l.glyphs),
      })),
    );
  }

  removeLabels(ids: string[]) {
    if (ids.length === 0) return;
    this._labelDataBuffer.removeKeys(ids);
    this._glyphDataBuffer.removeKeys(ids);
  }

  /**
   * Create or update the fill/halo materials with the given SDF atlas
   */
  syncAtlas(atlas: SDFAtlas) {
    if (!this.fillMesh.material?.uniforms) {
      this.fillMesh.material = createFillMaterial(
        atlas,
        this._labelDataBuffer.texture,
        this._glyphDataBuffer.texture,
        this._labelDataBuffer.width,
        this._glyphDataBuffer.width,
      );
      this.haloMesh.material = createHaloMaterial(
        atlas,
        this._labelDataBuffer.texture,
        this._glyphDataBuffer.texture,
        this._labelDataBuffer.width,
        this._glyphDataBuffer.width,
      );
    } else {
      updateFillAtlas(this.fillMesh.material, atlas);
      updateHaloAtlas(this.haloMesh.material, atlas);
      this._syncUniforms();
    }
  }

  update(
    toAdd: LabelInstance[],
    toRemove: string[],
    toUpdate: LabelInstance[],
  ) {
    this._labelDataBuffer.update(
      toAdd.map(l => ({
        key: l.id,
        flatData: makeLabelTexels(l),
      })),
      toRemove,
      toUpdate.map(l => ({
        key: l.id,
        flatData: makeLabelTexels(l),
      })),
    );
    this._glyphDataBuffer.update(
      toAdd
        .filter(l => l.glyphs.length > 0)
        .map(l => ({
          key: l.id,
          flatData: makeGlyphTexels(this._labelDataBuffer.getFirstIdxOf(l.id)!, l.glyphs),
        })),
      toRemove,
      // style-only updates have glyphs: [] — skip to avoid freeing existing glyph slots
      toUpdate
        .filter(l => l.glyphs.length > 0)
        .map(l => ({
          key: l.id,
          flatData: makeGlyphTexels(this._labelDataBuffer.getFirstIdxOf(l.id)!, l.glyphs),
        })),
    );

    this._syncUniforms();

    const totalGlyphs = this._glyphDataBuffer.usedSlots;
    if (!this._glyphIndexAttr || this._glyphIndex.length < totalGlyphs) {
      this._glyphIndex = new Uint32Array(totalGlyphs * 1.5);
      this._glyphIndexAttr = new InstancedBufferAttribute(this._glyphIndex, 1);
      this.geom.setAttribute("glyphIndex", this._glyphIndexAttr);
    }

    let count = 0;
    for (const idx of this._glyphDataBuffer.getAllIdx()) {
      this._glyphIndex[count++] = idx;
    }

    this.geom.instanceCount = count;
    if (this._glyphIndexAttr) this._glyphIndexAttr.needsUpdate = true;
  }

  /**
   * Rewrite the draw list to only the glyphs of visible labels.
   */
  cullByFrustum(labels: Iterable<Label>, frustum: Frustum) {
    let pos = 0;
    let hasHalo = false;

    for (const label of labels) {
      if (!frustum.containsPoint(label.position)) continue;

      if (!label.visible) {
        continue;
      }

      const glyphIndices = this._glyphDataBuffer.getIdxOf(label.id);
      if (!glyphIndices) {
        continue;
      }

      for (let i = 0; i < glyphIndices.length; i++) {
        this._glyphIndex[pos++] = glyphIndices[i];
      }

      if (label.hasHalo()) {
        hasHalo = true;
      }
    }
    
    this.geom.instanceCount = pos;
    if (this._glyphIndexAttr) {
      this._glyphIndexAttr.needsUpdate = true;
    }
    this.fillMesh.visible = pos > 0;
    this.haloMesh.visible = hasHalo;
  }

  /**
   * Release all resources (geometry, textures, materials)
   */
  dispose() {
    this.geom.dispose();
    this._labelDataBuffer.dispose();
    this._glyphDataBuffer.dispose();
    this.fillMesh.material.dispose();
    this.haloMesh.material.dispose();
  }
}
