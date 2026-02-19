import {
  CompressedArrayTexture,
  DataTexture,
  FloatType,
  InstancedBufferGeometry,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
} from "three";
import { LabelInstance } from "../../Layout/GlyphRun";

/**
 * T0: label position (x, y, z)
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
 * T2: uv rect (u0, v0, u1, v1)
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
  layer: number,
  texelsPerLayer: number,
  texel: number,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  const idx = (layer * texelsPerLayer + texel) * 4;
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

  w(0, label.position.x, label.position.y, label.position.z, 1);
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

export class LabelGeometryManager {
  geom: InstancedBufferGeometry = new InstancedBufferGeometry();
  
  labelData: Float32Array = new Float32Array(0);
  glyphData: Float32Array = new Float32Array(0);

  labelTex: DataTexture = makeTexture(this.labelData, 1);
  glyphTex: DataTexture = makeTexture(this.glyphData, 1);

  // Exposed for shader uniforms
  labelTexWidth: number = 1;
  glyphTexWidth: number = 1;

  private labelCapacity: number = 0;
  private glyphCapacity: number = 0;
  private labelCount: number = 0;
  private glyphCount: number = 0;

  private labelToGlyphs: Map<number, number[]> = new Map();

  constructor() {
    const base = new PlaneGeometry(1, 1);
    this.geom.index = base.index;
    this.geom.attributes.position = base.attributes.position;
    this.geom.attributes.uv = base.attributes.uv;
  }

  private resizeLabel(newCount: number) {
    this.labelCapacity = Math.ceil(newCount * CAPACITY_MULTIPLIER);
    const w = texDims(this.labelCapacity * LABEL_TEXELS);
    const next = new Float32Array(w * w * 4);
    next.set(this.labelData);
    this.labelData = next;
    this.labelTexWidth = w;
    this.labelTex.dispose();
    this.labelTex = makeTexture(this.labelData, w);
  }

  private resizeGlyph(newCount: number) {
    this.glyphCapacity = Math.ceil(newCount * CAPACITY_MULTIPLIER);
    const w = texDims(this.glyphCapacity * GLYPH_TEXELS);
    const next = new Float32Array(w * w * 4);
    next.set(this.glyphData);
    this.glyphData = next;
    this.glyphTexWidth = w;
    this.glyphTex.dispose();
    this.glyphTex = makeTexture(this.glyphData, w);
  }


  addLabels(labels: LabelInstance[], pxPerUnit: number) {
    const newLabelCount = this.labelCount + labels.length;
    const newGlyphCount = this.glyphCount + labels.reduce((acc, l) => acc + l.glyphs.length, 0);

    if (newLabelCount > this.labelCapacity) {
      this.resizeLabel(newLabelCount);
    }

    if (newGlyphCount > this.glyphCapacity) {
      this.resizeGlyph(newGlyphCount);
    }

    let labelIdx = this.labelCount;
    let glyphIdx = this.glyphCount;
    for (const label of labels) {

      fillLabelTexelData(this.labelData, label, labelIdx, pxPerUnit);
      const glyphIndices: number[] = [];
      for (const glyph of label.glyphs) {
        fillGlyphTexelData(this.glyphData, glyph, labelIdx, glyphIdx, pxPerUnit);
        glyphIndices.push(glyphIdx);
        glyphIdx++;
      }
      this.labelToGlyphs.set(labelIdx, glyphIndices);
      labelIdx++;
    }

    this.labelCount = labelIdx;
    this.glyphCount = glyphIdx;

    this.geom.instanceCount = this.glyphCount;
    updateTexture(this.labelTex, this.labelData);
    updateTexture(this.glyphTex, this.glyphData);
  }
}
