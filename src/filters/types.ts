/**
 * VINTAGE filter architecture.
 *
 * A filter is pure data: a set of photographic adjustments plus film-artifact
 * parameters. The data is consumed by two renderers that must stay visually
 * identical:
 *
 *  - `buildColorMatrix` turns the adjustments into a single 4x5 color matrix
 *    (pure, unit-tested math).
 *  - The GLSL fragment shader in `shader.ts` applies that matrix plus the
 *    non-linear artifacts (fade lift, vignette, grain) on the GPU, for both
 *    live previews and the final bake at publish time.
 *
 * Tuning a filter later means editing numbers in `presets.ts` — nothing else.
 */

export interface FilterAdjustments {
  /** Additive brightness, -1..1. 0 is neutral. */
  brightness: number;
  /** Contrast multiplier around mid-gray, 0..2. 1 is neutral. */
  contrast: number;
  /** Saturation, 0 (grayscale) .. 2. 1 is neutral. */
  saturation: number;
  /** Warm/cool shift, -1 (cool) .. 1 (warm). 0 is neutral. */
  temperature: number;
  /** Green/magenta shift, -1 (magenta) .. 1 (green). 0 is neutral. */
  tint: number;
}

export interface FilmArtifacts {
  /** Black-point lift, 0..1. Emulates aged, low-contrast prints. */
  fade: number;
  /** RGB (0..1 each) the lifted blacks drift toward — warm or cool paper. */
  fadeColor: readonly [number, number, number];
  /** Edge darkening strength, 0..1. */
  vignette: number;
  /** Luminance noise strength, 0..1. */
  grain: number;
}

export interface FilterSpec {
  /** Stable identifier stored on posts. Never rename once shipped. */
  id: string;
  /** Display name shown in the filter tray. */
  name: string;
  /** One-line mood description shown under the selected filter. */
  description: string;
  adjustments: FilterAdjustments;
  artifacts: FilmArtifacts;
  /** Fully desaturate before toning (Archive B&W). */
  monochrome?: boolean;
  /**
   * Whether the amber date stamp starts switched on when this filter is
   * chosen. Every filter can carry a stamp — this only sets the default.
   */
  dateStampDefault?: boolean;
}

export const NEUTRAL_ADJUSTMENTS: FilterAdjustments = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
};

export const NO_ARTIFACTS: FilmArtifacts = {
  fade: 0,
  fadeColor: [0.5, 0.5, 0.5],
  vignette: 0,
  grain: 0,
};
