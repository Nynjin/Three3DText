export const HALO_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform float uCutoff;
uniform float uRadius;

varying vec2 vUv;
varying vec4 vUvRect;
varying vec4 vHaloColor;
varying float vHaloOpacity;
varying float vHaloWidth;
varying float vHaloBlur;
varying float vHaloPadding;

void main() {
  // Sample SDF
  vec2 atlasUV = mix(vUvRect.xy, vUvRect.zw, vUv);

  float sdf = texture2D(uAtlas, atlasUV).r;

  // Signed distance in SDF units
  float sd = (sdf - uCutoff) * uRadius;

  // Convert to pixel distance (negative = outside glyph, positive = inside)
  float edgePx = sd / fwidth(sd);

  // Calculate distance from glyph edge (positive = farther from edge)
  float distFromEdge = max(-edgePx, 0.0);
  
  // Total halo band width
  float inner = vHaloWidth;
  float outer = vHaloWidth + vHaloBlur;

  // Smooth alpha based on distance from edge
  float alpha = 1.0 - smoothstep(inner, outer, distFromEdge);
  alpha = clamp(alpha, 0.0, 1.0);

  gl_FragColor = vec4(vHaloColor.rgb, alpha * vHaloOpacity);
}
`;