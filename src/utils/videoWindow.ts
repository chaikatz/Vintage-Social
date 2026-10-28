/**
 * Which clips in the gallery may have a player.
 *
 * Home plays its clips well because each player is made a while before
 * its card is looked at: the feed draws cards ahead of the reader, a page
 * at a time, and a clip has loaded, paused, by the time it is the one on
 * screen. The gallery did the opposite. To land on the tapped photograph
 * it draws every card above it at once (see app/gallery.tsx), and every
 * one of those that was a clip made its own player in the same instant
 * and kept it, so the clip that was asked for started cold, sharing the
 * connection with all of them.
 *
 * So the gallery does on purpose what Home does by accident, for a few
 * cards only. While it is still measuring its way to the tapped
 * photograph, that one clip alone has a player, so it loads by itself.
 * Once the gallery is showing, the card on screen and one either side
 * have players, paused until they are the one on screen; every other
 * card draws its poster in the same frame, so nothing moves when a player
 * arrives or goes. One ahead rather than Home's several, because the
 * stored clips run at 10 to 50 Mbps and a neighbour that fills its buffer
 * takes that from the clip being watched.
 *
 * A tap deep in a long history lands past the cards the gallery draws to
 * measure. The tapped card is then not drawn until the list has been put
 * in place, and its player is made when it is: none of the cards drawn to
 * measure has one.
 */

/** Cards behind the one on screen that keep a player, for scrolling back. */
export const WARM_BEHIND = 1;
/** Cards ahead of the one on screen that make theirs early. */
export const WARM_AHEAD = 1;

/** The run of card indexes, first to last inclusive, whose clips may have a player. Empty when `last < first`. */
export interface WarmWindow {
  first: number;
  last: number;
}

/**
 * The card the window is centred on: the tapped one until the gallery is
 * showing, then the last card reported on screen since. Between two cards
 * nothing is on screen, and the focus stays where it was rather than
 * letting every player go.
 */
export function videoFocus({
  ready,
  startIndex,
  seenIndex,
}: {
  ready: boolean;
  startIndex: number;
  /** The last card reported on screen once the gallery was showing; null until one has been. */
  seenIndex: number | null;
}): number {
  if (!ready || seenIndex == null || seenIndex < 0) return startIndex;
  return seenIndex;
}

export function warmWindow({
  ready,
  startIndex,
  seenIndex,
  count,
  behind = WARM_BEHIND,
  ahead = WARM_AHEAD,
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
  // Measuring: the tapped clip loads alone.
  if (!ready) return { first: focus, last: focus };
  return { first: Math.max(0, focus - behind), last: Math.min(count - 1, focus + ahead) };
}

export function isWarm(index: number, window: WarmWindow): boolean {
  return index >= window.first && index <= window.last;
}
