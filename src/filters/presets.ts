import type { FilterSpec } from "./types";

/**
 * The proprietary VINTAGE filters.
 *
 * Every post carries exactly one. Tune numbers freely — posts store only the
 * filter id, so re-tuning here restyles new photographs, and already-published
 * ones keep the look they were baked with.
 *
 * Every filter can carry the amber date stamp; `dateStampDefault` only decides
 * whether the toggle starts on.
 */
export const FILTERS: readonly FilterSpec[] = [
  {
    id: "archive-bw",
    name: "Archive",
    description: "Silver-print black & white with deep grain.",
    monochrome: true,
    adjustments: { brightness: 0.02, contrast: 1.12, saturation: 0, temperature: 0, tint: 0 },
    artifacts: { fade: 0.1, fadeColor: [0.82, 0.8, 0.76], vignette: 0.35, grain: 0.4 },
  },
  {
    id: "seventy",
    name: "Seventy",
    description: "Faded warmth, straight out of a 1970s shoebox.",
    adjustments: { brightness: 0.03, contrast: 0.92, saturation: 0.82, temperature: 0.55, tint: -0.12 },
    artifacts: { fade: 0.32, fadeColor: [0.93, 0.86, 0.72], vignette: 0.28, grain: 0.22 },
  },
  {
    id: "alpine",
    name: "Alpine",
    description: "Cool mountain film, crisp and blue-shadowed.",
    adjustments: { brightness: 0.04, contrast: 1.08, saturation: 0.9, temperature: -0.45, tint: 0.05 },
    artifacts: { fade: 0.08, fadeColor: [0.78, 0.84, 0.92], vignette: 0.18, grain: 0.12 },
  },
  {
    id: "riviera",
    name: "Riviera",
    description: "Sun-bleached Mediterranean light.",
    adjustments: { brightness: 0.1, contrast: 0.88, saturation: 0.78, temperature: 0.35, tint: -0.05 },
    artifacts: { fade: 0.38, fadeColor: [0.97, 0.93, 0.82], vignette: 0.1, grain: 0.1 },
    dateStampDefault: true,
  },
  {
    id: "ninety-eight",
    name: "’98",
    description: "Grainy late-90s city nights on drugstore film.",
    adjustments: { brightness: -0.02, contrast: 1.18, saturation: 1.08, temperature: 0.1, tint: 0.12 },
    artifacts: { fade: 0.12, fadeColor: [0.72, 0.74, 0.7], vignette: 0.42, grain: 0.5 },
    dateStampDefault: true,
  },
  {
    id: "instant",
    name: "Instant",
    description: "Soft Polaroid exposure with milky shadows.",
    adjustments: { brightness: 0.08, contrast: 0.82, saturation: 0.86, temperature: 0.18, tint: -0.15 },
    artifacts: { fade: 0.45, fadeColor: [0.95, 0.93, 0.88], vignette: 0.22, grain: 0.16 },
  },
  {
    id: "chrome-64",
    name: "Chrome 64",
    description: "Muted slide-film colour, rich reds, quiet blues.",
    adjustments: { brightness: 0, contrast: 1.14, saturation: 0.94, temperature: 0.22, tint: -0.06 },
    artifacts: { fade: 0.06, fadeColor: [0.8, 0.76, 0.68], vignette: 0.3, grain: 0.18 },
  },
  {
    id: "neutral-aged",
    name: "Plain",
    description: "Neutral aged film — barely there.",
    adjustments: { brightness: 0.02, contrast: 1.02, saturation: 0.95, temperature: 0.08, tint: 0 },
    artifacts: { fade: 0.1, fadeColor: [0.88, 0.86, 0.8], vignette: 0.12, grain: 0.08 },
  },
  {
    id: "ember",
    name: "Ember",
    description: "Last light indoors, shadows going orange.",
    adjustments: { brightness: -0.04, contrast: 1.1, saturation: 0.88, temperature: 0.6, tint: -0.1 },
    artifacts: { fade: 0.14, fadeColor: [0.98, 0.78, 0.55], vignette: 0.5, grain: 0.28 },
  },
  {
    id: "bleach",
    name: "Bleach",
    description: "Colour pulled out, contrast pushed hard.",
    adjustments: { brightness: 0.04, contrast: 1.35, saturation: 0.45, temperature: 0.05, tint: 0 },
    artifacts: { fade: 0.1, fadeColor: [0.9, 0.9, 0.88], vignette: 0.3, grain: 0.24 },
  },
  {
    id: "cassette",
    name: "Cassette",
    description: "Tracking slightly off. Green in the corners.",
    adjustments: { brightness: 0.03, contrast: 0.9, saturation: 0.9, temperature: -0.2, tint: 0.28 },
    artifacts: { fade: 0.28, fadeColor: [0.8, 0.9, 0.85], vignette: 0.34, grain: 0.42 },
    dateStampDefault: true,
  },
  {
    id: "peach",
    name: "Peach",
    description: "Soft pink highlights, a kind light for faces.",
    adjustments: { brightness: 0.09, contrast: 0.86, saturation: 0.92, temperature: 0.3, tint: -0.28 },
    artifacts: { fade: 0.34, fadeColor: [1.0, 0.87, 0.85], vignette: 0.14, grain: 0.14 },
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Pushed film after dark — cold, grainy, awake.",
    adjustments: { brightness: -0.06, contrast: 1.22, saturation: 0.7, temperature: -0.55, tint: 0.08 },
    artifacts: { fade: 0.08, fadeColor: [0.6, 0.7, 0.85], vignette: 0.48, grain: 0.45 },
    dateStampDefault: true,
  },
  {
    id: "postcard",
    name: "Postcard",
    description: "Holiday colour, printed a little too bright.",
    adjustments: { brightness: 0.05, contrast: 1.16, saturation: 1.25, temperature: 0.28, tint: -0.08 },
    artifacts: { fade: 0.06, fadeColor: [0.95, 0.9, 0.8], vignette: 0.2, grain: 0.1 },
  },
] as const;

/** The look an unknown or missing filter id falls back to. */
const FALLBACK_ID = "neutral-aged";

export function getFilter(id: string): FilterSpec {
  const f = FILTERS.find((x) => x.id === id);
  return f ?? FILTERS.find((x) => x.id === FALLBACK_ID)!;
}

/** Whether the date stamp toggle starts on for this filter. */
export function dateStampStartsOn(id: string): boolean {
  return getFilter(id).dateStampDefault ?? false;
}
