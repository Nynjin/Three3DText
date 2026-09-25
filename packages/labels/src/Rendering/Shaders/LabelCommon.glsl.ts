/**
 * Data-texture access, for either shader stage. `base` is an item's first
 * texel; `texel` is the offset within it.
 */
export const TEXEL_FETCH = /* glsl */ `
precision highp float;
precision highp int;

uniform highp sampler2D uLabelTex;
uniform highp sampler2D uGlyphTex;

vec4 labelFetch(int base, int texel) {
  int i = base + texel;
  int w = textureSize(uLabelTex, 0).x;
  return texelFetch(uLabelTex, ivec2(i % w, i / w), 0);
}

vec4 glyphFetch(int base, int texel) {
  int i = base + texel;
  int w = textureSize(uGlyphTex, 0).x;
  return texelFetch(uGlyphTex, ivec2(i % w, i / w), 0);
}
`;

/** Vertex-stage placement of a label-local point. Label positions are world coordinates. */
export const LABEL_PLACEMENT = /* glsl */ `
${TEXEL_FETCH}

// Canvas size, in CSS px.
uniform vec2 uViewport;

vec3 rotateByQuat(vec3 v, vec4 q) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

// World units covering one CSS px of the canvas at the label's depth.
float worldPerPx(vec3 labelPos) {
  float w = abs((projectionMatrix * viewMatrix * vec4(labelPos, 1.0)).w);
  return 2.0 * w / (projectionMatrix[1][1] * uViewport.y);
}

vec4 computeMapAlignedPosition(vec3 localPos, vec4 rot, vec3 labelPos) {
  return projectionMatrix * viewMatrix * vec4(labelPos + rotateByQuat(localPos, rot), 1.0);
}

vec4 computeViewportAlignedPosition(vec3 localPos, vec3 labelPos) {
  vec4 centerVS = viewMatrix * vec4(labelPos, 1.0);
  return projectionMatrix * vec4(centerVS.xyz + localPos, 1.0);
}

// Clip position of a label-local point given in CSS px.
// TODO: the default branch is unreachable; rotAlign is 0 or 1.
vec4 placeLocal(vec2 localPx, int rotAlign, int symPlace, vec4 rot, vec3 labelPos) {
  vec3 local = vec3(localPx * worldPerPx(labelPos), 0.0);
  switch (rotAlign) {
    case 0: return computeMapAlignedPosition(local, rot, labelPos);
    case 1: return computeViewportAlignedPosition(local, labelPos);
    default: return (symPlace == 0)
      ? computeViewportAlignedPosition(local, labelPos)
      : computeMapAlignedPosition(local, rot, labelPos);
  }
}
`;
