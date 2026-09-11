/**
 * GLSL pipeline shared by live previews and the publish-time bake.
 *
 * The vertex stage draws a single full-screen triangle pair; the fragment
 * stage applies, in order: the composed color matrix, the fade lift toward
 * the filter's paper color, a radial vignette, and monochrome luminance
 * grain. Everything is driven by uniforms so one compiled program renders
 * all eight filters.
 */

export const VERTEX_SHADER = `
attribute vec2 aPosition;
uniform vec2 uUVScale;
uniform vec2 uUVOffset;
varying vec2 vUV;
varying vec2 vFrame;
void main() {
  vFrame = aPosition * 0.5 + 0.5;
  // The frame's corner-to-corner UV, narrowed to the part of the texture
  // that covers the frame — a photograph is cropped to the frame the way a
  // print is trimmed, never stretched to fit it.
  vUV = vFrame * uUVScale + uUVOffset;
  // Flip Y so image textures render upright.
  gl_Position = vec4(aPosition.x, -aPosition.y, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D uTexture;
uniform mat4 uColorMatrix;
uniform vec4 uColorOffset;
uniform float uFade;
uniform vec3 uFadeColor;
uniform float uVignette;
uniform float uGrain;
uniform float uGrainSeed;

varying vec2 vUV;
varying vec2 vFrame;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uGrainSeed) * 43758.5453);
}

void main() {
  vec4 color = texture2D(uTexture, vUV);

  // 1. Color matrix (white balance, saturation, contrast, brightness).
  color = clamp(uColorMatrix * color + uColorOffset, 0.0, 1.0);

  // 2. Fade: lift the blacks toward the filter's paper color.
  float lift = uFade * 0.38;
  color.rgb = mix(color.rgb, uFadeColor, lift * (1.0 - color.rgb));

  // 3. Vignette: gentle radial falloff, strongest in the corners of the
  //    frame — measured on the frame, not the texture, so a crop is still
  //    darkened at its own edges.
  vec2 centered = vFrame - 0.5;
  float radial = smoothstep(0.35, 0.95, length(centered) * 1.35);
  color.rgb *= 1.0 - radial * uVignette * 0.55;

  // 4. Grain: monochrome luminance noise, slightly stronger in midtones.
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  float midweight = 1.0 - abs(luma - 0.5) * 1.2;
  float noise = hash(vFrame * 512.0) - 0.5;
  color.rgb += noise * uGrain * 0.14 * max(midweight, 0.25);

  gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}
`;
