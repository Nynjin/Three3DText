import {
  DataTexture,
  FloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
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
    console.warn(
      `Requested texture width ${w} exceeds max of ${MAX_TEX_SIZE}. This may cause rendering issues on some devices.`,
    );
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
  const w = (texel: number, x: number, y: number, z: number, w: number) =>
    write(data, idx, LABEL_TEXELS, texel, x, y, z, w);

  w(0, label.position.x, label.position.y, label.position.z, label.visible);
  w(1, label.rotation.x, label.rotation.y, label.rotation.z, label.rotation.w);
  w(2, label.color.x, label.color.y, label.color.z, label.opacity);
  w(
    3,
    label.haloColor.x,
    label.haloColor.y,
    label.haloColor.z,
    label.haloOpacity,
  );
  w(4, label.haloWidth / pxPerUnit, label.haloBlur / pxPerUnit, 0, 0);
  w(5, label.rotationAlignment, label.symbolPlacement, 0, 0);
}

function fillGlyphTexelData(
  data: Float32Array,
  glyph: GlyphInstance,
  labelIdx: number,
  glyphIdx: number,
  pxPerUnit: number,
) {
  const w = (texel: number, x: number, y: number, z: number, w: number) =>
    write(data, glyphIdx, GLYPH_TEXELS, texel, x, y, z, w);

  w(0, labelIdx, 0, 0, 0);
  w(
    1,
    glyph.offset.x,
    glyph.offset.y,
    glyph.glyph.w / pxPerUnit,
    glyph.glyph.h / pxPerUnit,
  );
  const [u0, v0, u1, v1] = glyph.glyph.uv;
  w(2, u0, v1, u1, v0);
}

function makeTexture(data: Float32Array, width: number) {
  const tex = new DataTexture(data, width, width, RGBAFormat, FloatType);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
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

  private _glyphFreeSlots: number[] = [];
  private _glyphSlotCount = 0;

  private _labelData: Float32Array = new Float32Array(0);
  private _glyphData: Float32Array = new Float32Array(0);

  private _labelTex: DataTexture = makeTexture(this._labelData, 1);
  private _glyphTex: DataTexture = makeTexture(this._glyphData, 1);

  private _labelTexWidth = 1;
  private _glyphTexWidth = 1;

  private _labelCapacity = 0;
  private _glyphCapacity = 0;
  private _labelCount = 0;
  private _glyphActiveCount = 0;

  private _labelToGlyphs = new Map<number, number[]>();
  private _labelIdToIdx = new Map<string, number>();
  private _labelIdxToId = new Map<number, string>();
  private _glyphSlotToLabelIdx = new Map<number, number>();

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
      this._labelTex,
      this._glyphTex,
      this._labelTexWidth,
      this._glyphTexWidth,
    );
    updateHaloUniforms(
      this.haloMesh.material,
      this._labelTex,
      this._glyphTex,
      this._labelTexWidth,
      this._glyphTexWidth,
    );
  }

  private _resizeLabel(newCount: number) {
    this._labelCapacity = Math.ceil(newCount * CAPACITY_MULTIPLIER);
    const w = texDims(this._labelCapacity * LABEL_TEXELS);
    const next = new Float32Array(w * w * 4);
    next.set(this._labelData);
    this._labelData = next;
    this._labelTexWidth = w;
    this._labelTex.dispose();
    this._labelTex = makeTexture(this._labelData, w);
    this._syncUniforms();
  }

private _resizeGlyph(minSlots: number) {
    this._glyphCapacity = Math.ceil(minSlots * CAPACITY_MULTIPLIER);
    const w = texDims(this._glyphCapacity * GLYPH_TEXELS);
    const next = new Float32Array(w * w * 4);
    next.set(this._glyphData);
    this._glyphData = next;
    this._glyphTexWidth = w;
    this._glyphTex.dispose();
    this._glyphTex = makeTexture(this._glyphData, w);

    const newIndex = new Uint32Array(this._glyphCapacity);
    newIndex.set(this._glyphIndex.subarray(0, this._glyphActiveCount));
    this._glyphIndex = newIndex;
    this._glyphIndexAttr = new InstancedBufferAttribute(this._glyphIndex, 1);
    this.geom.setAttribute("glyphIndex", this._glyphIndexAttr);

    this._syncUniforms();
  }

  /**
   * Append new labels
   */
  addLabels(labels: LabelInstance[]) {
    if (labels.length === 0) return;

    const newGlyphCount = labels.reduce((s, l) => s + l.glyphs.length, 0);
    if (this._labelCount + labels.length > this._labelCapacity)
      this._resizeLabel(this._labelCount + labels.length);
    // fresh slots needed beyond what the free list can supply
    const freshNeeded = Math.max(0, newGlyphCount - this._glyphFreeSlots.length);
    if (this._glyphSlotCount + freshNeeded > this._glyphCapacity)
      this._resizeGlyph(this._glyphSlotCount + freshNeeded);

    let labelIdx = this._labelCount;
    for (const label of labels) {
      if (this._labelIdToIdx.has(label.id)) {
        console.warn(
          `MeshGroup.addLabels - Label ${label.id} already exists in label mesh group`,
        );
        continue;
      }
      this._labelIdToIdx.set(label.id, labelIdx);
      this._labelIdxToId.set(labelIdx, label.id);
      fillLabelTexelData(this._labelData, label, labelIdx, this._pxPerUnit);
      const slots: number[] = [];
      for (const glyph of label.glyphs) {
        const slot = this._glyphFreeSlots.pop() ?? this._glyphSlotCount++;
        fillGlyphTexelData(this._glyphData, glyph, labelIdx, slot, this._pxPerUnit);
        this._glyphSlotToLabelIdx.set(slot, labelIdx);
        slots.push(slot);
      }
      this._labelToGlyphs.set(labelIdx, slots);
      this._glyphActiveCount += slots.length;
      labelIdx++;
    }

    this._labelCount = labelIdx;
    this._rebuildGlyphIndex();
  }

  /**
   * Update existing labels
   * - Same glyph count: label + glyph data overwritten in-place at existing slots
   * - Different glyph count: old slots freed, new slots allocated from free list
   */
  updateLabels(labels: LabelInstance[]) {
    if (labels.length === 0) return;

    let glyphIndexDirty = false;
    for (const label of labels) {
      const labelIdx = this._labelIdToIdx.get(label.id);
      if (labelIdx === undefined) {
        console.warn(
          `MeshGroup.updateLabels - Label ${label.id} not found in label mesh group`,
        );
        continue;
      }
      fillLabelTexelData(this._labelData, label, labelIdx, this._pxPerUnit);
      if (label.glyphs.length === 0) continue;
      const existingSlots = this._labelToGlyphs.get(labelIdx)!;
      if (existingSlots.length === label.glyphs.length) {
        // same count: overwrite in-place at the same permanent slots
        for (let i = 0; i < label.glyphs.length; i++) {
          fillGlyphTexelData(this._glyphData, label.glyphs[i], labelIdx, existingSlots[i], this._pxPerUnit);
        }
      } else {
        // different count: free old slots, allocate new ones
        this._removeGlyphSlots(labelIdx);
        const freshNeeded = Math.max(0, label.glyphs.length - this._glyphFreeSlots.length);
        if (this._glyphSlotCount + freshNeeded > this._glyphCapacity)
          this._resizeGlyph(this._glyphSlotCount + freshNeeded);
        const newSlots: number[] = [];
        for (const glyph of label.glyphs) {
          const slot = this._glyphFreeSlots.pop() ?? this._glyphSlotCount++;
          fillGlyphTexelData(this._glyphData, glyph, labelIdx, slot, this._pxPerUnit);
          this._glyphSlotToLabelIdx.set(slot, labelIdx);
          newSlots.push(slot);
        }
        this._labelToGlyphs.set(labelIdx, newSlots);
        this._glyphActiveCount += newSlots.length;
        glyphIndexDirty = true;
      }
    }

    if (glyphIndexDirty) this._rebuildGlyphIndex();
  }

  private _removeGlyphSlots(labelIdx: number) {
    const slots = this._labelToGlyphs.get(labelIdx) ?? [];
    for (const slot of slots) {
      this._glyphFreeSlots.push(slot);
      this._glyphSlotToLabelIdx.delete(slot);
    }
    this._glyphActiveCount -= slots.length;
    this._labelToGlyphs.set(labelIdx, []);
  }

  private _rebuildGlyphIndex() {
    let pos = 0;
    for (const slots of this._labelToGlyphs.values()) {
      for (const slot of slots) {
        this._glyphIndex[pos++] = slot;
      }
    }
    this._glyphActiveCount = pos;
    this.geom.instanceCount = pos;
    if (this._glyphIndexAttr) this._glyphIndexAttr.needsUpdate = true;
  }

  private _swapDelete(id: string) {
    const labelIdx = this._labelIdToIdx.get(id);
    if (labelIdx === undefined) {
      console.warn(
        `MeshGroup.removeLabels - Label ${id} not found in label mesh group`,
      );
      return;
    }
    this._removeGlyphSlots(labelIdx);
    this._labelToGlyphs.delete(labelIdx);
    this._labelIdToIdx.delete(id);
    this._labelIdxToId.delete(labelIdx);

    const last = this._labelCount - 1;
    if (labelIdx !== last) {
      this._labelData.copyWithin(
        labelIdx * LABEL_TEXELS * 4,
        last * LABEL_TEXELS * 4,
        (last + 1) * LABEL_TEXELS * 4,
      );
      const movedSlots = this._labelToGlyphs.get(last) ?? [];
      this._labelToGlyphs.set(labelIdx, movedSlots);
      this._labelToGlyphs.delete(last);
      // update T0 (label index stored in glyph texture) for moved label's glyphs
      for (const slot of movedSlots) {
        this._glyphData[slot * GLYPH_TEXELS * 4] = labelIdx;
        this._glyphSlotToLabelIdx.set(slot, labelIdx);
      }
      const movedId = this._labelIdxToId.get(last)!;
      this._labelIdToIdx.set(movedId, labelIdx);
      this._labelIdxToId.set(labelIdx, movedId);
      this._labelIdxToId.delete(last);
    }
    this._labelCount--;
    this._rebuildGlyphIndex();
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
      const idx = this._labelIdToIdx.get(id);
      if (idx === undefined) {
        console.warn(
          `MeshGroup.removeLabels - Label ${id} not found in label mesh group`,
        );
        continue;
      }
      deleteIdxs.add(idx);
    }
    if (deleteIdxs.size === 0) return;

    // Free glyph slots for all deleted labels (no texture copyWithin needed)
    for (const labelIdx of deleteIdxs) {
      this._removeGlyphSlots(labelIdx);
      this._labelToGlyphs.delete(labelIdx);
    }

    // Pack label texture, build old→new index map
    const oldToNew = new Map<number, number>();
    let lwp = 0;
    for (let rp = 0; rp < this._labelCount; rp++) {
      if (deleteIdxs.has(rp)) continue;
      if (lwp !== rp)
        this._labelData.copyWithin(
          lwp * LABEL_TEXELS * 4,
          rp * LABEL_TEXELS * 4,
          (rp + 1) * LABEL_TEXELS * 4,
        );
      oldToNew.set(rp, lwp);
      lwp++;
    }
    this._labelCount = lwp;

    // Remap id↔idx; for moved labels update their glyphs' T0 in glyph texture
    this._labelIdxToId.clear();
    for (const [id, oldIdx] of this._labelIdToIdx) {
      if (deleteIdxs.has(oldIdx)) {
        this._labelIdToIdx.delete(id);
        continue;
      }
      const newIdx = oldToNew.get(oldIdx)!;
      this._labelIdToIdx.set(id, newIdx);
      this._labelIdxToId.set(newIdx, id);
      if (newIdx !== oldIdx) {
        const slots = this._labelToGlyphs.get(oldIdx)!;
        this._labelToGlyphs.set(newIdx, slots);
        this._labelToGlyphs.delete(oldIdx);
        for (const slot of slots) {
          this._glyphData[slot * GLYPH_TEXELS * 4] = newIdx;
          this._glyphSlotToLabelIdx.set(slot, newIdx);
        }
      }
    }

    this._rebuildGlyphIndex();
  }

  /**
   * Clear all data and re-add the given labels from scratch
   */
  rebuild(labels: LabelInstance[]) {
    this._labelCount = 0;
    this._glyphActiveCount = 0;
    this._glyphSlotCount = 0;
    this._glyphFreeSlots.length = 0;
    this._labelToGlyphs.clear();
    this._labelIdToIdx.clear();
    this._labelIdxToId.clear();
    this._glyphSlotToLabelIdx.clear();
    this.geom.instanceCount = 0;
    this._resizeLabel(labels.length);
    const totalGlyphs = labels.reduce((s, l) => s + l.glyphs.length, 0);
    this._resizeGlyph(totalGlyphs);
    this.addLabels(labels);
  }

  /**
   * Create or update the fill/halo materials with the given SDF atlas
   */
  syncAtlas(atlas: SDFAtlas) {
    if (!this.fillMesh.material?.uniforms) {
      this.fillMesh.material = createFillMaterial(
        atlas,
        this._labelTex,
        this._glyphTex,
        this._labelTexWidth,
        this._glyphTexWidth,
      );
      this.haloMesh.material = createHaloMaterial(
        atlas,
        this._labelTex,
        this._glyphTex,
        this._labelTexWidth,
        this._glyphTexWidth,
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
    if (toUpdate.length > 0) {
      this.updateLabels(toUpdate);
    }
    if (toRemove.length > 0) {
      this.removeLabels(toRemove);
    }
    if (toAdd.length > 0) {
      this.addLabels(toAdd);
    }

    this._labelTex.needsUpdate = true;
    this._glyphTex.needsUpdate = true;
  }

  /**
   * Rewrite the draw list to only the glyphs of visible labels
   * Sets instanceCount to the visible count GPU skips everything else
   * Call _rebuildGlyphIndex() to restore the full active set after culling ends
   */
  cullByFrustum(visibleIds: Set<string>) {
    let pos = 0;
    let hasHalo = false;
    for (const [id, labelIdx] of this._labelIdToIdx) {
      if (!visibleIds.has(id)) {
        continue;
      }
      if (!hasHalo && this._labelData[(labelIdx * LABEL_TEXELS + 3) * 4 + 3] > 0) {
        hasHalo = true;
      }
      for (const slot of this._labelToGlyphs.get(labelIdx)!) {
        this._glyphIndex[pos++] = slot;
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
    this._labelTex.dispose();
    this._glyphTex.dispose();
    this.fillMesh.material.dispose();
    this.haloMesh.material.dispose();
  }
}
