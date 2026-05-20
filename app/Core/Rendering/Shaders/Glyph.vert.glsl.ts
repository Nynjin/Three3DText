export const GLYPH_VERT = /* glsl */ `
precision highp float;

// Per-instance data textures
// Label texture layout:
//   T0: labelPos.xyz, visible
//   T1: rotation quat (x, y, z, w)
//   T2: color (r, g, b) + opacity
//   T3: haloColor (r, g, b) + haloOpacity
//   T4: haloWidth, haloBlur, -, -
//   T5: rotationAlignment, symbolPlacement, -, -
uniform highp sampler2D uLabelTex;
uniform int uLabelTexWidth;

// Glyph texture layout:
//   T0: label index, -, -, -
//   T1: char offset (x, y) + size (w, h)
//   T2: (px, py) in atlas + (pw, ph) size in atlas
uniform highp sampler2D uGlyphTex;
uniform int uGlyphTexWidth;

// Indirect draw index: points into glyphTex, set by culling
attribute int glyphIndex;

// Varyings for fragment shader
out vec2 vUv;
flat out int vLabelId;
flat out int vGlyphId;

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

// Quaternion rotation
vec3 rotateByQuat(vec3 v, vec4 q) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

// Map-aligned position computation
vec4 computeMapAlignedPosition(vec3 localPos, vec4 rot, vec3 labelPos) {
  vec3 rotated = rotateByQuat(localPos, rot);
  vec4 worldPos = modelMatrix * vec4(labelPos + rotated, 1.0);
  return projectionMatrix * viewMatrix * worldPos;
}

// Viewport-aligned position computation
vec4 computeViewportAlignedPosition(vec3 localPos, vec3 labelPos) {
  vec4 centerVS = modelViewMatrix * vec4(labelPos, 1.0);
  vec3 posVS = centerVS.xyz + vec3(localPos.xy, 0.0);
  return projectionMatrix * vec4(posVS, 1.0);
}

// Calculate scale factor based on distance to camera
float getDistanceScale(vec3 labelPos) {
  vec4 viewPos = modelViewMatrix * vec4(labelPos, 1.0);
  return length(viewPos.xyz);
}

void main() {
  vUv = uv;

  // glyphIndex is the texture slot for this glyph set by culling
  int gId = glyphIndex;
  vGlyphId = gId;

  // Read glyph data first to get the label index
  vec4 g0 = glyphFetch(gId, 0);
  vLabelId = int(g0.x);
  vec4 g1 = glyphFetch(gId, 1);
  vec2 charOffset = g1.xy;
  vec2 size = g1.zw;

  // Read label data using the label index from glyph T0
  vec3 labelPos = labelFetch(vLabelId, 0).xyz;
  vec4 rot = labelFetch(vLabelId, 1);
  vec4 t5 = labelFetch(vLabelId, 5);
  int rotAlign = int(t5.x);
  int symPlace = int(t5.y);

  float sizeScale = getDistanceScale(labelPos);
  vec3 quad = position * vec3(size * sizeScale, 1.0);
  vec3 local = vec3(charOffset * sizeScale, 0.0) + quad;

  switch (rotAlign) {
    case 0: // Map-aligned
      gl_Position = computeMapAlignedPosition(local, rot, labelPos);
      break;
    case 1: // Viewport-aligned
      gl_Position = computeViewportAlignedPosition(local, labelPos);
      break;
    default: // Auto
      gl_Position = (symPlace == 0)
        ? computeViewportAlignedPosition(local, labelPos)
        : computeMapAlignedPosition(local, rot, labelPos);
      break;
  }
}
`;
