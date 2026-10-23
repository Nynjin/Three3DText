import { LABEL_PLACEMENT } from './LabelCommon.glsl';

/**
 * One instance per label, quad sized to the union of its glyph bitmaps. The
 * quad bounds the shaded pixels; the fragment stage cuts the glyphs out of the field.
 */
export const LABEL_QUAD_VERT = /* glsl */ `
${LABEL_PLACEMENT}
#include <common>
#include <logdepthbuf_pars_vertex>

// Label texel, and the glyph run to walk: head texel and count.
attribute ivec3 labelSpan;
// Eased occlusion: 0 drawn, 1 hidden.
attribute float occlusionFade;

// Fragment position in the label's frame, in CSS px.
out vec2 vLocal;
flat out int vLabelTexel;
flat out int vGlyphBase;
flat out int vGlyphCount;
flat out float vOcclusionFade;

void main() {
  vLabelTexel = labelSpan.x;
  vGlyphBase = labelSpan.y;
  vGlyphCount = labelSpan.z;
  vOcclusionFade = occlusionFade;

  vec3 centerVS = anchorViewPos(labelFetch(vLabelTexel, 0).xyz, labelFetch(vLabelTexel, 6).xyz);
  vec4 rot = labelFetch(vLabelTexel, 1);
  vec4 t4 = labelFetch(vLabelTexel, 4);
  vec4 t5 = labelFetch(vLabelTexel, 5);

  vLocal = t4.zw + position.xy * t5.zw;
  gl_Position = placeLocal(vLocal, int(t5.x), int(t5.y), rot, centerVS);

  #include <logdepthbuf_vertex>
}
`;
