import { EARLIEST_PLAUSIBLE } from "@/darkroom/eligibility";
import { fullDate, yearsInWords } from "@/darkroom/labels";
import type { LibraryAccess } from "@/darkroom/access";
import type { Print, TimeRange } from "@/darkroom/types";

/**
 * The Post tab's rules, kept apart from the screen so they can be held to
 * their numbers without a phone: how big each part of the page is, how
 * the roll is read a bounded page at a time and merged, which photograph
 * is selected, and the words under it.
 *
 * The page, top to bottom: the doors (the Memory Room, On this day), the
 * selected photograph large on the camera's dark mount in the frame the
 * editor will give it, the ways row (RECENT, SHORT VIDEO, LIBRARY), then
 * the member's own photographs, newest first, four to a row.
 */

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** The first read of the roll: a page of the newest. */
export const ROLL_FIRST = 60;
/** Each read after that, as the roll is scrolled toward its end. At most MAX_PAGE (150). */
export const ROLL_PAGE = 120;
/** The roll holds no more than this; past it, the footer hands on to the Memory Room. */
export const ROLL_CAP = 1200;
/** The first read goes on, up to three pages, until at least this many are shown. */
export const ROLL_MIN_VISIBLE = 24;
/** Coming back to the tab reads the newest again only when the last read is older than this. */
export const ROLL_STALE_MS = 60_000;
/** The tab's photographs are let go this long after it is left. */
export const RELEASE_AFTER_BLUR_MS = 10_000;
/** A selection is kept across visits this long. */
export const KEEP_SELECTION_MS = 300_000;
/** A second tap on the selected photograph opens it only this long after it was selected: a quick double tap does not post. */
export const SECOND_TAP_MS = 400;
/** The editor's own clamp on a photograph's shape (app/compose.tsx, `previewRatio`). */
export const PREVIEW_MIN = 4 / 5;
export const PREVIEW_MAX = 1.91;
/** The mount takes half the page, within these. */
export const HERO_SHARE = 0.5;
export const HERO_MIN = 230;
export const HERO_MAX = 400;
/** The tab header (8 + 20 + 8) and the tab bar (its item and hairline), less the safe areas. */
const HEADER = 36;
const TAB_BAR = 44;
/** Rows of the roll, and the space between cells and rows. */
export const COLUMNS = 4;
export const GAP = 2;
/** Phones narrower than this get the smaller mount and doors without pictures. */
export const NARROW = 360;

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

/** The height between the tab header and the tab bar. */
export function pageHeight(windowH: number, insetTop: number, insetBottom: number): number {
  return windowH - (insetTop + HEADER) - (TAB_BAR + insetBottom);
}

/** The mount: half the page, never under 230 or over 400. */
export function heroHeight(pageH: number): number {
  return Math.min(HERO_MAX, Math.max(HERO_MIN, Math.round(HERO_SHARE * pageH)));
}

/** The mount's inset around the frame, the strip under it, and POST's height. */
export function heroMetrics(W: number): { mount: number; strip: number; button: number } {
  return W < NARROW ? { mount: 10, strip: 52, button: 36 } : { mount: 12, strip: 56, button: 40 };
}

/** A photograph's shape as the editor will frame it: 4:5 at the tallest, 1.91:1 at the widest. */
export function frameRatio(print: { width: number; height: number }): number {
  if (!(print.width > 0) || !(print.height > 0)) return 1;
  return Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, print.width / print.height));
}

/**
 * Where the selected photograph stands on the mount: as tall as the box
 * over the strip allows, narrower than the box's width, centred.
 */
export function heroFrame(
  print: { width: number; height: number },
  W: number,
  H: number,
): { left: number; top: number; width: number; height: number } {
  const { mount, strip } = heroMetrics(W);
  const boxW = W - 2 * mount;
  const boxH = H - mount - strip;
  const r = frameRatio(print);
  let height = boxH;
  let width = height * r;
  if (width > boxW) {
    width = boxW;
    height = boxW / r;
  }
  return { left: (W - width) / 2, top: mount + (boxH - height) / 2, width, height };
}

/** A cell of the roll: four to a row, two points between, edge to edge. */
export function cellSize(W: number): number {
  return (W - (COLUMNS - 1) * GAP) / COLUMNS;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type RollItem = { kind: "camera"; key: "camera" } | { kind: "print"; key: string; print: Print } | { kind: "well"; key: string };

export interface RollRow {
  key: string;
  items: RollItem[];
}

function chunk(items: RollItem[], columns: number): RollRow[] {
  const out: RollRow[] = [];
  for (let i = 0; i < items.length; i += columns) {
    const slice = items.slice(i, i + columns);
    out.push({ key: `row-${slice[0].key}`, items: slice });
  }
  return out;
}

/** The roll as rows of four, the camera first when asked for. */
export function rollRows(prints: readonly Print[], opts: { camera: boolean; columns?: number }): RollRow[] {
  const items: RollItem[] = [];
  if (opts.camera) items.push({ kind: "camera", key: "camera" });
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
  const older = prev.filter((p) => !ids.has(p.id) && p.takenAt < cut);
  return [...top, ...older];
}

/** The roll's end: more to read, the library's end reached, or the roll's cap. */
export type RollEnd = "more" | "done" | "capped";

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

// ---------------------------------------------------------------------------
// The Memory Room's door
// ---------------------------------------------------------------------------

/**
 * What the Memory Room's door carries: where the member left off, in
 * words, and the print they left off on with the one beside it; failing
 * that, the newest print set aside, alone; failing that, words alone. No
 * picture at all unless the library may be shown.
 */
export function roomDoorFace(
  placeLine: string | null,
  cover: { front: Print; back: Print | null } | null,
  newestShelf: Print | null,
  allowed: boolean,
): { line: string; front: Print | null; back: Print | null } {
  const line = placeLine ?? "Rediscover something worth sharing.";
  if (!allowed) return { line, front: null, back: null };
  if (cover) return { line, front: cover.front, back: cover.back };
  if (newestShelf) return { line, front: newestShelf, back: null };
  return { line, front: null, back: null };
}
