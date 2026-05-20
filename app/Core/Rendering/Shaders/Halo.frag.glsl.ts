export const HALO_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform int  uAtlasWidth;
uniform float uCutoff;
uniform float uRadius;
uniform highp sampler2D uLabelTex;
uniform int uLabelTexWidth;
uniform highp sampler2D uGlyphTex;
uniform int uGlyphTexWidth;

in vec2 vUv;
flat in int vLabelId;
flat in int vGlyphId;

out vec4 outColor;

vec4 labelFetch(int instanceId, int texel) {
  int li = instanceId + texel;
  int w = max(uLabelTexWidth, 1);
  return texelFetch(uLabelTex, ivec2(li % w, li / w), 0);
}

vec4 glyphFetch(int instanceId, int texel) {
  int li = instanceId + texel;
  int w = max(uGlyphTexWidth, 1);
  return texelFetch(uGlyphTex, ivec2(li % w, li / w), 0);
}

void main() {
  vec4 g2 = glyphFetch(vGlyphId, 2);
  vec4 t3 = labelFetch(vLabelId, 3);
  vec4 t4 = labelFetch(vLabelId, 4);
  vec3 haloColor = t3.rgb;
  float haloOpacity = t3.a;
  float haloWidth = t4.x;
  float haloBlur = t4.y;

  // Sample SDF
  // vUv.y is flipped
  vec2 atlasUV = (g2.xy + vec2(vUv.x, 1.0 - vUv.y) * g2.zw) / float(uAtlasWidth);
  float sdf = texture(uAtlas, atlasUV).r;
  float fw = fwidth(sdf);

  // Signed distance from glyph edge in SDF units
  float signedDist = sdf - uCutoff;

  // Distance from glyph edge in SDF units (positive = outside glyph)
  float d = max(-signedDist, 0.0);

  // Scale halo width and blur to SDF units
  float haloWidthSDF = haloWidth * fw;
  float haloBlurSDF = haloBlur * fw;

  // Calculate halo alpha with a Gaussian falloff
  float t = max(d - haloWidthSDF, 0.0) / max(haloBlurSDF, 1e-5);
  float alpha = exp(-5.0 * t * t);

  if (alpha <= 0.2) {
    discard;
  }

  outColor = vec4(haloColor, alpha * haloOpacity);
}
`;