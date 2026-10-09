import { LABEL_PLACEMENT, TEXEL_FETCH } from './LabelCommon.glsl';

const ICON_FETCH = /* glsl */ `
uniform highp sampler2D uIconTex;

vec4 iconFetch(int base, int texel) {
  int i = base + texel;
  int w = textureSize(uIconTex, 0).x;
  return texelFetch(uIconTex, ivec2(i % w, i / w), 0);
}
`;

/** One instance per drawn icon, quad sized to its draw box, placed like its label. */
export const ICON_VERT = /* glsl */ `
${LABEL_PLACEMENT}
${ICON_FETCH}
#include <common>
#include <logdepthbuf_pars_vertex>

// Label texel, icon texel.
attribute ivec2 iconSpan;
// Eased fade: 0 drawn, 1 hidden.
attribute float iconFade;

// Fragment position from the box's top-left corner, in CSS px, y down.
out vec2 vBoxPos;
flat out int vIconTexel;
flat out float vFade;

void main() {
  int labelTexel = iconSpan.x;
  vIconTexel = iconSpan.y;
  vFade = iconFade;

  vec3 centerVS = anchorViewPos(labelFetch(labelTexel, 0).xyz, labelFetch(labelTexel, 6).xyz);
  vec4 rot = labelFetch(labelTexel, 1);
  vec4 t5 = labelFetch(labelTexel, 5);
  vec4 box = iconFetch(vIconTexel, 0);

  vec2 local = box.xy + position.xy * box.zw;
  vBoxPos = vec2(position.x + 0.5, 0.5 - position.y) * box.zw;
  gl_Position = placeLocal(local, int(t5.x), int(t5.y), rot, centerVS);

  #include <logdepthbuf_vertex>
}
`;

/**
 * Bitmap icons: the premultiplied texel, un-premultiplied. SDF icons (MapLibre
 * encoding, field in alpha): ink and halo as the label shader shades glyphs.
 * Stretch ranges map the box to the image piecewise, a 9-slice on one quad.
 */
export const ICON_FRAG = /* glsl */ `
${TEXEL_FETCH}
${ICON_FETCH}

uniform sampler2D uImages;

#include <logdepthbuf_pars_fragment>

in vec2 vBoxPos;
flat in int vIconTexel;
flat in float vFade;

out vec4 outColor;

// MapLibre icon field: 0.75 at the edge, 1/8 per image px.
const float SDF_EDGE = 0.75;
const float SDF_PX = 8.0;
const float MIN_FWIDTH = 0.003;
const float MIN_BLUR_PX = 0.75;
const float MIN_FALLOFF = 0.05;

// Image px along one axis for a box position p (CSS px), box length len, image
// length n, stretch ranges r, k CSS px per image px in fixed parts.
float mapAxis(float p, float len, float n, vec4 r, float k) {
  float stretchImg = (r.y - r.x) + (r.w - r.z);
  float fixedLen = (n - stretchImg) * k;
  float avail = len - fixedLen;
  if (stretchImg <= 0.0 || avail <= 0.0) return p / len * n;
  float sk = avail / stretchImg;
  float e0 = r.x * k;
  float e1 = e0 + (r.y - r.x) * sk;
  float e2 = e1 + (r.z - r.y) * k;
  float e3 = e2 + (r.w - r.z) * sk;
  if (p < e0) return p / k;
  if (p < e1) return r.x + (p - e0) / sk;
  if (p < e2) return r.y + (p - e1) / k;
  if (p < e3) return r.z + (p - e2) / sk;
  return r.w + (p - e3) / k;
}

void main() {
  #include <logdepthbuf_fragment>

  // Derivatives before any branch or discard.
  float localPerPx = 0.5 * (length(dFdx(vBoxPos)) + length(dFdy(vBoxPos)));

  vec4 box = iconFetch(vIconTexel, 0);
  vec4 rect = iconFetch(vIconTexel, 1);
  vec4 col = iconFetch(vIconTexel, 2);
  vec4 halo = iconFetch(vIconTexel, 3);
  vec4 t4 = iconFetch(vIconTexel, 4);
  vec4 sx = iconFetch(vIconTexel, 5);
  vec4 sy = iconFetch(vIconTexel, 6);
  float k = t4.w;

  vec2 img = vec2(mapAxis(vBoxPos.x, box.z, rect.z, sx, k), mapAxis(vBoxPos.y, box.w, rect.w, sy, k));
  vec2 texel = clamp(rect.xy + img, rect.xy + 0.5, rect.xy + rect.zw - 0.5);
  vec4 s = texture(uImages, texel / vec2(textureSize(uImages, 0)));
  float visibility = 1.0 - vFade;

  if (t4.z < 0.5) {
    float a = s.a * col.a * visibility;
    if (a <= 0.0) discard;
    // Already in output space: the atlas holds the image's own bytes.
    outColor = vec4(s.rgb / max(s.a, 1e-5), a);
    return;
  }

  float sdfPerLocal = 1.0 / (SDF_PX * k);
  float fw = max(localPerPx * sdfPerLocal, MIN_FWIDTH);
  float inkAlpha = smoothstep(-0.5, 0.5, (s.a - SDF_EDGE) / fw) * col.a * visibility;

  float haloAlpha = 0.0;
  if (halo.a > 0.0 && t4.x > 0.0) {
    float d = max(SDF_EDGE - s.a, 0.0);
    float haloWidthSDF = min(t4.x * sdfPerLocal, SDF_EDGE - MIN_FALLOFF);
    float haloBlurSDF = min(max(t4.y * sdfPerLocal, fw * MIN_BLUR_PX), max(SDF_EDGE - haloWidthSDF, MIN_FALLOFF));
    float t = min(max(d - haloWidthSDF, 0.0) / haloBlurSDF, 1.0);
    haloAlpha = (1.0 - smoothstep(0.0, 1.0, t)) * halo.a * visibility;
  }

  float behind = haloAlpha * (1.0 - inkAlpha);
  float alpha = inkAlpha + behind;
  if (alpha <= 0.0) discard;

  vec3 ink = linearToOutputTexel(vec4(col.rgb, 1.0)).rgb;
  vec3 haloRgb = linearToOutputTexel(vec4(halo.rgb, 1.0)).rgb;
  outColor = vec4((ink * inkAlpha + haloRgb * behind) / alpha, alpha);
}
`;
