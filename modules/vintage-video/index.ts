/**
 * The native side of video filters — see `src/filters/bakeVideo.ts` for the
 * JS entry point, which loads this module optionally so Android, web and a
 * build without it fall back to the live overlay.
 */
export interface BakeOptions {
  /** 4x5 colour matrix, row-major, last column the offset — as `buildColorMatrix` returns it. */
  matrix: number[];
  fade: number;
  fadeColor: number[];
  vignette: number;
  grain: number;
  /** Longest side of the output, in pixels. */
  maxDimension: number;
}

export interface BakedVideo {
  uri: string;
  width: number;
  height: number;
}

/** A rectangle in output pixels, y down from the top — as `exportLayout` gives it. */
export interface BrandRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrandTextBox extends BrandRect {
  size: number;
  spacing: number;
}

/**
 * The print to paint around a film — see `src/utils/exportLayout.ts`, whose
 * rectangles these are. Colours are `#rrggbb`. An empty text draws nothing.
 */
export interface BrandOptions {
  width: number;
  height: number;
  photo: BrandRect;
  rule: BrandRect;
  wordmark: BrandTextBox;
  byline: BrandTextBox;
  credit: BrandTextBox;
  stamp: BrandTextBox;
  paper: string;
  well: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  ruleColor: string;
  wordmarkText: string;
  bylineText: string;
  creditText: string;
  stampText: string;
}

export interface VintageVideoModule {
  bake(uri: string, options: BakeOptions): Promise<BakedVideo>;
  /** A copy of the film on paper, with the label, sound kept. Optional: older builds lack it. */
  brand?(uri: string, options: BrandOptions): Promise<BakedVideo>;
}
