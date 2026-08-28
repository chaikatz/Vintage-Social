import type { FilterSpec } from "./types";

/**
 * Browser approximation of the VINTAGE filter pipeline.
 *
 * The GL shader is the source of truth (it's what bakes photos on iOS).
 * For browser review builds we approximate the same FilterSpec with CSS
 * `filter` functions plus two overlay layers — close enough to judge the
 * look and the UI, not pixel-identical. Grain is intentionally omitted on
 * web.
 */

export interface WebFilterStyles {
  /** CSS filter string for the image element. */
  filter: string;
  /** rgba() color for the fade-lift overlay, or null. */
  fadeOverlay: string | null;
  /** rgba() color for the cool white-balance tint overlay, or null. */
  tintOverlay: string | null;
  /** CSS box-shadow string emulating the vignette, or null. */
  vignetteBoxShadow: string | null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function cssFilterFor(spec: FilterSpec): WebFilterStyles {
  const { brightness, contrast, saturation, temperature } = spec.adjustments;
  const { fade, fadeColor, vignette } = spec.artifacts;

  const parts: string[] = [];
  if (spec.monochrome) {
    parts.push("grayscale(1)");
  } else if (saturation !== 1) {
    parts.push(`saturate(${round(saturation)})`);
  }
  // Warmth maps well onto a light sepia pass; cool shifts use an overlay.
  if (!spec.monochrome && temperature > 0) {
    parts.push(`sepia(${round(temperature * 0.35)})`);
  }
  if (contrast !== 1) parts.push(`contrast(${round(contrast)})`);
  if (brightness !== 0) parts.push(`brightness(${round(1 + brightness)})`);

  const fadeAlpha = round(fade * 0.3);
  const fadeOverlay =
    fadeAlpha > 0
      ? `rgba(${Math.round(fadeColor[0] * 255)}, ${Math.round(fadeColor[1] * 255)}, ${Math.round(
          fadeColor[2] * 255,
        )}, ${fadeAlpha})`
      : null;

  const tintOverlay =
    !spec.monochrome && temperature < 0
      ? `rgba(150, 185, 225, ${round(Math.abs(temperature) * 0.18)})`
      : null;

  const vignetteBoxShadow =
    vignette > 0
      ? `inset 0 0 ${Math.round(90 * vignette)}px ${Math.round(20 * vignette)}px rgba(20, 15, 10, ${round(
          vignette * 0.45,
        )})`
      : null;

  return {
    filter: parts.join(" ") || "none",
    fadeOverlay,
    tintOverlay,
    vignetteBoxShadow,
  };
}
