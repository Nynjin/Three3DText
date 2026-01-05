export const GLYPH_VERT = /* glsl */ `
precision highp float;

// Attributes
attribute vec3 aLabelPos;
attribute vec2 aCharOffset;
attribute vec2 aSize;
attribute vec4 aUvRect;
attribute vec4 aGlyphQuat;

attribute float aRotationAlignment;
attribute float aSymbolPlacement;

attribute vec4 aColor;
attribute float aOpacity;

attribute vec4 aHaloColor;
attribute float aHaloOpacity;
attribute float aHaloWidth;
attribute float aHaloBlur;

// Varyings
varying vec2 vUv;
varying vec4 vUvRect;

varying vec4 vColor;
varying float vOpacity;

varying vec4 vHaloColor;
varying float vHaloOpacity;
varying float vHaloWidth;
varying float vHaloBlur;

// Quaternion rotation
vec3 rotateByQuat(vec3 v, vec4 q) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

// Map-aligned position computation
vec4 computeMapAlignedPosition(vec3 localPos, vec4 glyphQuat, vec3 labelPos) {
  vec3 rotated = rotateByQuat(localPos, glyphQuat);
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
  float dist = length(viewPos.xyz);
  return dist / 10.0;
}

void main() {
  vUv = uv;
  vUvRect = aUvRect;
  vColor = aColor;
  vHaloColor = aHaloColor;
  vOpacity = aOpacity;
  vHaloOpacity = aHaloOpacity;
  vHaloWidth = aHaloWidth;
  vHaloBlur = aHaloBlur;

  // Apply distance scaling to maintain constant glyph size
  float sizeScale = getDistanceScale(aLabelPos);
  vec3 quad = position * vec3(aSize * sizeScale, 1.0);
  vec3 local = vec3(aCharOffset * sizeScale, 0.0) + quad;

  switch (int(aRotationAlignment)) {
    case 0: // Map-aligned
        gl_Position = computeMapAlignedPosition(local, aGlyphQuat, aLabelPos);
        break;
    case 1: // Viewport-aligned
        gl_Position = computeViewportAlignedPosition(local, aLabelPos);
        break;
    default: // Auto (viewport-aligned if symbol placement is point)
        gl_Position = (int(aSymbolPlacement) == 0) ?
          computeViewportAlignedPosition(local, aLabelPos) :
          computeMapAlignedPosition(local, aGlyphQuat, aLabelPos);
        break;
  }
}
`;
