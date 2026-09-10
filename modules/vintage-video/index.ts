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

export interface VintageVideoModule {
  bake(uri: string, options: BakeOptions): Promise<BakedVideo>;
}
