import type { FilterSpec } from "./types";

/**
 * The eight proprietary VINTAGE filters.
 *
 * Every post must carry exactly one of these. Tune numbers freely — posts
 * store only the filter id, so re-tuning here restyles live previews, and
 * already-published photos keep the look they were baked with.
 */
export const FILTERS: readonly FilterSpec[] = [
  {
    id: "archive-bw",
    name: "Archive",
    description: "Silver-print black & white with deep grain.",
    monochrome: true,
    adjustments: { brightness: 0.02, contrast: 1.12, saturation: 0, temperature: 0, tint: 0 },
    artifacts: { fade: 0.1, fadeColor: [0.82, 0.8, 0.76], vignette: 0.35, grain: 0.4 },
    dateStamp: { defaultOn: false },
  },
  {
    id: "seventy",
    name: "Seventy",
    description: "Faded warmth, straight out of a 1970s shoebox.",
    adjustments: { brightness: 0.03, contrast: 0.92, saturation: 0.82, temperature: 0.55, tint: -0.12 },
    artifacts: { fade: 0.32, fadeColor: [0.93, 0.86, 0.72], vignette: 0.28, grain: 0.22 },
    dateStamp: { defaultOn: false },
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
    dateStamp: { defaultOn: true },
  },
  {
    id: "ninety-eight",
    name: "’98",
    description: "Grainy late-90s city nights on drugstore film.",
    adjustments: { brightness: -0.02, contrast: 1.18, saturation: 1.08, temperature: 0.1, tint: 0.12 },
    artifacts: { fade: 0.12, fadeColor: [0.72, 0.74, 0.7], vignette: 0.42, grain: 0.5 },
    dateStamp: { defaultOn: true },
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
    description: "Muted slide-film color, rich reds, quiet blues.",
    adjustments: { brightness: 0, contrast: 1.14, saturation: 0.94, temperature: 0.22, tint: -0.06 },
    artifacts: { fade: 0.06, fadeColor: [0.8, 0.76, 0.68], vignette: 0.3, grain: 0.18 },
    dateStamp: { defaultOn: false },
  },
  {
    id: "neutral-aged",
    name: "Plain",
    description: "Neutral aged film — barely there.",
    adjustments: { brightness: 0.02, contrast: 1.02, saturation: 0.95, temperature: 0.08, tint: 0 },
    artifacts: { fade: 0.1, fadeColor: [0.88, 0.86, 0.8], vignette: 0.12, grain: 0.08 },
  },
] as const;

export function getFilter(id: string): FilterSpec {
  const f = FILTERS.find((x) => x.id === id);
  return f ?? FILTERS[FILTERS.length - 1];
}

export function filterSupportsDateStamp(id: string): boolean {
  return Boolean(getFilter(id).dateStamp);
}
