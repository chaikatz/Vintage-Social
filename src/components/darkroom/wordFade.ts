/**
 * Whether the room's word — POST, or what a develop state puts in its
 * place — is on the page, and how it fades toward the end page.
 *
 * The word is the photograph's: it is on every photograph's page that is
 * settled in front, and nowhere else (a word page, the end page, the
 * waiting card, a title card over the stage). As a page is swiped from the
 * last photograph toward the end page it fades with the finger, as it
 * always has.
 *
 * Build 58 lost it. Its opacity was the pager's scroll interpolated, and
 * on the end page, the waiting card or under a title card the view was
 * handed a separate zero instead. That interpolation was the scroll
 * value's only consumer, so each hand-over left the value with none, and
 * React Native's Animated then drops its native node
 * (`AnimatedWithChildren.__removeChild` → `AnimatedNode.__detach` →
 * `dropAnimatedNode`). The pager's scroll event stays bound to the tag it
 * was given when it was attached (`attachNativeEventImpl` reads
 * `__getNativeTag()` once), so when the word came back the value got a new
 * native node, seeded with the last offset it had seen — the end page's —
 * and nothing drove it any more. In a chapter dealt in full (On this day,
 * the shelf, a stretch, a year to its end), a visit to the end page and
 * back left the word at nothing on every photograph until the chapter
 * changed. `tests/darkroom-word.test.ts` shows it with React Native's own
 * Animated code.
 *
 * Now the word reads one graph, built once (again only if the page width
 * changes), never swapped: `on × fade(scrollX + start)`. `on` follows the
 * settled page (`wordOnPage`); `start` moves the fade to the chapter's
 * last photograph as prints are dealt or taken out; the scroll value keeps
 * its one consumer for as long as the room is open. And the pager sets the
 * scroll value to the page it settled on (`Stage`), so even a scroll event
 * that never arrived cannot leave the word faded on a photograph.
 *
 * Pure, so the tests can build the graph out of React Native's own nodes.
 */

/** The word fades in, and out, over this as the page it belongs to settles or leaves. */
export const WORD_FADE_MS = 160;

/** What the stage has in front, for the word. */
export interface WordPage {
  /** The stage shows the pager (not a word page: first visit, denied, empty, checking). */
  prints: boolean;
  /** The page settled in front is a photograph (not the end page or the waiting card). */
  photograph: boolean;
  /** A title card is over the stage while a chapter comes. */
  card: boolean;
}

/** The word is on the page: a photograph's page settled in front, with no title card over it. */
export function wordOnPage(p: WordPage): boolean {
  return p.prints && p.photograph && !p.card;
}

/**
 * Where the fade begins, as an offset to add to the pager's scroll: the
 * last photograph's page, so the word is whole up to it and gone at the
 * page after it. `count` is the chapter's photographs.
 */
export function fadeStart(count: number, width: number): number {
  return -Math.max(0, count - 1) * Math.max(0, width);
}

/** The fade's interpolation: whole up to the last photograph's page, gone a page on. */
export interface FadeConfig {
  inputRange: number[];
  outputRange: number[];
  extrapolate: "clamp";
}

/** The two Animated operations the graph is built from: React Native's `Animated`, or its own nodes in the tests. */
export interface WordKit<V, N> {
  add(a: V, b: V): { interpolate(config: FadeConfig): N };
  multiply(a: V, b: N): N;
}

/**
 * The word's opacity: `on`, times the scroll faded out over the page after
 * the last photograph. Built once per page width.
 */
export function wordOpacity<V, N>(kit: WordKit<V, N>, scrollX: V, on: V, start: V, width: number): N {
  const fade = kit.add(scrollX, start).interpolate({ inputRange: [0, Math.max(1, width)], outputRange: [1, 0], extrapolate: "clamp" });
  return kit.multiply(on, fade);
}
