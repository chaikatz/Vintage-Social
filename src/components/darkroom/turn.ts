/**
 * A tap on the photograph turns the page: the right half on to the next
 * print, the left half back, as a book is turned from the side it is held
 * by. This decides which way, or that it does not (`tapStep`); the pager
 * turns it (`Stage`), by its own scroll, with the same slide a swipe ends
 * in.
 *
 * Only the photograph turns. The words around it — the running head, the
 * caption's date and SET ASIDE, DEVELOP — are presses of their own, and a
 * title card or an end page keeps its words and its swipe and takes no
 * tap at all.
 *
 * Pure, so the tests can hold every case without a screen.
 */

/** Which page is in front, and what holds a tap back. */
export interface TapContext {
  /** The settled page: the one the pager last came to rest on, never one it is on its way to. */
  index: number;
  /** Pages in the pager: the prints, and the page after them. */
  count: number;
  /** The photograph is zoomed in: a tap is for looking closer. */
  zoomed: boolean;
  /** A develop state is showing, or the stage is held (a develop under way, a chapter loading, its title card). */
  locked: boolean;
  /** A turn is still under way — a swipe, or a tap's — and has not settled. */
  turning: boolean;
  /** VoiceOver is running. */
  screenReader: boolean;
}

/**
 * -1 for the page before, 1 for the page after, 0 for no turn. `x` is how
 * far across the page the finger lifted, `width` the page's width; the
 * plate is centred on the page, so its halves are the page's. The middle
 * itself is the right half.
 *
 * Nothing turns
 *   - under VoiceOver, whose double-tap lands a touch in the middle of the
 *     stage: the stage is adjustable, and its swipes up and down are how
 *     VoiceOver turns the page;
 *   - while a develop state is showing, whose words are in the caption and
 *     in DEVELOP's place, and which a turn would clear;
 *   - while the photograph is zoomed in;
 *   - while a turn is under way, so quick taps turn one page, never a
 *     second from a page already being left;
 *   - before the first page, or past the last;
 *   - for a press with no place on the page (one the keyboard made).
 */
export function tapTurn(x: number, width: number, at: TapContext): -1 | 0 | 1 {
  if (at.screenReader || at.locked || at.zoomed || at.turning) return 0;
  if (!Number.isFinite(x) || !(width > 0) || x < 0 || x > width) return 0;
  const step = x < width / 2 ? -1 : 1;
  const to = at.index + step;
  return to >= 0 && to < at.count ? step : 0;
}

/** What the room holds a tap back by, as the stage reads it when tapped. */
export interface TapHeld {
  /** A develop state is showing, a chapter is on its way, or its title card is up. */
  locked: boolean;
  /** The pager can be swiped: never while a develop is under way, or a chapter loads. */
  scrollEnabled: boolean;
  /** VoiceOver is running. */
  screenReader: boolean;
  /** Reduce Motion is on: the turn is a cut, not the slide. */
  reduceMotion: boolean;
}

/** The pager as a tap finds it. */
export interface TapPager {
  /** The settled page. */
  index: number;
  /** Pages in the pager: the prints, and the page after them. */
  count: number;
  /** A turn is still under way, and has not settled. */
  turning: boolean;
}

/**
 * The whole of what the stage does with a tap: the page it turns to, and
 * whether it gets there by a cut (Reduce Motion) or with the slide a swipe
 * ends in; null for no turn. A pager that cannot be swiped takes no tap
 * either, so nothing turns that a swipe could not.
 */
export function tapStep(held: TapHeld, at: TapPager, x: number, width: number, zoomed: boolean): { to: number; cut: boolean } | null {
  const step = tapTurn(x, width, {
    index: at.index,
    count: at.count,
    zoomed,
    locked: held.locked || !held.scrollEnabled,
    turning: at.turning,
    screenReader: held.screenReader,
  });
  return step === 0 ? null : { to: at.index + step, cut: held.reduceMotion };
}
