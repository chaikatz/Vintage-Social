/**
 * GPU renderer for VINTAGE filters. Used at full size in the create flow
 * (live preview + publish-time bake) and at thumbnail size in the filter
 * tray. Not used in feeds — feeds show the baked JPEG.
 */
export * from "./types";
export * from "./presets";
export * from "./colorMatrix";
export { FilteredImage } from "./FilteredImage";
export type { BakeOptions, BakeResult, FilteredImageHandle } from "./FilteredImage";
export { BAKE_MAX_SIDE, BAKE_QUALITY, BAKE_TIMEOUT_MS } from "./bakeSize";
