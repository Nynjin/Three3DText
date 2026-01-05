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
  float sdf = texture2D(
    uAtlas,
    atlasUV
  ).r;

  // Convert signed distance to pixel distance (negative = outside glyph, positive = inside)
  float sdPx = (sdf - uCutoff) / fwidth(sdf);

  // Fill glyph area only
  if (sdPx >= 0.0) {
    gl_FragColor = vec4(vColor.rgb, vOpacity);
    return;
  }

  discard;
}
`;
