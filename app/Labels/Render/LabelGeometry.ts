import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  PlaneGeometry,
} from "three";
import { LabelInstance } from "../Layout/GlyphRun";

export function buildLabelGeometry(
  labels: LabelInstance[],
  pxPerUnit: number = 48
): InstancedBufferGeometry {
  const count = labels.reduce((acc, label) => acc + label.glyphs.length, 0) || 1;

  const base = new PlaneGeometry(1, 1);
  const geom = new InstancedBufferGeometry();

  geom.index = base.index;
  geom.attributes.position = base.attributes.position;
  geom.attributes.uv = base.attributes.uv;

  const color = new Float32Array(count * 4);
  const haloColor = new Float32Array(count * 4);
  const opacity = new Float32Array(count);
  const haloOpacity = new Float32Array(count);
  const haloWidth = new Float32Array(count);
  const haloBlur = new Float32Array(count);
  const labelPos = new Float32Array(count * 3);
  const charOffset = new Float32Array(count * 2);
  const size = new Float32Array(count * 2);
  const uvRect = new Float32Array(count * 4);
  const glyphQuat = new Float32Array(count * 4);
  const rotationAlignment = new Float32Array(count);
  const symbolPlacement = new Float32Array(count);

  let i = 0;
  for (const label of labels) {
    for (const g of label.glyphs) {
      labelPos.set([label.position.x, label.position.y, label.position.z], i * 3);
      charOffset.set([g.offset.x, g.offset.y], i * 2);
      size.set([g.glyph.w / pxPerUnit, g.glyph.h / pxPerUnit], i * 2);
      const [u0, v0, u1, v1] = g.glyph.uv;
      uvRect.set([u0, v1, u1, v0], i * 4);
      glyphQuat.set(
        [label.rotation.x, label.rotation.y, label.rotation.z, label.rotation.w],
        i * 4
      );
      color.set([label.color.x, label.color.y, label.color.z, 1], i * 4);
      haloColor.set([label.haloColor.x, label.haloColor.y, label.haloColor.z, 1], i * 4);

      opacity[i] = label.opacity;
      haloOpacity[i] = label.haloOpacity;
      haloWidth[i] = label.haloWidth;
      haloBlur[i] = label.haloBlur;
      rotationAlignment[i] = label.rotationAlignment;
      symbolPlacement[i] = label.symbolPlacement;
      i++;    
    }
  }
  
  geom.setAttribute("aLabelPos", new InstancedBufferAttribute(labelPos, 3));
  geom.setAttribute("aCharOffset", new InstancedBufferAttribute(charOffset, 2));
  geom.setAttribute("aSize", new InstancedBufferAttribute(size, 2));
  geom.setAttribute("aUvRect", new InstancedBufferAttribute(uvRect, 4));
  geom.setAttribute("aGlyphQuat", new InstancedBufferAttribute(glyphQuat, 4));
  geom.setAttribute(
    "aRotationAlignment",
    new InstancedBufferAttribute(rotationAlignment, 1)
  );
  geom.setAttribute("aSymbolPlacement", new InstancedBufferAttribute(symbolPlacement, 1));
  geom.setAttribute("aColor", new InstancedBufferAttribute(color, 4));
  geom.setAttribute("aHaloColor", new InstancedBufferAttribute(haloColor, 4));
  geom.setAttribute("aOpacity", new InstancedBufferAttribute(opacity, 1));
  geom.setAttribute(
    "aHaloOpacity",
    new InstancedBufferAttribute(haloOpacity, 1)
  );
  geom.setAttribute("aHaloWidth", new InstancedBufferAttribute(haloWidth, 1));
  geom.setAttribute("aHaloBlur", new InstancedBufferAttribute(haloBlur, 1));

  geom.instanceCount = count;

  return geom;
}