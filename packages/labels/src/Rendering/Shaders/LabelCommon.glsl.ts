/**
/**
 * Data-texture access, for either shader stage. `texel` indexes the layouts
 * LABEL_TEXELS and GLYPH_TEXELS describe.
 */
export const TEXEL_FETCH = /* glsl */ `
precision highp float;

uniform highp sampler2D uLabelTex;
uniform int uLabelTexWidth;
uniform highp sampler2D uGlyphTex;
uniform int uGlyphTexWidth;

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
`;

/**
 * Vertex-only placement, shared so any consumer positions a label identically.
 */
export const LABEL_PLACEMENT = /* glsl */ `
${TEXEL_FETCH}

vec3 rotateByQuat(vec3 v, vec4 q) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

vec4 computeMapAlignedPosition(vec3 localPos, vec4 rot, vec3 labelPos) {
  vec3 rotated = rotateByQuat(localPos, rot);
  vec4 worldPos = modelMatrix * vec4(labelPos + rotated, 1.0);
  return projectionMatrix * viewMatrix * worldPos;
}

vec4 computeViewportAlignedPosition(vec3 localPos, vec3 labelPos) {
  vec4 centerVS = modelViewMatrix * vec4(labelPos, 1.0);
  vec3 posVS = centerVS.xyz + vec3(localPos.xy, 0.0);
  return projectionMatrix * vec4(posVS, 1.0);
}

// Clip-space w of the label origin, which cancels the perspective divide.
float getScreenSizeScale(vec3 labelPos) {
  vec4 viewPos = modelViewMatrix * vec4(labelPos, 1.0);
  return abs((projectionMatrix * viewPos).w);
}

// TODO: the symPlace fallback is unreachable while RotationAlignment has only
// Map and Viewport.
vec4 placeLocal(vec3 local, int rotAlign, int symPlace, vec4 rot, vec3 labelPos) {
  switch (rotAlign) {
    case 0: return computeMapAlignedPosition(local, rot, labelPos);
    case 1: return computeViewportAlignedPosition(local, labelPos);
    default: return (symPlace == 0)
      ? computeViewportAlignedPosition(local, labelPos)
      : computeMapAlignedPosition(local, rot, labelPos);
  }
}
`;
