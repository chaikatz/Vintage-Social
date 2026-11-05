import { videoFocus, type WarmWindow } from "@/utils/videoWindow";

/**
 * Which cards of a long list draw their photograph, and which posts have
 * their likes and comment previews read: the ones around the reader, not
 * every one the list holds.
 *
 * The gallery draws every card above the tapped one to measure its way
 * there (see app/gallery.tsx), up to eighty of them in one go, and a list
 * keeps the cards of its first draw for as long as it is open. Each of
 * those used to fetch and decode its full-size photograph at once, every
 * one competing with the photograph that was tapped, and every one held
 * in memory afterwards: up to eighty full-width pictures for one gallery.
 * Now a card draws its photograph only near the reader; every other card
 * is its frame, at exactly the height the photograph gives it (PostMedia's
 * `frameOnly`), so the landing measures the same and nothing moves when a
 * picture arrives.
 */

/** Cards above the one on screen that keep their photograph, for scrolling back. */
export const PICTURES_BEHIND = 2;
/** Cards below the one on screen that fetch theirs ahead of the reader. */
export const PICTURES_AHEAD = 3;

/**
 * The run of card indexes, first to last inclusive, that draw their
 * photograph: around the tapped card while the gallery lands (the cards
 * the reader will see the moment it shows), then around the last card
 * reported on screen. Empty when `last < first`.
 */
export function pictureWindow({
  ready,
  startIndex,
  seenIndex,
  count,
  behind = PICTURES_BEHIND,
  ahead = PICTURES_AHEAD,
}: {
  ready: boolean;
  startIndex: number;
  seenIndex: number | null;
  count: number;
  behind?: number;
  ahead?: number;
}): WarmWindow {
  if (count <= 0) return { first: 0, last: -1 };
  const focus = Math.min(Math.max(videoFocus({ ready, startIndex, seenIndex }), 0), count - 1);
  return { first: Math.max(0, focus - behind), last: Math.min(count - 1, focus + ahead) };
}

/**
 * How many posts make one stretch of likes and comment previews: a feed
 * page, so the feed's stretches fill as its pages arrive.
 */
export const ACTION_STRETCH = 12;

/**
 * The posts whose likes and comment previews are read: the stretch the
 * reader is in and one either side, cut at fixed places so the answer is
 * the same until the reader crosses into another stretch.
 *
 * Every id a screen held used to go into one request, and every new page
 * of the feed asked again for all of them: the request grew with every
 * page, and a gallery of a long history put up to a thousand ids into one
 * address, which the API gateway refuses outright (431, Request Header
 * Fields Too Large, somewhere between six hundred ids and a thousand), so
 * every heart on the page came up empty. The comment previews brought
 * every comment of every one of those posts besides. A card the reader can see is
 * always inside the stretches read, and a card far from them is not on
 * screen; the screens keep the last answer while the next stretch is read,
 * and that answer covers every card still on screen.
 */
export function idsAround(ids: readonly string[], focus: number, stretch = ACTION_STRETCH): string[] {
  if (ids.length === 0) return [];
  const at = Math.min(Math.max(Number.isFinite(focus) ? Math.floor(focus) : 0, 0), ids.length - 1);
  const k = Math.floor(at / stretch);
  return ids.slice(Math.max(0, (k - 1) * stretch), (k + 2) * stretch);
}
