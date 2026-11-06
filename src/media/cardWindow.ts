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

/**
 * The timeline (src/components/Timeline.tsx) hangs a member's every
 * photograph off one line in a plain scroll view, which it needs whole to
 * magnify. It used to fetch and decode every one of them the moment it
 * was opened: a hundred and fifty pictures at once for the longest
 * history on production today. Then a row drew its picture once the
 * reader came within a few screens of it, and kept it for good: scrolled
 * to the end, the line still held every picture decoded, half a megabyte
 * or more each at a 3x phone's frame size, and that grows with the
 * history. Now the rows around the reader draw their pictures, and a row
 * the reader has left far behind (or never reached) lets its picture go;
 * the frame stays, at its size, so nothing moves either way.
 */

/**
 * Each row's top for a new array of rows, carried over from the tops the
 * rows last reported, by the row's key.
 *
 * A row reports its top when it is laid out, and the platform lays it out
 * again only when its frame changes (Fabric's view event emitter sends
 * onLayout only for a new frame; the browser's resize observer is the
 * same). The profile's posts are read again after a like, a comment, a
 * pull to refresh or a return to the screen, and every reading is a new
 * array of rows with every row where it was: the tops began empty again,
 * none was reported, and the timeline stopped drawing pictures at the
 * first row it could not place until the view was switched. A row that
 * did move reports its new top; a row new to the line reports its own.
 */
export function rowTops(keys: readonly string[], known: ReadonlyMap<string, number>): (number | undefined)[] {
  return keys.map((key) => known.get(key));
}

/** Rows that draw their picture from the start: the first screen or two. */
export const TIMELINE_FIRST_ROWS = 8;

/**
 * Screens around the view, as [above it, below it]: the rows that always
 * have their pictures; the rows drawn when the window moves, a screen
 * more above and two more below, so it moves only every screen or two;
 * and how far a row may be before it lets its picture go.
 */
export const TIMELINE_SCREENS = Object.freeze({
  drawn: [1, 2] as const,
  spare: [2, 4] as const,
  kept: [4, 6] as const,
});

/** The rows that draw their picture: from `first` up to, and not including, `end`. */
export interface RowWindow {
  first: number;
  end: number;
}

/** The rows drawn before any has said where it is: the first screen or two. */
export const TIMELINE_FIRST_WINDOW: RowWindow = Object.freeze({ first: 0, end: TIMELINE_FIRST_ROWS });

/**
 * Which rows draw their picture, given where the reader is and which
 * rows do now (`current`, handed back unchanged while it will do): never
 * fewer than the rows from a screen above the view to two below it, and
 * never a row more than four screens above it or six below. A row that
 * has not said where it is is not drawn for being near, and is never let
 * go for being far.
 *
 * `tops` are the rows' tops in the line's own unscaled coordinates; the
 * line sits `blockTop` down the page, scaled by `scale` about its top and
 * lifted by `lift` (never positive), as the timeline draws it.
 */
export function timelineWindow({
  tops,
  current,
  scrollY,
  viewport,
  blockTop,
  scale,
  lift,
}: {
  tops: readonly (number | undefined)[];
  current: RowWindow;
  scrollY: number;
  viewport: number;
  blockTop: number;
  scale: number;
  lift: number;
}): RowWindow {
  const count = tops.length;
  if (count === 0 || !(viewport > 0)) return current;
  // Rows are placed only as far as their tops are known, from the first.
  let known = 0;
  while (known < count && tops[known] != null) known++;
  if (known === 0) return current;
  const at = (i: number) => tops[i] as number;
  // A point on the page, on the line's own unscaled scale.
  const onLine = (pageY: number) => (pageY - blockTop - Math.min(0, lift)) / Math.max(scale, 0.1);
  // The rows any part of which lies within so many screens above and below
  // the view. A row reaches down to the next one's top; the last placed
  // row, on down.
  const around = ([above, below]: readonly [number, number]): RowWindow => {
    const from = onLine(scrollY - viewport * above);
    const to = onLine(scrollY + viewport * (1 + below));
    let first = 0;
    while (first < known - 1 && at(first + 1) <= from) first++;
    let end = 0;
    while (end < known && at(end) <= to) end++;
    return { first, end };
  };
  const needed = around(TIMELINE_SCREENS.drawn);
  const kept = around(TIMELINE_SCREENS.kept);
  if (known < count) kept.end = count;
  const covers = current.first <= needed.first && current.end >= needed.end;
  const near = current.first >= kept.first && current.end <= kept.end;
  if (covers && near) return current;
  const next = around(TIMELINE_SCREENS.spare);
  return next.first === current.first && next.end === current.end ? current : next;
}
