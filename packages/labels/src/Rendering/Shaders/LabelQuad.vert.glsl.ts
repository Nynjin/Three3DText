import { LABEL_PLACEMENT } from './LabelCommon.glsl';

/**
 * One instance per label, quad sized to the union of its glyph bitmaps.
 *
 * The quad only decides which pixels may be shaded; the shape comes out of the
 * distance field in Label.frag.
 */
export const LABEL_QUAD_VERT = /* glsl */ `
${LABEL_PLACEMENT}

// Label texel, and the glyph run to walk: head texel and count.
attribute ivec3 labelSpan;
attribute float occlusionFade;

// Fragment position in the label's frame, before the screen-size scale.
out vec2 vLocal;
flat out int vLabelId;
flat out int vGlyphBase;
flat out int vGlyphCount;
flat out float vOcclusionFade;

void main() {
  vLabelId = labelSpan.x;
  vGlyphBase = labelSpan.y;
  vGlyphCount = labelSpan.z;
  vOcclusionFade = occlusionFade;

  vec3 labelPos = labelFetch(vLabelId, 0).xyz;
  vec4 rot = labelFetch(vLabelId, 1);
  vec4 t4 = labelFetch(vLabelId, 4);
  vec4 t5 = labelFetch(vLabelId, 5);

  vLocal = t4.zw + position.xy * t5.zw;

  float sizeScale = getScreenSizeScale(labelPos);
  vec3 local = vec3(vLocal * sizeScale, 0.0);

  gl_Position = placeLocal(local, int(t5.x), int(t5.y), rot, labelPos);
}
`;
