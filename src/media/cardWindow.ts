import { videoFocus, type WarmWindow } from "@/utils/videoWindow";

/**
 * Which cards of a long list draw their photograph: the ones around the
 * reader, not every one the list holds.
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
