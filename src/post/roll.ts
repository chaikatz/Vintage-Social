import { EARLIEST_PLAUSIBLE } from "@/darkroom/eligibility";
import { fullDate, yearsInWords } from "@/darkroom/labels";
import type { LibraryAccess } from "@/darkroom/access";
import type { Print, TimeRange } from "@/darkroom/types";

/**
 * The Post tab's rules, kept apart from the screen so they can be held to
 * their numbers without a phone: how big each part of the page is, how
 * the roll is read a bounded page at a time and merged, which photograph
 * is selected, and the words VoiceOver hears for it.
 *
 * The page is the owner's mock (390 × 797 points, the status bar cropped
 * off), measured, top to bottom: RECENT and MEMORY ROOM side by side in
 * the serif; the selected photograph large on the paper, in a 4:5 frame
 * 27 points in from either edge, with VINTAGE's date stamp on it as its
 * post will carry it; LIBRARY at the left and POST → at the right under
 * it; then the member's own photographs, newest first, four to a row,
 * edge to edge, the camera first.
 */

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** The first read of the roll: a page of the newest. */
export const ROLL_FIRST = 60;
/** Each read after that, as the roll is scrolled toward its end. At most MAX_PAGE (150). */
export const ROLL_PAGE = 120;
/** The roll holds no more than this; further back is the Memory Room's, one tap away in the header. */
export const ROLL_CAP = 1200;
/** The first read goes on, up to three pages, until at least this many are shown. */
export const ROLL_MIN_VISIBLE = 24;
/** Coming back to the tab reads the newest again only when the last read is older than this. */
export const ROLL_STALE_MS = 60_000;
/** The tab's photographs out of sight are let go this long after it is left. */
export const RELEASE_AFTER_BLUR_MS = 10_000;
/** A selection is kept across visits this long. */
export const KEEP_SELECTION_MS = 300_000;
/** A second tap on the selected photograph opens it only this long after it was selected: a quick double tap does not post. */
export const SECOND_TAP_MS = 400;
/** The editor's own clamp on a photograph's shape (app/compose.tsx, `previewRatio`). */
export const PREVIEW_MIN = 4 / 5;
export const PREVIEW_MAX = 1.91;
/** Phones narrower than this get the panels' smaller type. */
export const NARROW = 360;

// ---------------------------------------------------------------------------
// The mock, measured
// ---------------------------------------------------------------------------

/**
 * The header's band, from the top of the safe area to the top of the
 * photograph's frame: the two words are centred in it (their caps from
 * 21 to 34 in the mock, Recent from x 82, Memory Room to x 307).
 */
export const HEADER_BAND = 56;
/** TabHeader's own band (8 + the 17-point title + 8), which the words share with the other tabs' titles. */
export const TAB_HEADER = 36;
/** The rest of the band, drawn by the Post tab itself under TabHeader, so the frame starts where the mock's does. */
export const HEADER_BELOW = HEADER_BAND - TAB_HEADER;
/** The two words: the serif at 20 points, 20 apart (the mock's 22 between the inks, less the side bearings), centred as a pair. */
export const HEAD_WORDS = { size: 20, gap: 20 } as const;
/** The photograph's frame: 27 points in from either edge (x 27 to 363 at 390), 4:5 (420 tall). */
export const FRAME_INSET = 27;
export const FRAME_RATIO = 4 / 5;
/** From the frame's foot to the roll's top (y 476 to 522): LIBRARY and POST centred in it. */
export const LINE_HEIGHT = 46;
/**
 * The line's type, in the typewriter: LIBRARY at 10 points, 4.5 apart
 * (a letter every 10.5 points, caps 6 tall), in the soft ink; POST in
 * bold at 11, 5.1 apart (every 11.7, caps 7 tall), in ink, and its arrow
 * 12 points long with a head 9 tall, 9 points past POST's own spacing
 * (15 from the T), ending on the frame's right edge.
 */
export const LINE_TYPE = {
  library: { size: 10, tracking: 4.5 },
  post: { size: 11, tracking: 5.1 },
  arrow: { length: 12, head: 4.5, stroke: 1.25, gap: 9 },
  /** LIBRARY and the clip's way beside it. */
  between: 22,
} as const;
/** The roll: four square columns, 2 points between (96 at 390). */
export const COLUMNS = 4;
export const GAP = 2;
/** The selected cell's rust border, drawn inside it so nothing shifts (3 points in the mock). */
export const SELECTED_BORDER = 3;
/** The camera tile: the paper, a 1-point line in the strong border's colour, and the camera's mark, 20 points across. */
export const CAMERA_LINE = 1;
export const CAMERA_MARK = 20;
/** The tab bar: its item and hairline, less the safe area. */
export const TAB_BAR = 49;

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

/** Recent's height: between the header's band and the tab bar. */
export function recentHeight(windowH: number, insetTop: number, insetBottom: number): number {
  return windowH - insetTop - HEADER_BAND - TAB_BAR - insetBottom;
}

/** A cell of the roll: four to a row, two points between, edge to edge. */
export function cellSize(W: number): number {
  return (W - (COLUMNS - 1) * GAP) / COLUMNS;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The photograph's frame on a phone `W` wide, with `recentH` between the
 * header and the tab bar: 27 points in from either edge and 4:5, as the
 * mock has it (336 × 420 at 390). Only on a phone too short to show a
 * full row of the roll under it and the line (a 320 × 568 iPhone SE) is
 * it made smaller, still 4:5 and centred, so the roll always begins on
 * the first screen.
 */
export function previewFrame(W: number, recentH: number): Box {
  const full = Math.max(0, W - 2 * FRAME_INSET);
  const tallest = recentH - LINE_HEIGHT - (cellSize(W) + GAP);
  const height = Math.max(0, Math.min(full / FRAME_RATIO, tallest > 0 ? tallest : full / FRAME_RATIO));
  const width = height * FRAME_RATIO;
  return { left: (W - width) / 2, top: 0, width, height };
}

/** A photograph's shape as the editor will frame it: 4:5 at the tallest, 1.91:1 at the widest. */
export function frameRatio(print: { width: number; height: number }): number {
  if (!(print.width > 0) || !(print.height > 0)) return 1;
  return Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, print.width / print.height));
}

/**
 * Where the photograph stands in the frame: at the shape the editor will
 * post it, as wide as the frame, centred up and down. A portrait fills
 * the frame; a square or a landscape stands in the middle of it on the
 * paper, so nothing under the frame moves when the selection does.
 */
export function photoRect(print: { width: number; height: number }, frame: Pick<Box, "width" | "height">): Box {
  const r = frameRatio(print);
  let width = frame.width;
  let height = width / r;
  if (height > frame.height) {
    height = frame.height;
    width = height * r;
  }
  return { left: (frame.width - width) / 2, top: (frame.height - height) / 2, width, height };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type RollItem =
  | { kind: "camera"; key: "camera" }
  | { kind: "more"; key: "more" }
  | { kind: "print"; key: string; print: Print }
  | { kind: "well"; key: string };

export interface RollRow {
  key: string;
  items: RollItem[];
}

/**
 * Rows are named by their place, not by their first photograph: a
 * photograph arriving at the top moves every other one a cell along, and
 * a row named by its first would be a new row each time, every
 * photograph on the screen made again. Named by place, a row stays, and
 * only the one photograph in each that crosses into the next is made
 * again; the cells inside are named by their photographs.
 */
function chunk(items: RollItem[], columns: number): RollRow[] {
  const out: RollRow[] = [];
  for (let i = 0; i < items.length; i += columns) {
    out.push({ key: `row-${i / columns}`, items: items.slice(i, i + columns) });
  }
  return out;
}

/**
 * The rows on the screen, one either side to spare, from where the roll
 * is scrolled to: what stays drawn when the tab lets the rest of its
 * photographs go, so the page is as it was whenever it is seen again.
 * `header` is the height above the first row (the photograph's frame and
 * the line under it), `row` a row's height with the space under it.
 */
export function rowsInSight(p: { offset: number; header: number; viewport: number; row: number; margin?: number }): {
  first: number;
  last: number;
} {
  const margin = p.margin ?? 1;
  if (!(p.row > 0) || !(p.viewport > 0)) return { first: 0, last: Number.POSITIVE_INFINITY };
  const top = Math.max(0, p.offset) - p.header;
  const bottom = Math.max(0, p.offset) + p.viewport - p.header;
  return { first: Math.max(0, Math.floor(top / p.row) - margin), last: Math.max(-1, Math.ceil(bottom / p.row) - 1 + margin) };
}

/**
 * The roll as rows of four: the camera first when asked for, then, under
 * a limited selection (`more`), the way to share more, then the
 * photographs.
 */
export function rollRows(prints: readonly Print[], opts: { camera: boolean; more?: boolean; columns?: number }): RollRow[] {
  const items: RollItem[] = [];
  if (opts.camera) items.push({ kind: "camera", key: "camera" });
  if (opts.more) items.push({ kind: "more", key: "more" });
  for (const p of prints) items.push({ kind: "print", key: p.id, print: p });
  return chunk(items, opts.columns ?? COLUMNS);
}

/** Three rows of empty wells, the camera first when asked for: what stands where the roll will be. */
export function wellRows(opts: { camera: boolean; columns?: number }): RollRow[] {
  const columns = opts.columns ?? COLUMNS;
  const items: RollItem[] = [];
  if (opts.camera) items.push({ kind: "camera", key: "camera" });
  while (items.length < columns * 3) items.push({ kind: "well", key: `well-${items.length}` });
  return chunk(items, columns);
}

// ---------------------------------------------------------------------------
// Reading the roll
// ---------------------------------------------------------------------------

/**
 * What the roll shows of what was read. With the whole library open,
 * screenshots are left out, as the Memory Room leaves them out; with a
 * limited selection everything shows, since the member chose each one.
 */
export function visibleOf(prints: readonly Print[], access: LibraryAccess | null): Print[] {
  if (access !== "full") return [...prints];
  return prints.filter((p) => !p.subtypes.includes("screenshot"));
}

/** The first page: the newest, anything up to a day ahead of the phone's clock. */
export function firstRange(now: number): TimeRange {
  return { from: EARLIEST_PLAUSIBLE, to: now + DAY_MS };
}

/**
 * The stretch the next page is read from: everything older than the
 * oldest read so far, that millisecond included, so frames sharing it are
 * not skipped (the merge drops the ones read twice). `stepPast` leaves
 * that millisecond out, for when a page brought nothing new: so the roll
 * always moves on, and never asks the same question twice.
 */
export function nextRange(prints: readonly Print[], stepPast = false): TimeRange | null {
  const oldest = prints[prints.length - 1];
  if (!oldest) return null;
  return { from: EARLIEST_PLAUSIBLE, to: stepPast ? oldest.takenAt : oldest.takenAt + 1 };
}

const newestFirst = (a: Print, b: Print) => b.takenAt - a.takenAt;

/** An older page added to the roll, each photograph once, newest first. */
export function mergeOlder(prev: readonly Print[], page: readonly Print[]): { prints: Print[]; added: number } {
  const ids = new Set(prev.map((p) => p.id));
  const fresh = page.filter((p) => {
    if (ids.has(p.id)) return false;
    ids.add(p.id);
    return true;
  });
  if (fresh.length === 0) return { prints: [...prev], added: 0 };
  return { prints: [...prev, ...fresh].sort(newestFirst), added: fresh.length };
}

/**
 * The newest page read again. It replaces the stretch it covers, so a
 * photograph deleted inside it drops out and a new one comes in; the
 * older photographs below it are kept as they were. A page that holds
 * the whole library replaces all of it.
 */
export function mergeNewest(prev: readonly Print[], page: { prints: readonly Print[]; hasNextPage: boolean }): Print[] {
  const top = [...page.prints].sort(newestFirst);
  if (!page.hasNextPage) return top;
  const cut = top[top.length - 1]?.takenAt;
  if (cut == null) return [...prev];
  const ids = new Set(top.map((p) => p.id));
  // The cut's own millisecond included: a photograph sharing it that the page left out is kept.
  const older = prev.filter((p) => !ids.has(p.id) && p.takenAt <= cut);
  return [...top, ...older];
}

/** The roll's end: more to read, the library's end reached, or the roll's cap. */
export type RollEnd = "more" | "done" | "capped";

/**
 * What the tab has let go of its photographs: nothing; those out of
 * sight (ten seconds after it is left, at once in the background), the
 * rows on the screen and the frame staying drawn so the page is the same
 * whenever it is seen again; or all of them (before it is first in
 * front, and on a memory warning while it is not).
 */
export type Release = "none" | "unseen" | "all";

/** Read again on focus only when the last read is a minute old, or the library was heard to change. */
export function shouldRefresh(lastReadAt: number | null, now: number, heard: boolean): boolean {
  if (heard || lastReadAt == null) return true;
  return now - lastReadAt > ROLL_STALE_MS;
}

// ---------------------------------------------------------------------------
// The selection
// ---------------------------------------------------------------------------

/**
 * Which photograph is selected: the one before, while it is still in the
 * roll and was left less than five minutes ago (`at` is when it was last
 * in front of the member); otherwise the newest.
 */
export function keepSelection(sel: { id: string; at: number } | null, prints: readonly Print[], now: number): string | null {
  if (sel && now - sel.at < KEEP_SELECTION_MS && prints.some((p) => p.id === sel.id)) return sel.id;
  return prints[0]?.id ?? null;
}

/**
 * A read from the top brought a photograph newer than the newest shown
 * before it — one just taken, or just shared with VINTAGE: it is the one
 * the member came for, so it is selected, as it would be on a first visit.
 */
export function newerArrived(
  before: Pick<Print, "id" | "takenAt"> | null | undefined,
  newest: Pick<Print, "id" | "takenAt"> | null | undefined,
): boolean {
  if (!before || !newest) return false;
  return newest.id !== before.id && newest.takenAt > before.takenAt;
}

/**
 * Where the selection goes once the photograph it stood on has been
 * posted from this phone (`postedAt`, when): the newest that has not
 * been, else the newest, so the frame never sits offering the same
 * photograph again.
 */
export function afterPosting(
  sel: { id: string; at: number } | null,
  prints: readonly Print[],
  postedAt: (id: string) => number | null,
): string | null | undefined {
  if (!sel) return undefined;
  const at = postedAt(sel.id);
  if (at == null || at < sel.at) return undefined;
  return (prints.find((p) => postedAt(p.id) == null) ?? prints[0])?.id ?? null;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** Calendar days between two local dates, whatever the clocks did in between. */
function daysApart(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / DAY_MS);
}

/** Whole calendar months between two dates, a month counted only once its day has come round. */
function monthsApart(a: Date, b: Date): number {
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return b.getDate() < a.getDate() ? months - 1 : months;
}

/** Whole years, counted by the anniversary, as the room's captions count them. */
function yearsApart(a: Date, b: Date): number {
  let years = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) years -= 1;
  return years;
}

function ago(n: number, one: string, many: string): string {
  return n === 1 ? `One ${one} ago` : `${yearsInWords(n)} ${many} ago`;
}

/**
 * How long ago a photograph was taken, in words, with no full stop, as
 * the room's captions are: "Today", "Yesterday", "Three days ago", "Two
 * weeks ago", "Five months ago", "Six years ago". Days by the calendar,
 * months and years by their anniversary. A date ahead of the phone's
 * clock reads "Today".
 */
export function ageWords(takenAt: number, now: number): string {
  const then = new Date(takenAt);
  const today = new Date(now);
  const days = daysApart(then, today);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${yearsInWords(days)} days ago`;
  const years = yearsApart(then, today);
  if (years >= 1) return ago(years, "year", "years");
  const months = monthsApart(then, today);
  if (months >= 1) return ago(months, "month", "months");
  return ago(Math.min(4, Math.floor(days / 7)), "week", "weeks");
}

/** What VoiceOver says for a cell: "Photograph, October 14, 2019, 6:42 PM". */
export function cellLabel(print: Pick<Print, "takenAt">): string {
  const d = new Date(print.takenAt);
  const hours = d.getHours();
  const time = `${hours % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  return `Photograph, ${fullDate(print.takenAt)}, ${time}`;
}
