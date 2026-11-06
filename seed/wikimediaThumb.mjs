/**
 * Wikimedia Commons addresses at the widths Commons serves.
 *
 * Commons renders thumbnails only at its standard widths
 * (https://w.wiki/GHai) and refuses any other with HTTP 400 ("Use
 * thumbnail sizes listed on https://w.wiki/GHai"); 400, 480, 501, 640, 800
 * and 1024 were refused when migration 0034 checked on 6 November 2026,
 * and 500 was served for every seed address tried. Asked for 1400, the API
 * now answers with its 1920 rendering (or the original, when that is no
 * wider), so seed/curate.mjs's old rewrite of "/1400px-" to "/480px-"
 * never matched, and 229 house photographs went into the seed with the
 * full picture as their grid square. 0034 repaired those rows; this keeps
 * a regenerated seed from bringing them back.
 */

/** Commons' standard thumbnail widths. */
export const WIKIMEDIA_WIDTHS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840];

/** The picture itself: what the API answers a request for 1400 with today, and what production's rows hold. */
export const PICTURE_WIDTH = 1920;

/** The grid square: the standard width 0034 gives the house photographs' Commons squares on production, the nearest to the 480 the seed first asked for. */
export const THUMB_WIDTH = 500;

/**
 * A Commons file's address at another standard width.
 *
 * A thumbnail address (…/thumb/a/ab/Name.jpg/1920px-Name.jpg) becomes the
 * same thumbnail at `width`. An original
 * (upload.wikimedia.org/wikipedia/commons/a/ab/Name.jpg), a JPEG or PNG
 * wider than `width`, becomes its thumbnail address at `width`, which is
 * how 0034 rewrote the seed's. Anything else (an original no wider than
 * `width`, or a format whose thumbnail Commons renames) is returned as it
 * is, as the seed always kept it.
 */
export function commonsAt(url, width, originalWidth) {
  if (!WIKIMEDIA_WIDTHS.includes(width)) throw new Error(`Wikimedia serves no ${width}px thumbnail (https://w.wiki/GHai)`);
  if (/\/\d+px-[^/]+$/.test(url)) return url.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`);
  const m = url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+\.(?:jpe?g|png))$/i);
  if (m && !(Number(originalWidth) <= width)) return `${m[1]}/thumb/${m[2]}/${m[3]}/${m[4]}/${width}px-${m[4]}`;
  return url;
}
