import {
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
 * T2: uv rect (u0, v1, u1, v0)
 */
export const GLYPH_TEXELS = 3;

// ---------- Helper functions ----------

function makeLabelTexels(label: LabelInstance, pxPerUnit: number): Texel[] {
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
      x: label.haloWidth / pxPerUnit,
      y: label.haloBlur / pxPerUnit,
      z: 0,
      w: 0,
    },
    { x: label.rotationAlignment, y: label.symbolPlacement, z: 0, w: 0 },
  ];
}

function makeGlyphTexels(labelIdx: number, glyphs: GlyphInstance[], pxPerUnit: number) {
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
      z: glyph.glyph.w / pxPerUnit,
      w: glyph.glyph.h / pxPerUnit,
    },
    {
      x: glyph.glyph.uv[0],
      y: glyph.glyph.uv[3],
      z: glyph.glyph.uv[2],
      w: glyph.glyph.uv[1],
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
        flatData: makeLabelTexels(l, this._pxPerUnit),
      })),
    );
    this._glyphDataBuffer.addToKeys(
      labels
        .filter(l => l.glyphs.length > 0)
        .map(l => ({
          key: l.id,
          flatData: makeGlyphTexels(this._labelDataBuffer.getFirstIdxOf(l.id)!, l.glyphs, this._pxPerUnit),
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
        flatData: makeLabelTexels(l, this._pxPerUnit),
      })),
    );
    this._glyphDataBuffer.updateKeys(
      labels.map(l => ({
        key: l.id,
        flatData: makeGlyphTexels(this._labelDataBuffer.getFirstIdxOf(l.id)!, l.glyphs, this._pxPerUnit),
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
        flatData: makeLabelTexels(l, this._pxPerUnit),
      })),
      toRemove,
      toUpdate.map(l => ({
        key: l.id,
        flatData: makeLabelTexels(l, this._pxPerUnit),
      })),
    );
    this._glyphDataBuffer.update(
      toAdd
        .filter(l => l.glyphs.length > 0)
        .map(l => ({
          key: l.id,
          flatData: makeGlyphTexels(this._labelDataBuffer.getFirstIdxOf(l.id)!, l.glyphs, this._pxPerUnit),
        })),
      toRemove,
      toUpdate.map(l => ({
        key: l.id,
        flatData: makeGlyphTexels(this._labelDataBuffer.getFirstIdxOf(l.id)!, l.glyphs, this._pxPerUnit),
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
   * Rewrite the draw list to only the glyphs of visible labels
   * Sets instanceCount to the visible count GPU skips everything else
   * Call _rebuildGlyphIndex() to restore the full active set after culling ends
   */
  cullByFrustum(visibleIds: Set<string>) {
    let pos = 0;
    let hasHalo = false;

    for (const id of this._labelDataBuffer.getKeys()) {
      if (!visibleIds.has(id)) {
        continue;
      }

      const item = this._labelDataBuffer.getFirstItemOf(id);
      if (!item) continue;

      if (item.data[0].w <= 0) {
        continue;
      }

      for (const slot of this._glyphDataBuffer.getIdxOf(id) || []) {
        this._glyphIndex[pos++] = slot;
      }

      if (hasHalo) {
        continue;
      }

      if (item.data[3].w > 0 && item.data[4].x > 0) {
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
