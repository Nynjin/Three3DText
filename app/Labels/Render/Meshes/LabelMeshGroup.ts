import {
  DataTexture,
  FloatType,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
} from "three";
import { LabelInstance } from "../../Layout/GlyphRun";
import { SDFAtlas } from "../../Font/SDFAtlas";
import { createFillMaterial, updateFillAtlas, updateFillUniforms } from "../Materials/FillMaterial";
import { createHaloMaterial, updateHaloAtlas, updateHaloUniforms } from "../Materials/HaloMaterial";

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

const CAPACITY_MULTIPLIER = 1.25;

const MAX_TEX_SIZE = 4096; // should be safe for most devices

// Compute required texture width for a given number of total texels
function texDims(totalTexels: number): number {
  const w = Math.ceil(Math.sqrt(totalTexels));
  if (w > MAX_TEX_SIZE) {
    console.warn(`Requested texture width ${w} exceeds max of ${MAX_TEX_SIZE}. This may cause rendering issues on some devices.`);
  }
  return w;
}

// ---------- Helper functions ----------

function write(
  data: Float32Array,
  element: number,
  texelsPerElement: number,
  texel: number,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  const idx = (element * texelsPerElement + texel) * 4;
  data[idx + 0] = x;
  data[idx + 1] = y;
  data[idx + 2] = z;
  data[idx + 3] = w;
}

function fillLabelTexelData(
  data: Float32Array,
  label: LabelInstance,
  idx: number,
  pxPerUnit: number,
) {
  const w = (
    texel: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ) => write(data, idx, LABEL_TEXELS, texel, x, y, z, w);

  w(0, label.position.x, label.position.y, label.position.z, label.visible);
  w(1, label.rotation.x, label.rotation.y, label.rotation.z, label.rotation.w);
  w(2, label.color.x, label.color.y, label.color.z, label.opacity);
  w(3, label.haloColor.x, label.haloColor.y, label.haloColor.z, label.haloOpacity);
  w(4, label.haloWidth / pxPerUnit, label.haloBlur / pxPerUnit, 0, 0);
  w(5, label.rotationAlignment, label.symbolPlacement, 0, 0);
}

function fillGlyphTexelData(
  data: Float32Array,
  glyph: LabelInstance["glyphs"][number],
  labelIdx: number,
  glyphIdx: number,
  pxPerUnit: number,
) {
  const w = (
    texel: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ) => write(data, glyphIdx, GLYPH_TEXELS, texel, x, y, z, w);

  w(0, labelIdx, 0, 0, 0);
  w(1, glyph.offset.x, glyph.offset.y, glyph.glyph.w / pxPerUnit, glyph.glyph.h / pxPerUnit);
  const [u0, v0, u1, v1] = glyph.glyph.uv;
  w(2, u0, v1, u1, v0);
}

function makeTexture(data: Float32Array, width: number) {
  const tex = new DataTexture(data, width, width, RGBAFormat, FloatType);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function updateTexture(texture: DataTexture, data: Float32Array) {
  texture.image.data = data;
  texture.needsUpdate = true;
}

// ---------- Geometry Manager Class ----------

export type LabelMesh = Mesh<InstancedBufferGeometry, ShaderMaterial>;

export class LabelMeshGroup {
  readonly geom: InstancedBufferGeometry = new InstancedBufferGeometry();
  readonly fillMesh: LabelMesh = new Mesh(this.geom);
  readonly haloMesh: LabelMesh = new Mesh(this.geom);

  private readonly pxPerUnit: number;

  private labelData: Float32Array = new Float32Array(0);
  private glyphData: Float32Array = new Float32Array(0);

  private labelTex: DataTexture = makeTexture(this.labelData, 1);
  private glyphTex: DataTexture = makeTexture(this.glyphData, 1);

  private labelTexWidth = 1;
  private glyphTexWidth = 1;

  private labelCapacity = 0;
  private glyphCapacity = 0;
  private labelCount = 0;
  private glyphCount = 0;

  private labelToGlyphs = new Map<number, number[]>();
  private labelIdToIdx = new Map<string, number>();
  private labelIdxToId = new Map<number, string>();
  private glyphIdxToLabelIdx = new Map<number, number>();

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

    this.pxPerUnit = pxPerUnit;
  }

  private _syncUniforms() {
    if (!this.fillMesh.material?.uniforms) return;
    updateFillUniforms(this.fillMesh.material, this.labelTex, this.glyphTex, this.labelTexWidth, this.glyphTexWidth);
    updateHaloUniforms(this.haloMesh.material, this.labelTex, this.glyphTex, this.labelTexWidth, this.glyphTexWidth);
  }

  private _resizeLabel(newCount: number) {
    this.labelCapacity = Math.ceil(newCount * CAPACITY_MULTIPLIER);
    const w = texDims(this.labelCapacity * LABEL_TEXELS);
    const next = new Float32Array(w * w * 4);
    next.set(this.labelData);
    this.labelData = next;
    this.labelTexWidth = w;
    this.labelTex.dispose();
    this.labelTex = makeTexture(this.labelData, w);
    this._syncUniforms();
  }

  private _resizeGlyph(newCount: number) {
    this.glyphCapacity = Math.ceil(newCount * CAPACITY_MULTIPLIER);
    const w = texDims(this.glyphCapacity * GLYPH_TEXELS);
    const next = new Float32Array(w * w * 4);
    next.set(this.glyphData);
    this.glyphData = next;
    this.glyphTexWidth = w;
    this.glyphTex.dispose();
    this.glyphTex = makeTexture(this.glyphData, w);
    this._syncUniforms();
  }

  /** 
   * Returns true if a label with the given id exists in the group
   */
  hasLabel(id: string): boolean {
    return this.labelIdToIdx.has(id);
  }    

  /**
   * Append new labels
   */
  addLabels(labels: LabelInstance[]) {
    if (labels.length === 0) return;

    const newGlyphCount = labels.reduce((s, l) => s + l.glyphs.length, 0);
    if (this.labelCount + labels.length > this.labelCapacity) this._resizeLabel(this.labelCount + labels.length);
    if (this.glyphCount + newGlyphCount > this.glyphCapacity) this._resizeGlyph(this.glyphCount + newGlyphCount);

    let labelIdx = this.labelCount;
    let glyphIdx = this.glyphCount;
    for (const label of labels) {
      if (this.labelIdToIdx.has(label.id)) {
        console.warn(`MeshGroup.addLabels - Label ${label.id} already exists in label mesh group`);
        continue;
      }
      this.labelIdToIdx.set(label.id, labelIdx);
      this.labelIdxToId.set(labelIdx, label.id);
      fillLabelTexelData(this.labelData, label, labelIdx, this.pxPerUnit);
      const glyphIndices: number[] = [];
      for (const glyph of label.glyphs) {
        fillGlyphTexelData(this.glyphData, glyph, labelIdx, glyphIdx, this.pxPerUnit);
        glyphIndices.push(glyphIdx);
        this.glyphIdxToLabelIdx.set(glyphIdx, labelIdx);
        glyphIdx++;
      }
      this.labelToGlyphs.set(labelIdx, glyphIndices);
      labelIdx++;
    }

    this.labelCount = labelIdx;
    this.glyphCount = glyphIdx;
    this.geom.instanceCount = this.glyphCount;
  }

  /**
   * Update existing labels
   * - Same glyph count: label + glyph data overwritten in-place
   * - Different glyph count: glyph slots freed then re-appended at the end
   */
  updateLabels(labels: LabelInstance[]) {
    if (labels.length === 0) return;

    const glyphRebuilds: LabelInstance[] = [];
    for (const label of labels) {
      const labelIdx = this.labelIdToIdx.get(label.id);
      if (labelIdx === undefined) {
        console.warn(`MeshGroup.updateLabels - Label ${label.id} not found in label mesh group`);
        continue;
      }
      fillLabelTexelData(this.labelData, label, labelIdx, this.pxPerUnit);
      if (label.glyphs.length === 0) {
        continue;
      }
      const existingGlyphs = this.labelToGlyphs.get(labelIdx)!;
      if (existingGlyphs.length === label.glyphs.length) {
        for (let i = 0; i < label.glyphs.length; i++) {
          fillGlyphTexelData(this.glyphData, label.glyphs[i], labelIdx, existingGlyphs[i], this.pxPerUnit);
        }
      } else {
        this._removeGlyphSlots(labelIdx);
        glyphRebuilds.push(label);
      }
    }

    if (glyphRebuilds.length > 0) {
      const addedGlyphs = glyphRebuilds.reduce((s, l) => s + l.glyphs.length, 0);
      if (this.glyphCount + addedGlyphs > this.glyphCapacity) this._resizeGlyph(this.glyphCount + addedGlyphs);
      let glyphIdx = this.glyphCount;
      for (const label of glyphRebuilds) {
        const labelIdx = this.labelIdToIdx.get(label.id)!;
        const glyphIndices: number[] = [];
        for (const glyph of label.glyphs) {
          fillGlyphTexelData(this.glyphData, glyph, labelIdx, glyphIdx, this.pxPerUnit);
          glyphIndices.push(glyphIdx);
          this.glyphIdxToLabelIdx.set(glyphIdx, labelIdx);
          glyphIdx++;
        }
        this.labelToGlyphs.set(labelIdx, glyphIndices);
      }
      this.glyphCount = glyphIdx;
      this.geom.instanceCount = this.glyphCount;
    }
  }

  private _removeGlyphSlots(labelIdx: number) {
    const glyphIndices = this.labelToGlyphs.get(labelIdx) ?? [];
    for (const glyphIdx of glyphIndices) {
      const last = this.glyphCount - 1;
      if (glyphIdx !== last) {
        this.glyphData.copyWithin(glyphIdx * GLYPH_TEXELS * 4, last * GLYPH_TEXELS * 4, (last + 1) * GLYPH_TEXELS * 4);
        const ownerLabelIdx = this.glyphIdxToLabelIdx.get(last)!;
        const ownerGlyphs   = this.labelToGlyphs.get(ownerLabelIdx)!;
        const pos = ownerGlyphs.indexOf(last);
        if (pos !== -1) ownerGlyphs[pos] = glyphIdx;
        this.glyphIdxToLabelIdx.set(glyphIdx, ownerLabelIdx);
      }
      this.glyphIdxToLabelIdx.delete(last);
      this.glyphCount--;
    }
    this.labelToGlyphs.set(labelIdx, []);
  }

  private _swapDelete(id: string) {
    const labelIdx = this.labelIdToIdx.get(id);
    if (labelIdx === undefined) {
      console.warn(`MeshGroup.removeLabels - Label ${id} not found in label mesh group`);
      return;
    }
    this._removeGlyphSlots(labelIdx);
    this.labelToGlyphs.delete(labelIdx);
    this.labelIdToIdx.delete(id);
    this.labelIdxToId.delete(labelIdx);

    const last = this.labelCount - 1;
    if (labelIdx !== last) {
      this.labelData.copyWithin(labelIdx * LABEL_TEXELS * 4, last * LABEL_TEXELS * 4, (last + 1) * LABEL_TEXELS * 4);
      const movedGlyphs = this.labelToGlyphs.get(last) ?? [];
      this.labelToGlyphs.set(labelIdx, movedGlyphs);
      this.labelToGlyphs.delete(last);
      for (const gi of movedGlyphs) {
        this.glyphData[gi * GLYPH_TEXELS * 4] = labelIdx;
        this.glyphIdxToLabelIdx.set(gi, labelIdx);
      }
      const movedId = this.labelIdxToId.get(last)!;
      this.labelIdToIdx.set(movedId, labelIdx);
      this.labelIdxToId.set(labelIdx, movedId);
      this.labelIdxToId.delete(last);
    }
    this.labelCount--;
    this.geom.instanceCount = this.glyphCount;
  }

  removeLabels(ids: string[]) {
    switch (ids.length) {
      case 0:
        break;
      case 1:
        this._swapDelete(ids[0]);
        break;
      default:
        this._batchRemove(ids);
    }
  }

  private _batchRemove(ids: string[]) {
      const deleteIdxs = new Set<number>();
      for (const id of ids) {
        const idx = this.labelIdToIdx.get(id);
        if (idx === undefined) { console.warn(`MeshGroup.removeLabels - Label ${id} not found in label mesh group`); continue; }
        deleteIdxs.add(idx);
      }
      if (deleteIdxs.size === 0) return;

      // Glyph pass: pack survivors to the front
      const newGlyphOwner: number[] = [];
      let gwp = 0;
      for (let rp = 0; rp < this.glyphCount; rp++) {
        const owner = this.glyphIdxToLabelIdx.get(rp)!;
        if (deleteIdxs.has(owner)) continue;
        if (gwp !== rp) this.glyphData.copyWithin(gwp * GLYPH_TEXELS * 4, rp * GLYPH_TEXELS * 4, (rp + 1) * GLYPH_TEXELS * 4);
        newGlyphOwner[gwp] = owner;
        gwp++;
      }
      this.glyphCount = gwp;

      // Label pass: pack survivors, build old→new map
      const oldToNew = new Map<number, number>();
      let lwp = 0;
      for (let rp = 0; rp < this.labelCount; rp++) {
        if (deleteIdxs.has(rp)) continue;
        if (lwp !== rp) this.labelData.copyWithin(lwp * LABEL_TEXELS * 4, rp * LABEL_TEXELS * 4, (rp + 1) * LABEL_TEXELS * 4);
        oldToNew.set(rp, lwp);
        lwp++;
      }
      this.labelCount = lwp;

      // Remap id↔idx
      this.labelIdxToId.clear();
      for (const [id, oldIdx] of this.labelIdToIdx) {
        if (deleteIdxs.has(oldIdx)) { this.labelIdToIdx.delete(id); continue; }
        const newIdx = oldToNew.get(oldIdx)!;
        this.labelIdToIdx.set(id, newIdx);
        this.labelIdxToId.set(newIdx, id);
      }

      // Rebuild glyph maps, rewrite T0 where label index shifted
      this.labelToGlyphs.clear();
      this.glyphIdxToLabelIdx.clear();
      for (let gi = 0; gi < this.glyphCount; gi++) {
        const oldOwner = newGlyphOwner[gi];
        const newOwner = oldToNew.get(oldOwner)!;
        this.glyphIdxToLabelIdx.set(gi, newOwner);
        let arr = this.labelToGlyphs.get(newOwner);
        if (!arr) { arr = []; this.labelToGlyphs.set(newOwner, arr); }
        arr.push(gi);
        if (newOwner !== oldOwner) this.glyphData[gi * GLYPH_TEXELS * 4] = newOwner;
      }
      this.geom.instanceCount = this.glyphCount;
  }

  /** 
   * Clear all data and re-add the given labels from scratch 
   */
  rebuild(labels: LabelInstance[]) {
    this.labelCount = 0;
    this.glyphCount = 0;
    this.labelToGlyphs.clear();
    this.labelIdToIdx.clear();
    this.labelIdxToId.clear();
    this.glyphIdxToLabelIdx.clear();
    this.geom.instanceCount = 0;
    this.addLabels(labels);
  }

  /** 
   * Create or update the fill/halo materials with the given SDF atlas 
   */
  syncAtlas(atlas: SDFAtlas) {
    if (!this.fillMesh.material?.uniforms) {
      this.fillMesh.material = createFillMaterial(atlas, this.labelTex, this.glyphTex, this.labelTexWidth, this.glyphTexWidth);
      this.haloMesh.material = createHaloMaterial(atlas, this.labelTex, this.glyphTex, this.labelTexWidth, this.glyphTexWidth);
    } else {
      updateFillAtlas(this.fillMesh.material, atlas);
      updateHaloAtlas(this.haloMesh.material, atlas);
      this._syncUniforms();
    }
  }

  update(toAdd: LabelInstance[], toRemove: string[], toUpdate: LabelInstance[]) {
    if (toUpdate.length > 0) {
      this.updateLabels(toUpdate);
    }
    if (toRemove.length > 0) {
      this.removeLabels(toRemove);
    }
    if (toAdd.length > 0) {
      this.addLabels(toAdd);
    }

    updateTexture(this.labelTex, this.labelData);
    updateTexture(this.glyphTex, this.glyphData);
  }

  /** 
   * Release all resources (geometry, textures, materials)
   */
  dispose() {
    this.geom.dispose();
    this.labelTex.dispose();
    this.glyphTex.dispose();
    this.fillMesh.material.dispose();
    this.haloMesh.material.dispose();
  }
}