/**
 * How large a photograph's small copy is made: the thumbnail the grids,
 * Explore, the Timeline, Activity and a photograph sent in a thread show,
 * and the gallery's stand-in while the photograph itself comes in.
 *
 * It used to be cut at 480 pixels on its long side. A grid square shows
 * the middle of a photograph at the square's size, so it is the short
 * side that fills it: a landscape photograph (three posts in four on
 * production) came as 480 by 320, and a square of 436 pixels (a third of
 * a 440-point phone at 3x) drew it 1.36 times larger than it was. Soft.
 *
 * Now the short side is what is set, at the size of the largest place a
 * thumbnail is shown at its own size on a 3x phone: a photograph sent in
 * a thread, 180 points square, so 540 pixels. Every smaller place is sharp
 * with it too: a grid square (436), a Timeline frame (525 across), an
 * Activity row (120). The places that show it larger only stand it in
 * while the photograph itself loads. The long side follows the shape, up
 * to twice the short side for a panorama, and nothing is ever made larger
 * than the photograph it is cut from: the preparer never enlarges
 * (src/media/nativeMedia.ts), so a small photograph keeps its own size.
 *
 * The preparer is asked for a long side, so the long side is worked out
 * here from the photograph's shape, rounded up so the short side it makes
 * is never under THUMB_SHORT.
 */

/** The short side of a photograph's thumbnail, in pixels. */
export const THUMB_SHORT = 540;

/** The longest a thumbnail's long side may be: a panorama's, at twice the short side. */
export const THUMB_LONG_MAX = 2 * THUMB_SHORT;

/** The long side asked for when the photograph's size is not known: a 3:2 photograph's. */
export const THUMB_LONG_UNKNOWN = Math.ceil(THUMB_SHORT * 1.5);

/** The long side to ask the preparer for, so the thumbnail's short side is THUMB_SHORT. */
export function thumbLongSide(width: number | null | undefined, height: number | null | undefined): number {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return THUMB_LONG_UNKNOWN;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  return Math.min(THUMB_LONG_MAX, Math.ceil((THUMB_SHORT * long) / short));
}
