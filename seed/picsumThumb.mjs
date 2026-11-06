/**
 * A Lorem Picsum photograph's grid square, at the size the app cuts a
 * member's.
 *
 * The seed used to ask Picsum for 480 pixels wide: 480 by 320 for three
 * house photographs in four. A grid square shows the middle of a
 * photograph at the square's size, so it is the short side that fills it,
 * and a short side of 320 was drawn 1.36 times larger than it was: soft,
 * beside the members' own photographs. The app cuts a member's thumbnail
 * with its short side at 540 pixels and its long side following the
 * shape, up to twice the short side (src/uploads/thumbSize.ts, THUMB_SHORT
 * and THUMB_LONG_MAX); migration 0034 asks Picsum for the house
 * thumbnails on production at that size, and this keeps a regenerated
 * seed at the same one. Picsum serves a photograph at any size asked for
 * in its address (/id/<picture>/<width>/<height>), cut from the middle.
 */

/** The short side of a thumbnail, as src/uploads/thumbSize.ts's THUMB_SHORT. */
export const PICSUM_THUMB_SHORT = 540;

/** The longest a thumbnail's long side may be, as THUMB_LONG_MAX. */
export const PICSUM_THUMB_LONG_MAX = 2 * PICSUM_THUMB_SHORT;

/**
 * The thumbnail address for Picsum picture `id` drawn at `width` by
 * `height`: the same picture and shape, its short side at 540, its long
 * side rounded up from the shape and never past 1080 (a panorama's short
 * side is then what follows the shape). Never larger than the photograph:
 * one whose short side is under 540 is its own thumbnail.
 */
export function picsumThumb(id, width, height) {
  const w = Number(width);
  const h = Number(height);
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  if (!(short > 0) || short < PICSUM_THUMB_SHORT) return `https://picsum.photos/id/${id}/${w}/${h}`;
  const longSide = Math.min(PICSUM_THUMB_LONG_MAX, Math.ceil((PICSUM_THUMB_SHORT * long) / short));
  const shortSide = longSide < PICSUM_THUMB_LONG_MAX ? PICSUM_THUMB_SHORT : Math.round((PICSUM_THUMB_LONG_MAX * short) / long);
  const [tw, th] = w >= h ? [longSide, shortSide] : [shortSide, longSide];
  return `https://picsum.photos/id/${id}/${tw}/${th}`;
}
