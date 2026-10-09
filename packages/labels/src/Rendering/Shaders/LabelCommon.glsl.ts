/**
 * Data-texture access, either stage. `base`: an item's first texel; `texel`:
 * offset within it.
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

/**
 * Vertex-stage placement of a label-local point. Positions are world coordinates
 * split into float32 and remainder; the camera, split alike, is subtracted
 * before the view rotation.
 */
export const LABEL_PLACEMENT = /* glsl */ `
${TEXEL_FETCH}

// Canvas size, in CSS px.
uniform vec2 uViewport;
// Camera position, world units, split like label positions.
uniform vec3 uEyeHigh;
uniform vec3 uEyeLow;

vec3 rotateByQuat(vec3 v, vec4 q) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

// View-space anchor from a float32 and its remainder.
vec3 anchorViewPos(vec3 high, vec3 low) {
  return mat3(viewMatrix) * ((high - uEyeHigh) + (low - uEyeLow));
}

// World units per CSS px at a view-space depth.
float worldPerPx(vec3 centerVS) {
  float w = abs((projectionMatrix * vec4(centerVS, 1.0)).w);
  return 2.0 * w / (projectionMatrix[1][1] * uViewport.y);
}

vec4 computeMapAlignedPosition(vec3 localPos, vec4 rot, vec3 centerVS) {
  return projectionMatrix * vec4(centerVS + mat3(viewMatrix) * rotateByQuat(localPos, rot), 1.0);
}

vec4 computeViewportAlignedPosition(vec3 localPos, vec3 centerVS) {
  return projectionMatrix * vec4(centerVS + localPos, 1.0);
}

// Clip position of a label-local point given in CSS px.
// TODO: the default branch is unreachable; rotAlign is 0 or 1.
vec4 placeLocal(vec2 localPx, int rotAlign, int symPlace, vec4 rot, vec3 centerVS) {
  vec3 local = vec3(localPx * worldPerPx(centerVS), 0.0);
  switch (rotAlign) {
    case 0: return computeMapAlignedPosition(local, rot, centerVS);
    case 1: return computeViewportAlignedPosition(local, centerVS);
    default: return (symPlace == 0)
      ? computeViewportAlignedPosition(local, centerVS)
      : computeMapAlignedPosition(local, rot, centerVS);
  }
}
`;
