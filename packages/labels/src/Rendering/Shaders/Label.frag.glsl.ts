import { TEXEL_FETCH } from './LabelCommon.glsl';

/**
 * Ink and halo for a whole label, in one pass. One walk over the label's glyphs
 * gives the nearest ink: the ink is what lies inside the field's edge, the halo
 * what lies just outside it.
 */
export const LABEL_FRAG = /* glsl */ `
${TEXEL_FETCH}

uniform sampler2D uAtlas;
uniform float uCutoff;
uniform float uRadius;

in vec2 vLocal;
flat in int vLabelTexel;
flat in int vGlyphBase;
flat in int vGlyphCount;
flat in float vOcclusionFade;

out vec4 outColor;

// Smallest field gradient the AA ramp may assume, per screen pixel. It binds
// only past 1 / (MIN_FWIDTH * uRadius) screen pixels per atlas texel, where the
// edge ramp then widens past a pixel.
const float MIN_FWIDTH = 0.003;
// Blur floor, in screen pixels, so haloBlur 0 still has a soft edge.
const float MIN_BLUR_PX = 0.75;
// Field left for the falloff once the solid band is clamped.
const float MIN_FALLOFF = 0.05;

void main() {
  // CSS px per screen pixel. Derivatives are undefined in divergent flow, so
  // they are taken here, before the loop and any discard.
  float localPerPx = 0.5 * (length(dFdx(vLocal)) + length(dFdy(vLocal)));

  vec4 t2 = labelFetch(vLabelTexel, 2);
  vec4 t3 = labelFetch(vLabelTexel, 3);
  vec4 t4 = labelFetch(vLabelTexel, 4);
  vec3 inkColor = t2.rgb;
  float inkOpacity = t2.a;
  vec3 haloColor = t3.rgb;
  float haloOpacity = t3.a;
  float haloWidth = t4.x;
  float haloBlur = t4.y;

  // The field grows towards ink and every glyph shares one radius, so the
  // nearest ink is the largest sample.
  float bestSdf = -1.0;
  // CSS px per atlas texel, the same for every glyph of a label.
  float localPerAtlasPx = 0.0;

  // The label's glyphs are a linked list. vGlyphCount only bounds the walk, so
  // a broken link cannot hang the shader.
  int gi = vGlyphBase;
  int nextGi = -1;
  for (int i = 0; i < vGlyphCount && gi >= 0; ++i, gi = nextGi) {
    // Read before visiting, so every exit from the body still advances.
    nextGi = int(glyphFetch(gi, 0).x);

    vec4 g1 = glyphFetch(gi, 1);
    vec2 rel = vLocal - g1.xy;
    if (any(greaterThan(abs(rel), g1.zw * 0.5))) continue;

    // Bitmap-local, y flipped to the atlas' rows, clamped so the bilinear tap
    // cannot reach the neighbouring cell.
    vec4 g2 = glyphFetch(gi, 2);
    vec2 texel = g2.xy + vec2(rel.x / g1.z + 0.5, 0.5 - rel.y / g1.w) * g2.zw;
    texel = clamp(texel, g2.xy + 0.5, g2.xy + g2.zw - 0.5);

    bestSdf = max(bestSdf, texture(uAtlas, texel / vec2(textureSize(uAtlas, 0))).r);
    localPerAtlasPx = g1.z / g2.z;
  }

  if (localPerAtlasPx == 0.0) discard; // over no bitmap: no field to shade

  // The field stores (1 - cutoff) - distance / radius, distance in atlas
  // texels: the ink edge is at 1 - cutoff and the field runs out at 0.
  float sdfPerLocal = 1.0 / (uRadius * localPerAtlasPx);
  float fw = max(localPerPx * sdfPerLocal, MIN_FWIDTH);
  float edge = 1.0 - uCutoff;
  float visibility = 1.0 - vOcclusionFade;

  float inkAlpha = smoothstep(-0.5, 0.5, (bestSdf - edge) / fw) * inkOpacity * visibility;

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

    float t = min(max(d - haloWidthSDF, 0.0) / haloBlurSDF, 1.0);
    haloAlpha = (1.0 - smoothstep(0.0, 1.0, t)) * haloOpacity * visibility;
  }

  // Ink over halo, mixed in the output colour space, where the blend function
  // also mixes. Straight alpha out, which is what the blend function expects.
  float behind = haloAlpha * (1.0 - inkAlpha);
  float alpha = inkAlpha + behind;
  if (alpha <= 0.0) discard;

  vec3 ink = linearToOutputTexel(vec4(inkColor, 1.0)).rgb;
  vec3 halo = linearToOutputTexel(vec4(haloColor, 1.0)).rgb;
  outColor = vec4((ink * inkAlpha + halo * behind) / alpha, alpha);
}
`;
