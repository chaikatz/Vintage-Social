/**
 * Dragging a print from one era to another while arranging (EraList),
 * the arithmetic of it kept apart from the component so it can be read,
 * and tested, without a phone: which era is under the finger, and how
 * fast the page runs on while the finger is held near its top or foot,
 * once the finger has meant it to.
 *
 * All of it in points. "The view" is the part of the screen the page
 * scrolls in, and a finger's place in it is measured from its top. A
 * chapter's place is in the page's own terms, from the top of all it
 * holds, measured as the print is lifted; it does not move as the page
 * scrolls under the finger, and the drag changes nothing that would move
 * it.
 */

/** How long a print is held before it lifts: a beat past a tap, well short of a long press anywhere else. */
export const LIFT_MS = 250;
/** How much larger a lifted print is drawn. */
export const LIFT_SCALE = 1.05;
/** How near the top of the view (under the bar) or its foot the finger is before the page runs on. */
export const EDGE = 72;
/** How fast the page runs on, in points a second, with the finger at the edge itself or past it. */
export const EDGE_SPEED = 960;
/** How far on toward the top or the foot a finger that lifted a print near it goes before the page runs on there. */
export const ARM = 24;
/** The longest step taken at once, so a slow frame never throws the page on. */
export const STEP_MS = 48;

/** Where an era's chapter lies in the page. */
export interface ChapterBox {
  key: string;
  top: number;
  height: number;
}

/** The page as it lies under a lifted print. */
export interface DragPage {
  /** Each era's chapter, where it lies in the page. */
  chapters: readonly ChapterBox[];
  /** The bar over the chapters: where it lies in the page before it holds to the top, and how tall it is. */
  bar: { top: number; height: number } | null;
  /** How far the page is scrolled. */
  offset: number;
  /** How tall the view is. */
  height: number;
}

/** Where the bar is in the view: in its place on the page, or held to the top once the page has scrolled past it. */
export function barInView(bar: { top: number; height: number }, offset: number): { top: number; bottom: number } {
  const top = Math.max(bar.top - offset, 0);
  return { top, bottom: top + bar.height };
}

/** The era whose chapter holds `y`, a place in the page; null above, below or between them. */
export function chapterUnder(chapters: readonly ChapterBox[], y: number): string | null {
  for (const chapter of chapters) {
    if (y >= chapter.top && y < chapter.top + chapter.height) return chapter.key;
  }
  return null;
}

/**
 * The era under a finger `y` points down the view. Null outside the view,
 * and over the bar, which hides whatever part of a chapter lies under it.
 */
export function eraUnderFinger(page: DragPage, y: number): string | null {
  if (!(y >= 0 && y < page.height)) return null;
  if (page.bar) {
    const bar = barInView(page.bar, page.offset);
    if (y >= bar.top && y < bar.bottom) return null;
  }
  return chapterUnder(page.chapters, y + page.offset);
}

/** Where a print let go goes: the era under the finger, unless it is the one the print is in, or there is none. */
export function dropTarget(from: string, under: string | null): string | null {
  return under != null && under !== from ? under : null;
}

/**
 * How fast the page runs on, in points a second: up (less than nothing)
 * with the finger near the top of the view, which begins under the bar
 * (`top`); down near its foot (`bottom`); still in between. In proportion
 * to how far into the edge the finger is, and `most` once it is at the
 * edge or past it. In a view too short for two edges, each takes half.
 */
export function edgeSpeed(y: number, view: { top: number; bottom: number }, edge = EDGE, most = EDGE_SPEED): number {
  const zone = Math.max(1, Math.min(edge, (view.bottom - view.top) / 2));
  const up = (view.top + zone - y) / zone;
  if (up > 0) return -most * Math.min(1, up);
  const down = (y - (view.bottom - zone)) / zone;
  if (down > 0) return most * Math.min(1, down);
  return 0;
}

/** How far the finger has gone above and below where the print lifted, at the most, in points. */
export interface Reach {
  up: number;
  down: number;
}

/** The reach once the finger is at `y`, having lifted the print at `from`. */
export function reached(reach: Reach, from: number, y: number): Reach {
  return { up: Math.max(reach.up, from - y), down: Math.max(reach.down, y - from) };
}

/**
 * How fast the page runs on with the finger at `y`, as edgeSpeed has it,
 * but only at an edge the finger has armed since the print lifted at
 * `from`: by being clear of that edge at some time since, where it lifted
 * included, or by going on ARM toward it. So a print lifted in the top
 * row under the bar, or in the last row, sets nothing running the moment
 * it is held, and the finger can settle; moved away and back, or on
 * toward the edge, it runs. `reach` is how far the finger has gone above
 * and below `from`.
 */
export function armedSpeed(y: number, from: number, reach: Reach, view: { top: number; bottom: number }): number {
  const speed = edgeSpeed(y, view);
  // The farthest the finger has been from each edge: the lowest it went, from the top; the highest, from the foot.
  if (speed < 0) return reach.up >= ARM || edgeSpeed(from + reach.down, view) >= 0 ? speed : 0;
  if (speed > 0) return reach.down >= ARM || edgeSpeed(from - reach.up, view) <= 0 ? speed : 0;
  return 0;
}

/**
 * Where the page is scrolled to next: `offset` run on at `speed` for `ms`
 * (no more than STEP_MS of it), never above the top nor past `end`, as far
 * as it scrolls. It stops at either end; it is never pulled back from past
 * one, so a page that has just grown shorter does not jump.
 */
export function scrolledTo(offset: number, speed: number, ms: number, end: number): number {
  const step = (speed * Math.min(Math.max(ms, 0), STEP_MS)) / 1000;
  if (step > 0) return Math.max(offset, Math.min(offset + step, end));
  if (step < 0) return Math.min(offset, Math.max(offset + step, 0));
  return offset;
}

/** What a lifted print says while it is over another era. */
export function dropLabel(title: string): string {
  return `Move to ${title}`;
}
