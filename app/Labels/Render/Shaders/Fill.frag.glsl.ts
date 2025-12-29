export const FILL_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform float uCutoff;
uniform float uRadius;

varying vec2 vUv;
varying vec4 vUvRect;
varying vec4 vColor;
varying float vOpacity;

void main() {

  // Sample SDF
  vec2 atlasUV = mix(vUvRect.xy, vUvRect.zw, vUv);
  float sdf = texture2D(uAtlas, atlasUV).r;

  // Signed distance in SDF units
  float distSDF = (sdf - uCutoff) * uRadius;

  // Convert to pixel distance (negative = outside glyph, positive = inside)
  float distPx = distSDF / (fwidth(sdf) * uRadius);

  // Fill glyph area only
  if (distPx >= 0.0) {
    gl_FragColor = vec4(vColor.rgb, vOpacity);
    return;
  }

  discard;
}
`;
