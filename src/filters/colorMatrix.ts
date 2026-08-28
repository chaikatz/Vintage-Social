import type { FilterAdjustments } from "./types";

/**
 * Color matrices in the 4x5 row-major convention (like SVG feColorMatrix):
 *
 *   [ rr rg rb ra ro ]
 *   [ gr gg gb ga go ]
 *   [ br bg bb ba bo ]
 *   [ ar ag ab aa ao ]
 *
 * where the last column is an additive offset in 0..1 color space.
 */
export type ColorMatrix = number[]; // length 20

/** Rec. 601 luma weights, the classic photographic desaturation weights. */
const LUM_R = 0.299;
const LUM_G = 0.587;
const LUM_B = 0.114;

export function identityMatrix(): ColorMatrix {
  // prettier-ignore
  return [
    1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Concatenate two matrices: result applies `first`, then `second`. */
export function concatMatrices(second: ColorMatrix, first: ColorMatrix): ColorMatrix {
  const out: number[] = new Array(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let v = 0;
      for (let k = 0; k < 4; k++) {
        v += second[row * 5 + k] * first[k * 5 + col];
      }
      if (col === 4) v += second[row * 5 + 4]; // offsets accumulate through the implicit [0,0,0,0,1] row
      out[row * 5 + col] = v;
    }
  }
  return out;
}

export function saturationMatrix(s: number): ColorMatrix {
  const inv = 1 - s;
  const r = inv * LUM_R;
  const g = inv * LUM_G;
  const b = inv * LUM_B;
  // prettier-ignore
  return [
    r + s, g,     b,     0, 0,
    r,     g + s, b,     0, 0,
    r,     g,     b + s, 0, 0,
    0,     0,     0,     1, 0,
  ];
}

export function contrastMatrix(c: number): ColorMatrix {
  const offset = 0.5 * (1 - c);
  // prettier-ignore
  return [
    c, 0, 0, 0, offset,
    0, c, 0, 0, offset,
    0, 0, c, 0, offset,
    0, 0, 0, 1, 0,
  ];
}

export function brightnessMatrix(b: number): ColorMatrix {
  // prettier-ignore
  return [
    1, 0, 0, 0, b,
    0, 1, 0, 0, b,
    0, 0, 1, 0, b,
    0, 0, 0, 1, 0,
  ];
}

/**
 * White-balance shift. Positive temperature warms (lifts red, sinks blue);
 * positive tint pushes green, negative pushes magenta. The 0.12 scale keeps
 * a full-strength shift photographic rather than lurid.
 */
export function whiteBalanceMatrix(temperature: number, tint: number): ColorMatrix {
  const t = temperature * 0.12;
  const g = tint * 0.08;
  // prettier-ignore
  return [
    1 + t, 0,     0,     0, 0,
    0,     1 + g, 0,     0, 0,
    0,     0,     1 - t, 0, 0,
    0,     0,     0,     1, 0,
  ];
}

/** Full desaturation followed by a gentle warm-silver tone. */
export function monochromeMatrix(): ColorMatrix {
  const tone: ColorMatrix = [
    // prettier-ignore
    1.02, 0, 0, 0, 0,
    0, 1.0, 0, 0, 0,
    0, 0, 0.96, 0, 0,
    0, 0, 0, 1, 0,
  ];
  return concatMatrices(tone, saturationMatrix(0));
}

/**
 * Compose the full matrix for a filter's adjustments. Order is the standard
 * darkroom order: white balance on the scene, then saturation, then tonal
 * contrast, then exposure offset.
 */
export function buildColorMatrix(
  adjustments: FilterAdjustments,
  monochrome = false,
): ColorMatrix {
  let m = whiteBalanceMatrix(adjustments.temperature, adjustments.tint);
  m = concatMatrices(saturationMatrix(adjustments.saturation), m);
  if (monochrome) m = concatMatrices(monochromeMatrix(), m);
  m = concatMatrices(contrastMatrix(adjustments.contrast), m);
  m = concatMatrices(brightnessMatrix(adjustments.brightness), m);
  return m;
}

/** Apply a matrix to an rgba color (components 0..1). Used by tests. */
export function applyMatrix(
  m: ColorMatrix,
  [r, g, b, a]: [number, number, number, number],
): [number, number, number, number] {
  const dot = (row: number) =>
    m[row * 5] * r + m[row * 5 + 1] * g + m[row * 5 + 2] * b + m[row * 5 + 3] * a + m[row * 5 + 4];
  return [dot(0), dot(1), dot(2), dot(3)];
}

/**
 * Split a 4x5 matrix into the mat4 + vec4 uniform pair the shader consumes.
 * The mat4 is column-major, as WebGL expects.
 */
export function toShaderUniforms(m: ColorMatrix): { matrix: number[]; offset: number[] } {
  const matrix: number[] = [];
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      matrix.push(m[row * 5 + col]);
    }
  }
  const offset = [m[4], m[9], m[14], m[19]];
  return { matrix, offset };
}
