import { coverCropPx } from "./coverFit";

/**
 * The size a photograph is baked at, and the grain it is baked with.
 *
 * The bake used to be a screenshot of the preview: 750 to 1290 pixels
 * wide depending on the phone, and resampled by a row whenever the height
 * was not a whole number of points. It is now drawn offscreen at the size
 * it is published at, with the crop the member framed in the preview, so
 * the same photograph comes out the same on every phone.
 */

/** Long side of a baked photograph: the feed's own long side, so the file
 * that is uploaded needs no further resize. */
export const BAKE_MAX_SIDE = 1440;

/** One JPEG generation at 0.92 keeps grain as grain. The old chain encoded
 * three times, the last at 0.85, and turned it into 8×8 blocks. */
export const BAKE_QUALITY = 0.92;

/** How long a bake waits for a renderer that is still loading its photograph
 * before it gives up. The caller then posts the photograph unbaked, which
 * is better than holding the member on the compose screen. */
export const BAKE_TIMEOUT_MS = 2000;

/**
 * The screen scale as the whole number expo-gl's snapshot divides by.
 *
 * The snapshot converts the pixel rect it reads into a whole number of
 * points (width / scale, truncated) and redraws the pixels into an image
 * of that many points. A dimension that is not a multiple of the scale is
 * therefore resampled by up to a pixel, which softens the whole picture.
 * UIScreen's scale is exactly 1, 2 or 3 on every iPhone; anything that is
 * not a sensible number is treated as 1, where no rounding is needed.
 */
export function scaleStep(scale: number): number {
  if (!Number.isFinite(scale) || scale < 1) return 1;
  // The tolerance absorbs a scale reported as 2.9999999 rather than 3.
  return Math.floor(scale + 1e-6);
}

/**
 * A pixel length rounded down to a multiple of the step, and never below
 * one step: a frame is always at least one point on each side.
 */
export function snapDown(px: number, step: number): number {
  const s = scaleStep(step);
  // Lengths arrive as products of ratios, so 1152 can come in as
  // 1151.9999999; without the tolerance it would lose a whole step.
  const whole = Math.floor(px + 1e-6);
  return Math.max(s, whole - (whole % s));
}

export interface BakeSizeInput {
  /** The photograph's own pixel size, when known. */
  sourceWidth: number | null | undefined;
  sourceHeight: number | null | undefined;
  /** The preview frame. Only its shape matters: the bake is that frame. */
  frameWidth: number;
  frameHeight: number;
  /** Cap on the long side of the bake. */
  maxSide: number;
  /** The screen scale (PixelRatio.get()); 1 where nothing resamples. */
  scale: number;
  /** GL_MAX_TEXTURE_SIZE, when known: the bake is drawn into a texture. */
  maxTextureSize?: number | null;
}

/**
 * How big the baked photograph is.
 *
 * Its shape is the preview frame's, because the bake is what the member
 * saw: the photograph cropped to that frame. Publishing the whole
 * uncropped picture instead would look the same in the feed (it frames
 * every post with the same clamp as compose), but the vignette and grain
 * are laid on the frame, so the strongest corners of the vignette would
 * land in the part the feed trims away.
 *
 * Its long side is the smallest of the cap, the crop's own long side in
 * source pixels (so a small photograph is never blown up; where the frame
 * does not crop, which is most photographs, that is simply the source's
 * long side), and what the GPU can render into. Each dimension is then
 * rounded down to a multiple of the screen scale, which keeps the shape
 * within one step of the frame's.
 *
 * Returns null when neither the frame nor the photograph has a size, as
 * there is then no shape to bake at.
 */
export function bakeOutputSize(input: BakeSizeInput): { width: number; height: number } | null {
  const { sourceWidth: sw, sourceHeight: sh, frameWidth: fw, frameHeight: fh } = input;
  const hasSource = !!sw && !!sh && sw > 0 && sh > 0;
  const hasFrame = fw > 0 && fh > 0;
  if (!hasFrame && !hasSource) return null;

  // With no frame, the renderer has never drawn anything to compare with,
  // so the photograph is baked whole.
  const aspect = hasFrame ? fw / fh : (sw as number) / (sh as number);

  let detail = Infinity;
  if (hasSource && hasFrame) {
    const crop = coverCropPx(sw as number, sh as number, fw, fh);
    detail = Math.max(crop.width, crop.height);
  } else if (hasSource) {
    detail = Math.max(sw as number, sh as number);
  }
  // Without a known source size the preview stretches the texture over the
  // frame too (coverUV's fallback), so only the cap limits the bake.

  const cap = Number.isFinite(input.maxSide) && input.maxSide >= 1 ? input.maxSide : BAKE_MAX_SIDE;
  const gpu =
    input.maxTextureSize && Number.isFinite(input.maxTextureSize) && input.maxTextureSize > 0
      ? input.maxTextureSize
      : Infinity;
  const long = Math.min(cap, detail, gpu);

  const step = scaleStep(input.scale);
  const width = aspect >= 1 ? long : long * aspect;
  const height = aspect >= 1 ? long / aspect : long;
  return { width: snapDown(width, step), height: snapDown(height, step) };
}

/**
 * The grid the grain is drawn on, in cells across and down the frame.
 *
 * The shader gives each cell one random value. The preview's cells are its
 * own pixels, as they always were, so its grain is unchanged. The bake
 * draws the very same cells at its own size instead of one per bake pixel:
 * otherwise a 1440-pixel bake of a 1179-pixel preview would carry grain
 * about four fifths the size the member saw, and a small photograph would
 * carry coarser grain than its preview.
 *
 * Without a preview frame (a renderer that has never been laid out) the
 * cells fall back to the target's pixels.
 */
export function grainCells(
  frameWidth: number,
  frameHeight: number,
  targetWidth: number,
  targetHeight: number,
): [number, number] {
  if (frameWidth > 0 && frameHeight > 0) return [frameWidth, frameHeight];
  return [Math.max(1, targetWidth), Math.max(1, targetHeight)];
}
