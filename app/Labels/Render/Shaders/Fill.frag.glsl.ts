export const FILL_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
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
  vec4 uvRect = glyphFetch(vGlyphId, 2);
  vec4 t2 = labelFetch(vLabelId, 2);
  vec3 color = t2.rgb;
  float opacity = t2.a;

  // Sample SDF
  vec2 atlasUV = mix(uvRect.xy, uvRect.zw, vUv);
  float sdf = texture(uAtlas, atlasUV).r;

  // Convert signed distance to pixel distance
  float sdPx = (sdf - uCutoff) / fwidth(sdf);

  float alpha = smoothstep(-0.5, 0.5, sdPx);
  if (alpha <= 0.0) discard;
  outColor = vec4(color, opacity * alpha);
}
`;
