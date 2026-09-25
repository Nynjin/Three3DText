import { TEXEL_FETCH } from './LabelCommon.glsl';

/**
 * Ink and halo for a whole label, in one pass.
 *
 * Both layers come from the same distance: one walk over the label's glyphs
 * gives the nearest ink, the ink is what lies inside the edge and the halo is
 * what lies just outside it.
 */
export const LABEL_FRAG = /* glsl */ `
${TEXEL_FETCH}

uniform sampler2D uAtlas;
uniform int  uAtlasWidth;
uniform float uCutoff;
uniform float uRadius;

in vec2 vLocal;
flat in int vLabelId;
flat in int vGlyphBase;
flat in int vGlyphCount;
flat in float vOcclusionFade;

out vec4 outColor;


// Smallest field gradient the AA ramp may assume, per pixel.
const float MIN_FWIDTH = 0.003;
// Blur floor, in pixels, so haloBlur 0 still has a soft edge.
const float MIN_BLUR_PX = 0.75;
// Field left for the falloff once the solid band is clamped.
const float MIN_FALLOFF = 0.05;

void main() {
  vec4 t2 = labelFetch(vLabelId, 2);
  vec4 t3 = labelFetch(vLabelId, 3);
  vec4 t4 = labelFetch(vLabelId, 4);
  vec3 inkColor = t2.rgb;
  float inkOpacity = t2.a;
  vec3 haloColor = t3.rgb;
  float haloOpacity = t3.a; // already times the label's opacity
  float haloWidth = t4.x;
  float haloBlur = t4.y;

  // The field grows towards ink and every glyph shares one radius, so the
  // nearest ink is just the largest sample.
  float bestSdf = -1.0;
  // Label-local units per atlas pixel, the same for every glyph of a label.
  float localPerAtlasPx = 0.0;

  // The label's glyphs are a linked list. vGlyphCount only bounds the walk, so
  // a broken link cannot hang the shader.
  int gi = vGlyphBase;
  int nextGi = -1;
  for (int i = 0; i < vGlyphCount && gi >= 0; ++i, gi = nextGi) {
    // Read before visiting, so every exit from the body still advances.
    nextGi = int(glyphFetch(gi, 0).y);

    vec4 g1 = glyphFetch(gi, 1);
    vec2 rel = vLocal - g1.xy;
    if (any(greaterThan(abs(rel), g1.zw * 0.5))) continue;

    vec4 g2 = glyphFetch(gi, 2);

    // Bitmap-local, y flipped to the atlas' rows, clamped so the bilinear tap
    // cannot reach the neighbouring cell.
    vec2 texel = g2.xy + vec2(rel.x / g1.z + 0.5, 0.5 - rel.y / g1.w) * g2.zw;
    texel = clamp(texel, g2.xy + 0.5, g2.xy + g2.zw - 0.5);

    bestSdf = max(bestSdf, texture(uAtlas, texel / float(uAtlasWidth)).r);
    localPerAtlasPx = g1.z / g2.z;
  }

  if (localPerAtlasPx == 0.0) discard; // over no bitmap: no field to shade

  // fwidth is undefined in the loop's divergent flow, so take the gradient from
  // the quad's own interpolant. sdf moves 1/uRadius per atlas pixel.
  float localPerPx = 0.5 * (length(dFdx(vLocal)) + length(dFdy(vLocal)));
  // Field change per px, the unit of haloWidth and haloBlur.
  float sdfPerLocal = 1.0 / (uRadius * localPerAtlasPx);
  float fw = max(localPerPx * sdfPerLocal, MIN_FWIDTH);

  // The field stores (1 - cutoff) - distance / radius: ink boundary at edge,
  // running out at sdf 0.
  float edge = 1.0 - uCutoff;
  float fade = 1.0 - vOcclusionFade;

  // Ink: inside the edge.
  float inkAlpha = smoothstep(-0.5, 0.5, (bestSdf - edge) / fw) * inkOpacity * fade;

  // Halo: outside it.
  float haloAlpha = 0.0;
  if (haloOpacity > 0.0 && haloWidth > 0.0) {
    float d = max(edge - bestSdf, 0.0);

    // Clamp the solid band short of the field's limit, or the halo would end on
    // the bitmap's square border; the falloff takes what is left.
    float haloWidthSDF = min(haloWidth * sdfPerLocal, edge - MIN_FALLOFF);
    float haloBlurSDF = min(
      max(haloBlur * sdfPerLocal, fw * MIN_BLUR_PX),
      max(edge - haloWidthSDF, MIN_FALLOFF)
    );

    // Eases out of the solid band and reaches 0 at the end of it, so the fade
    // never has to be cut short.
    float t = min(max(d - haloWidthSDF, 0.0) / haloBlurSDF, 1.0);
    haloAlpha = (1.0 - smoothstep(0.0, 1.0, t)) * haloOpacity * fade;
  }

  // Ink over halo, then the result over the scene. Source-over is associative,
  // so compositing the two here matches drawing them one after the other.
  // Straight alpha out, which is what the blend function expects.
  float behind = haloAlpha * (1.0 - inkAlpha);
  float alpha = inkAlpha + behind;
  if (alpha <= 0.0) discard;

  outColor = vec4((inkColor * inkAlpha + haloColor * behind) / alpha, alpha);
}
`;
