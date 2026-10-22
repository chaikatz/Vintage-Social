import { mulberry32 } from "@/utils/shuffle";
import { condense, editOccasion, EVENT_GAP_MS, isEligible, representative, SCENE_GAP_MS, spread } from "./eligibility";
import type { DayReach, LibrarySource, Print, TimeRange } from "./types";

/**
 * How the Darkroom finds things.
 *
 * Three ways into a library that may hold a hundred thousand photographs,
 * none of which ever reads the whole of it. Each asks the library small,
 * bounded questions — how many in this year, the next page of this
 * chapter, a few frames either side of this moment — and decides from
 * the answers, on the phone. The decisions are pure and seeded, so the
 * tests can hold them to their word.
 *
 *   On This Day   the same calendar date in earlier years, reaching out
 *                 to the week and then the time of year when the day
 *                 itself is thin. A sweep through the years, oldest
 *                 first, one from each year before a second from any.
 *   Surprise      one photograph at a time from anywhere older than the
 *                 last few months: a year drawn with a bias toward the
 *                 old and the sparse, a moment drawn inside it, the
 *                 nearest real frames read either side. Never the same
 *                 year twice running when there is another; never the
 *                 same occasion twice in a handful.
 *   A year        a chapter, in order: every occasion in it, each edited
 *                 to a few of its moments the way a contact sheet is
 *                 marked up.
 */

const DAY_MS = 86_400_000;
/** Newer than this is not a rediscovery yet. */
export const REDISCOVERY_AGE_DAYS = 90;
/** Dates before this are a missing date, not an old photograph. */
const EARLIEST_PLAUSIBLE = new Date(1900, 0, 1).getTime();

export interface YearCount {
  year: number;
  /** Photographs that year, screenshots left out. */
  count: number;
}

export function yearRange(year: number): TimeRange {
  return { from: new Date(year, 0, 1).getTime(), to: new Date(year + 1, 0, 1).getTime() };
}

/** Run `fn` over `items`, at most `size` at a time, keeping order. */
async function inBatches<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The contents page
// ---------------------------------------------------------------------------

/**
 * The years the library holds photographs in, oldest first, each with its
 * count. Decades are counted first and only the decades that hold
 * anything are opened year by year, so a library whose oldest scan is from
 * 1952 costs a few dozen counts, not two hundred.
 */
export async function yearIndex(source: LibrarySource, now = Date.now()): Promise<YearCount[]> {
  const oldest = await source.oldest();
  if (oldest == null) return [];
  const firstYear = new Date(Math.max(oldest, EARLIEST_PLAUSIBLE)).getFullYear();
  const lastYear = new Date(now).getFullYear();
  const decades: number[] = [];
  for (let d = Math.floor(firstYear / 10) * 10; d <= lastYear; d += 10) decades.push(d);
  const filled = (
    await inBatches(decades, 4, async (d) => ({
      d,
      n: await source.count({ from: new Date(d, 0, 1).getTime(), to: new Date(d + 10, 0, 1).getTime() }),
    }))
  ).filter((x) => x.n > 0);
  const years: number[] = [];
  for (const { d } of filled) for (let y = d; y < d + 10 && y <= lastYear; y++) if (y >= firstYear) years.push(y);
  const counts = await inBatches(years, 4, async (year) => {
    const range = yearRange(year);
    const [all, screenshots] = await Promise.all([source.count(range), source.count(range, "screenshot")]);
    return { year, count: Math.max(0, all - screenshots) };
  });
  return counts.filter((c) => c.count > 0);
}

// ---------------------------------------------------------------------------
// On this day
// ---------------------------------------------------------------------------

export interface DayResult {
  /** How far it had to reach: the day itself, the week around it, or the time of year. */
  reach: DayReach;
  prints: Print[];
}

const REACHES: { reach: DayReach; days: number }[] = [
  { reach: "day", days: 0 },
  { reach: "week", days: 3 },
  { reach: "season", days: 12 },
];

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Today's month and day in another year; the 29th of February falls on the 28th in a common year. */
export function anniversary(year: number, month: number, day: number): Date {
  if (month === 1 && day === 29 && !isLeap(year)) return new Date(year, 1, 28);
  return new Date(year, month, day);
}

/** From the start of the day `days` before the anniversary to the end of the day `days` after it. */
export function windowAround(year: number, month: number, day: number, days: number): TimeRange {
  const a = anniversary(year, month, day);
  return {
    from: new Date(a.getFullYear(), a.getMonth(), a.getDate() - days).getTime(),
    to: new Date(a.getFullYear(), a.getMonth(), a.getDate() + days + 1).getTime(),
  };
}

/** Take one from each list in turn, then a second from each, and so on. */
export function roundRobin<T>(lists: readonly T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

export async function onThisDay(
  source: LibrarySource,
  years: readonly YearCount[],
  { now = Date.now(), minimum = 4, perYear = 8 }: { now?: number; minimum?: number; perYear?: number } = {},
): Promise<DayResult> {
  const today = new Date(now);
  const earlier = years.map((y) => y.year).filter((y) => y < today.getFullYear()).sort((a, b) => a - b);
  let found: DayResult = { reach: "season", prints: [] };
  for (const { reach, days } of REACHES) {
    const perYearPrints = await inBatches(earlier, 4, async (year) => {
      const window = windowAround(year, today.getMonth(), today.getDate(), days);
      // The day itself is read in one go; a wider window in three slices,
      // so a heavy first day cannot crowd out the rest of the week.
      const slices = days === 0 ? [window] : thirds(window);
      const pages = await Promise.all(
        slices.map((range) => source.page({ range, first: days === 0 ? 150 : 50, order: "asc" })),
      );
      const frames = pages
        .flatMap((p) => p.prints)
        .filter(isEligible)
        .sort((a, b) => a.takenAt - b.takenAt);
      return spread(condense(frames), perYear);
    });
    const prints = roundRobin(perYearPrints.filter((l) => l.length > 0));
    found = { reach, prints };
    if (prints.length >= minimum) return found;
  }
  return found;
}

function thirds({ from, to }: TimeRange): TimeRange[] {
  const step = Math.ceil((to - from) / 3);
  return [0, 1, 2].map((i) => ({ from: from + i * step, to: Math.min(to, from + (i + 1) * step) }));
}

// ---------------------------------------------------------------------------
// Surprise
// ---------------------------------------------------------------------------

export interface SurpriseOptions {
  now?: number;
  seed: number;
  /** True for a photograph to pass over unless nothing else is left: seen lately, or already posted. */
  skip?: (id: string) => boolean;
}

/** Two picks closer than this are the same occasion. */
const SAME_OCCASION_MS = 6 * 3_600_000;
const OCCASION_MEMORY = 8;

export class Surprise {
  private readonly rand: () => number;
  private readonly pool: { year: number; range: TimeRange; weight: number }[];
  private readonly picked = new Set<string>();
  private readonly recent: Print[] = [];
  private readonly skip: (id: string) => boolean;
  /** Nothing more can be found, even with the skip list set aside. */
  exhausted = false;

  constructor(
    private readonly source: LibrarySource,
    years: readonly YearCount[],
    { now = Date.now(), seed, skip = () => false }: SurpriseOptions,
  ) {
    this.rand = mulberry32(seed);
    this.skip = skip;
    const ceiling = now - REDISCOVERY_AGE_DAYS * DAY_MS;
    const thisYear = new Date(now).getFullYear();
    this.pool = years
      .map((y) => {
        const r = yearRange(y.year);
        const range = { from: r.from, to: Math.min(r.to, ceiling) };
        const age = Math.min(12, thisYear - y.year);
        // The square root keeps a year of ten thousand from drowning a year
        // of forty; the age term leans, gently, toward the back of the drawer.
        return { year: y.year, range, weight: Math.sqrt(y.count) * (1 + 0.08 * age) };
      })
      .filter((y) => y.range.to > y.range.from && y.weight > 0);
    if (this.pool.length === 0) this.exhausted = true;
  }

  /** Up to `count` more photographs, each from a different moment than any before it. */
  async next(count: number): Promise<Print[]> {
    const out: Print[] = [];
    if (this.exhausted) return out;
    let attempts = 0;
    while (out.length < count && attempts < count * 6) {
      attempts++;
      const p = await this.pickOne(false);
      if (p) out.push(p);
    }
    // Everything nearby has been seen lately: let the skip list go rather
    // than come back empty-handed.
    attempts = 0;
    while (out.length < count && attempts < count * 3) {
      attempts++;
      const p = await this.pickOne(true);
      if (p) out.push(p);
    }
    if (out.length === 0) this.exhausted = true;
    return out;
  }

  private chooseYear(): { year: number; range: TimeRange } {
    const lastYears = this.recent.slice(-2).map((p) => new Date(p.takenAt).getFullYear());
    const avoid = this.pool.length >= 3 ? lastYears : this.pool.length === 2 ? lastYears.slice(-1) : [];
    const options = this.pool.filter((y) => !avoid.includes(y.year));
    const from = options.length > 0 ? options : this.pool;
    const total = from.reduce((n, y) => n + y.weight, 0);
    let r = this.rand() * total;
    for (const y of from) {
      r -= y.weight;
      if (r <= 0) return y;
    }
    return from[from.length - 1];
  }

  private async pickOne(relaxed: boolean): Promise<Print | null> {
    const { range } = this.chooseYear();
    const moment = Math.floor(range.from + this.rand() * (range.to - range.from));
    const before = await this.source.page({ range: { from: range.from, to: moment + 1 }, first: 40, order: "desc" });
    let frames = before.prints.filter(isEligible);
    if (frames.length < 6) {
      const after = await this.source.page({ range: { from: moment + 1, to: range.to }, first: 40, order: "asc" });
      frames = frames.concat(after.prints.filter(isEligible));
    }
    const moments = condense([...frames].sort((a, b) => a.takenAt - b.takenAt));
    const candidates = moments.filter(
      (p) =>
        !this.picked.has(p.id) &&
        (relaxed || !this.skip(p.id)) &&
        !this.recent.slice(-OCCASION_MEMORY).some((q) => Math.abs(q.takenAt - p.takenAt) < SAME_OCCASION_MS),
    );
    if (candidates.length === 0) return null;
    const chosen = candidates[Math.floor(this.rand() * candidates.length)];
    this.picked.add(chosen.id);
    this.recent.push(chosen);
    return chosen;
  }
}

// ---------------------------------------------------------------------------
// A year, as a chapter
// ---------------------------------------------------------------------------

/**
 * A year read in order, a page at a time, each occasion in it edited to a
 * few of its moments. Pages are read only as they are needed, so opening
 * a year of eight thousand photographs costs one page.
 */
export class YearChapter {
  private cursor: string | null = null;
  private ended = false;
  private scene: Print[] = [];
  private occasion: Print[] = [];
  private occasionLast = 0;
  private ready: Print[] = [];

  constructor(
    private readonly source: LibrarySource,
    readonly year: number,
    private readonly pageSize = 200,
  ) {}

  get done(): boolean {
    return this.ended && this.ready.length === 0;
  }

  async next(count: number): Promise<Print[]> {
    while (this.ready.length < count && !this.ended) await this.readPage();
    return this.ready.splice(0, count);
  }

  private async readPage(): Promise<void> {
    const page = await this.source.page({
      range: yearRange(this.year),
      first: this.pageSize,
      after: this.cursor,
      order: "asc",
    });
    for (const p of page.prints) if (isEligible(p)) this.feed(p);
    this.cursor = page.endCursor;
    if (!page.hasNextPage || page.prints.length === 0) {
      this.ended = true;
      this.closeScene();
      this.closeOccasion();
    }
  }

  private feed(p: Print): void {
    const last = this.scene[this.scene.length - 1];
    if (last && p.takenAt - last.takenAt > SCENE_GAP_MS) this.closeScene();
    this.scene.push(p);
  }

  private closeScene(): void {
    if (this.scene.length === 0) return;
    const first = this.scene[0];
    if (this.occasion.length > 0 && first.takenAt - this.occasionLast > EVENT_GAP_MS) this.closeOccasion();
    this.occasion.push(representative(this.scene));
    this.occasionLast = this.scene[this.scene.length - 1].takenAt;
    this.scene = [];
  }

  private closeOccasion(): void {
    if (this.occasion.length === 0) return;
    this.ready.push(...editOccasion(this.occasion));
    this.occasion = [];
  }
}
