import { mulberry32 } from "@/utils/shuffle";
import {
  AGE_LEAN,
  AGE_LEAN_YEARS,
  ATTEMPTS_PER_STEP,
  BARREN_LIMIT,
  BUILD_AHEAD_MONTHS,
  byTime,
  condense,
  DAY_DIRECT_YEARS,
  DAY_FIRST,
  DAY_MS,
  DAY_OVERFLOW_FIRST,
  DAY_OVERFLOW_SLICE_MS,
  DAY_REACHES,
  EARLIEST_PLAUSIBLE,
  EDIT_GAP_MS,
  EDIT_MAX,
  EDIT_MIN,
  EDIT_QUIET_DAYS,
  EDIT_SCALE,
  EPOCH_GUARD_MS,
  isEligible,
  isLostDate,
  MAX_IN_FLIGHT,
  MOMENT_GAP_MS,
  OCCASION_MEMORY,
  ON_THIS_DAY_CAP,
  ON_THIS_DAY_MINIMUM,
  PER_YEAR,
  PER_YEAR_GAP_MS,
  PILE_SHOWN,
  pileKey,
  POOL_MIN_COUNT,
  quality,
  QUIET_LADDER,
  READ_ACROSS_GAP_MS,
  READ_AROUND,
  READ_AROUND_ENOUGH,
  READ_FAR_MS,
  READ_NEAR_MS,
  REDISCOVERY_AGE_DAYS,
  REFERENCE_DATE,
  ROLL_LENGTH,
  SAME_OCCASION_MS,
  sameMoment,
  shapeOf,
  SLICE_FIRST,
  WIDE_FIRST,
  WIDE_SLICES,
} from "./eligibility";
import type { DayReach, LibrarySource, Page, Print, TimeRange } from "./types";

export { ON_THIS_DAY_MINIMUM, REDISCOVERY_AGE_DAYS, ROLL_LENGTH } from "./eligibility";

/**
 * How the Darkroom finds things.
 *
 * Three ways into a library that may hold a hundred thousand photographs,
 * none of which ever reads the whole of it. Each asks the library small,
 * bounded questions — how many in this year (a count, which reads no
 * photographs at all), the first few of this stretch of time, a few
 * frames either side of this moment — and decides from the answers, on
 * the phone. There are no cursors: a stretch of time cannot be deleted
 * out from under a chapter. The decisions are pure and seeded, so the
 * tests can hold them to their word.
 *
 *   On This Day   the same calendar date in earlier years, reaching out
 *                 to the week and then the time of year when the day
 *                 itself is thin. A few from each year, spread through
 *                 it; one from every year, oldest first, before a second
 *                 from any.
 *   Surprise      rolls of twenty-four from anywhere older than the last
 *                 few months: a year drawn with a lean toward the old,
 *                 a moment drawn inside it, the nearest real frames read
 *                 either side. Never the same year twice running when
 *                 there is another, never the same occasion twice in a
 *                 handful, and never stuck: each rule eases, one at a
 *                 time, before the Darkroom says it has nothing left.
 *   By year       an edit, not the whole year: about 2.5·√N prints,
 *                 shared among the months by the square root of how many
 *                 each holds, each the best of its own slice of time.
 *
 * Every question passes through one gate per library, so however many
 * chapters are asking at once, no more than four are outstanding.
 */

// ---------------------------------------------------------------------------
// The library, asked politely
// ---------------------------------------------------------------------------

const gates = new WeakMap<LibrarySource, LibrarySource>();

/**
 * The library with no more than `MAX_IN_FLIGHT` questions outstanding at
 * once, shared by everything that asks it. Photos answers each fetch on
 * its own queue; asking it forty things at the same moment only makes the
 * first answer later. A slot that comes free goes straight to the next in
 * line, so a newcomer can never slip in ahead and make it five.
 */
export function gated(source: LibrarySource): LibrarySource {
  const known = gates.get(source);
  if (known) return known;
  let active = 0;
  const waiting: (() => void)[] = [];
  const take = (): Promise<void> => {
    if (active < MAX_IN_FLIGHT) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const give = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  const ask = async <T>(question: () => Promise<T>): Promise<T> => {
    await take();
    try {
      return await question();
    } finally {
      give();
    }
  };
  const gate: LibrarySource = {
    count: (range, subtype) => ask(() => source.count(range, subtype)),
    page: (request) => ask(() => source.page(request)),
    oldest: () => ask(() => source.oldest()),
  };
  gates.set(source, gate);
  gates.set(gate, gate);
  return gate;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** A calendar year as the phone's own calendar has it, local midnight to local midnight. */
export function yearRange(year: number): TimeRange {
  return { from: new Date(year, 0, 1).getTime(), to: new Date(year + 1, 0, 1).getTime() };
}

function monthRange(year: number, month: number): TimeRange {
  return { from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime() };
}

/** `n` equal slices of a range, end to end. */
function split({ from, to }: TimeRange, n: number): TimeRange[] {
  const parts = Math.max(1, Math.floor(n));
  const step = (to - from) / parts;
  return Array.from({ length: parts }, (_, i) => ({
    from: i === 0 ? from : Math.round(from + i * step),
    to: i === parts - 1 ? to : Math.round(from + (i + 1) * step),
  }));
}

/** The calendar years the library spans, the clamp at 1900 included; null when it is empty. */
function yearSpan(oldest: number | null, now: number): { first: number; last: number } | null {
  if (oldest == null || !Number.isFinite(oldest)) return null;
  const first = new Date(Math.max(oldest, EARLIEST_PLAUSIBLE)).getFullYear();
  const last = new Date(now).getFullYear();
  return first <= last ? { first, last } : null;
}

function years(first: number, last: number): number[] {
  return last < first ? [] : Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/** The instants a lost date is stamped with: the first of January 1970, give or take a time zone, and Photos' reference date. */
const PLACEHOLDERS: readonly TimeRange[] = [
  { from: -EPOCH_GUARD_MS, to: EPOCH_GUARD_MS + 1 },
  { from: REFERENCE_DATE, to: REFERENCE_DATE + 1 },
];

/** How many photographs in a range carry a lost date: one count for each placeholder instant the range touches, none for the rest. */
async function lostIn(lib: LibrarySource, range: TimeRange): Promise<number> {
  const placeholders = PLACEHOLDERS.map((p) => ({ from: Math.max(p.from, range.from), to: Math.min(p.to, range.to) })).filter(
    (p) => p.to > p.from,
  );
  const lost = await Promise.all(placeholders.map((p) => lib.count(p)));
  return lost.reduce((a, b) => a + b, 0);
}

/**
 * Of these years, the ones in a decade that holds any photograph: one
 * count per decade, and the lost dates in it counted and left out, so a
 * single photograph stamped with the first of January 1970 does not open
 * ten empty years of the 1970s.
 */
async function inFilledDecades(lib: LibrarySource, list: readonly number[]): Promise<number[]> {
  if (list.length === 0) return [];
  const decades = years(Math.floor(list[0] / 10), Math.floor(list[list.length - 1] / 10)).map((d) => d * 10);
  const filled = await Promise.all(
    decades.map(async (d) => {
      const range = { from: yearRange(d).from, to: yearRange(d + 10).from };
      const [all, lost] = await Promise.all([lib.count(range), lostIn(lib, range)]);
      return all - lost > 0 ? d : null;
    }),
  );
  const keep = new Set(filled.filter((d): d is number => d != null));
  return list.filter((y) => keep.has(Math.floor(y / 10) * 10));
}

/**
 * Photographs in a range, screenshots left out: two counts, no
 * photographs read. A range that touches one of the placeholder dates
 * has what lies there counted and left out too, so the contents never
 * offers a "1970" whose only photograph is a lost date that no chapter
 * will show.
 */
async function photographs(lib: LibrarySource, range: TimeRange): Promise<number> {
  const [all, screenshots, lost] = await Promise.all([lib.count(range), lib.count(range, "screenshot"), lostIn(lib, range)]);
  return Math.max(0, all - screenshots - lost);
}

const yearOf = (p: Print) => new Date(p.takenAt).getFullYear();

// ---------------------------------------------------------------------------
// The contents page
// ---------------------------------------------------------------------------

export interface YearCount {
  year: number;
  /** Photographs that year, screenshots left out. */
  count: number;
}

/**
 * The years the library holds photographs in, oldest first, each with its
 * count. Decades are counted first and only the decades that hold
 * anything are opened year by year, so a library whose oldest scan is from
 * 1952 costs a few dozen counts, not two hundred. Years before 1970 are
 * counted like any other — and, unlike in the first version, shown too.
 * `oldest`, when the caller already has it, saves asking the library for
 * it again: that question sorts every photograph the library holds.
 */
export async function yearIndex(source: LibrarySource, now = Date.now(), oldest?: number | null): Promise<YearCount[]> {
  const lib = gated(source);
  const span = yearSpan(oldest !== undefined ? oldest : await lib.oldest(), now);
  if (!span) return [];
  const list = await inFilledDecades(lib, years(span.first, span.last));
  const counts = await Promise.all(list.map(async (year) => ({ year, count: await photographs(lib, yearRange(year)) })));
  return counts.filter((c) => c.count > 0);
}

/** One year's months, January first, each with its count; asked only for the year open. */
export async function monthIndex(source: LibrarySource, year: number): Promise<number[]> {
  const lib = gated(source);
  return Promise.all(Array.from({ length: 12 }, (_, m) => photographs(lib, monthRange(year, m))));
}

// ---------------------------------------------------------------------------
// On this day
// ---------------------------------------------------------------------------

export interface DayResult {
  /** How far it had to reach: the day itself, the week around it, or the time of year. */
  reach: DayReach;
  /** In the order they are shown: one from each year, oldest first, then the rest. */
  prints: Print[];
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Today's month and day in another year; the 29th of February falls on the 28th in a common year. */
export function anniversary(year: number, month: number, day: number): Date {
  if (month === 1 && day === 29 && !isLeap(year)) return new Date(year, 1, 28);
  return new Date(year, month, day);
}

/** From the start of the day `days` before a date to the end of the day `days` after it, in local time. */
function around(date: Date, days: number): TimeRange {
  return {
    from: new Date(date.getFullYear(), date.getMonth(), date.getDate() - days).getTime(),
    to: new Date(date.getFullYear(), date.getMonth(), date.getDate() + days + 1).getTime(),
  };
}

/** Calendar days between a print and a date, whatever the clocks did in between. */
function daysFrom(p: Print, date: Date): number {
  const d = new Date(p.takenAt);
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round(Math.abs(a - b) / DAY_MS);
}

/**
 * The years to look in when the year index has not been read: every year
 * from the oldest photograph's to last year. Only `oldest()` is asked, so
 * the first print does not wait for forty counts — and not even that
 * when the caller already knows it. An oldest date that is itself a lost
 * one says nothing about where the library begins, so its decades are
 * counted however short the span.
 */
async function yearsBack(lib: LibrarySource, now: number, known?: number | null): Promise<number[]> {
  const oldest = known !== undefined ? known : await lib.oldest();
  const span = yearSpan(oldest, now);
  if (oldest == null || !span) return [];
  const list = years(span.first, span.last - 1);
  return list.length <= DAY_DIRECT_YEARS && !isLostDate(oldest) ? list : inFilledDecades(lib, list);
}

/**
 * One anniversary day. Usually a single page holds all of it. A day that
 * holds more — a wedding, a first day in a new city — is read on from
 * where that page stopped in slices of three hours, each from its own
 * start, so every three hours of the day that holds a photograph is
 * represented and the afternoon is never lost to the morning.
 */
async function readDay(lib: LibrarySource, day: TimeRange): Promise<Print[]> {
  const page = await lib.page({ range: day, first: DAY_FIRST, order: "asc" });
  if (!page.hasNextPage || page.prints.length === 0) return page.prints;
  const reached = page.prints[page.prints.length - 1].takenAt;
  const rest = { from: Math.floor(reached) + 1, to: day.to };
  if (rest.from >= rest.to) return page.prints;
  const slices = split(rest, Math.ceil((rest.to - rest.from) / DAY_OVERFLOW_SLICE_MS));
  const more = await Promise.all(slices.map((range) => lib.page({ range, first: DAY_OVERFLOW_FIRST, order: "asc" })));
  return page.prints.concat(...more.map((p) => p.prints));
}

/** A week or a season, in equal slices, so a heavy first day cannot crowd out the rest. */
async function readWide(lib: LibrarySource, window: TimeRange): Promise<Print[]> {
  const pages = await Promise.all(
    split(window, WIDE_SLICES).map((range) => lib.page({ range, first: WIDE_FIRST, order: "asc" })),
  );
  return pages.flatMap((p) => p.prints);
}

/**
 * Up to `limit` of a group, each at least `PER_YEAR_GAP_MS` from every one
 * already chosen. The first is the group's middle moment; each after it
 * is the one furthest from all those chosen, which spreads the picks
 * through the day rather than bunching them where most frames were taken.
 */
function spreadApart(group: readonly Print[], chosen: Print[]): void {
  const left = [...group];
  while (chosen.length < PER_YEAR && left.length > 0) {
    let best = -1;
    if (chosen.length === 0) {
      best = Math.floor((left.length - 1) / 2);
    } else {
      let furthest = -1;
      left.forEach((p, i) => {
        const nearest = Math.min(...chosen.map((c) => Math.abs(c.takenAt - p.takenAt)));
        if (nearest >= PER_YEAR_GAP_MS && nearest > furthest) {
          furthest = nearest;
          best = i;
        }
      });
    }
    if (best < 0) return;
    chosen.push(left.splice(best, 1)[0]);
  }
}

/**
 * One year's share: at most four of its moments, at least 45 minutes
 * apart, the anniversary's own day first, then the days of its week, then
 * the rest of the season — so a trip the days before never crowds out the
 * two photographs taken on the day itself.
 */
function chooseForYear(moments: readonly Print[], date: Date): Print[] {
  const chosen: Print[] = [];
  let nearer = -1;
  for (const { days } of DAY_REACHES) {
    spreadApart(
      moments.filter((p) => {
        const d = daysFrom(p, date);
        return d > nearer && d <= days;
      }),
      chosen,
    );
    nearer = days;
  }
  return chosen.sort(byTime);
}

/** Sweep one: each year's middle moment, oldest year first. Sweep two: the rest, oldest year first, each in time order. */
function sweep(perYear: readonly Print[][]): Print[] {
  const first: Print[] = [];
  const second: Print[] = [];
  for (const picks of perYear) {
    if (picks.length === 0) continue;
    const middle = Math.floor((picks.length - 1) / 2);
    first.push(picks[middle]);
    picks.forEach((p, i) => {
      if (i !== middle) second.push(p);
    });
  }
  return [...first, ...second].slice(0, ON_THIS_DAY_CAP);
}

/**
 * The same calendar date in every earlier year.
 *
 * The day itself is read first. Only when every year together yields
 * fewer than three moments does it reach out to the week, and then to
 * the season; what a narrower reach found is carried into the wider one,
 * so widening never loses the day. `maxReach` stops it early: the room's
 * first decision asks only whether the day itself holds enough, and can
 * then turn to Surprise without waiting for two wider sweeps it would
 * throw away.
 *
 * Seen history is ignored here — the date is the reason to look again.
 * `oldest`, when the caller already has it (null for an empty library),
 * is used instead of asking the library again, which would put a second
 * sort of the whole library in front of the first anniversary page.
 */
export async function onThisDay(
  source: LibrarySource,
  opts: { now?: number; years?: readonly number[] | null; maxReach?: DayReach; oldest?: number | null } = {},
): Promise<DayResult> {
  const now = opts.now ?? Date.now();
  const lib = gated(source);
  const today = new Date(now);
  const list =
    opts.years != null
      ? [...new Set(opts.years)]
          .filter((y) => Number.isInteger(y) && y < today.getFullYear() && y >= new Date(EARLIEST_PLAUSIBLE).getFullYear())
          .sort((a, b) => a - b)
      : await yearsBack(lib, now, opts.oldest);
  const widest = Math.max(0, DAY_REACHES.findIndex((r) => r.reach === (opts.maxReach ?? "season")));
  let found: Print[][] = list.map(() => []);
  let reach: DayReach = DAY_REACHES[0].reach;
  for (let i = 0; i <= widest; i++) {
    const tier = DAY_REACHES[i];
    reach = tier.reach;
    const carried = found;
    found = await Promise.all(
      list.map(async (year, k) => {
        const date = anniversary(year, today.getMonth(), today.getDate());
        const window = around(date, tier.days);
        const frames = tier.days === 0 ? await readDay(lib, window) : await readWide(lib, window);
        const usable = frames.filter((p) => isEligible(p, { now }));
        return chooseForYear(condense([...usable, ...carried[k]]), date);
      }),
    );
    if (found.reduce((n, l) => n + l.length, 0) >= ON_THIS_DAY_MINIMUM) break;
  }
  return { reach, prints: sweep(found) };
}

/**
 * Whether the room opens on On This Day: the day itself, not the week
 * around it, holds at least three moments. The same three that stop
 * On This Day from reaching further, so the two can never disagree.
 */
export function opensOnThisDay(day: DayResult | null | undefined): boolean {
  return day != null && day.reach === "day" && day.prints.length >= ON_THIS_DAY_MINIMUM;
}

// ---------------------------------------------------------------------------
// Surprise me
// ---------------------------------------------------------------------------

export interface SurpriseOptions {
  now?: number;
  seed: number;
  /** When the oldest photograph was taken, for the picks dealt before the year index is known. */
  oldest: number | null;
  /** The year index, if it is already known; otherwise given later through `setYears`. */
  years?: readonly YearCount[] | null;
  /** History: seen within this many days. The window narrows, 21 → 10 → 5 → 0, when nothing else is left. */
  seenWithin: (id: string, days: number) => boolean;
  /** Developed within a year, or set aside: the member knows where those are. */
  held: (id: string) => boolean;
  /** Already shown this visit (a restored roll, or the roll before this one). */
  exclude?: Iterable<string>;
  /** A restored roll's prints count toward its twenty-four. */
  alreadyDealt?: number;
}

/** Somewhere to draw a moment from: a calendar year, or (before the years are counted) the whole library's span. */
interface Bed {
  year: number | null;
  range: TimeRange;
  weight: number;
  /** Fewer photographs than a pool year needs; drawn from only when nothing else is left. */
  tiny: boolean;
  /** The year index's count, when the bed is a year; unknown for the cold bed. */
  count?: number;
  /** Put away for the visit: read end to end, or every stretch of it learned, and nothing usable found. */
  dry: boolean;
  /** Stretches of the range a read has shown to hold no eligible photograph: in order, never overlapping. */
  empty: TimeRange[];
}

/** A stretch now known to hold nothing eligible, added to a bed's list, with the stretches it meets merged into it. */
function markEmpty(bed: Bed, from: number, to: number): void {
  let merged = { from: Math.max(from, bed.range.from), to: Math.min(to, bed.range.to) };
  if (!(merged.to > merged.from)) return;
  const rest: TimeRange[] = [];
  for (const e of bed.empty) {
    if (e.to < merged.from || e.from > merged.to) rest.push(e);
    else merged = { from: Math.min(e.from, merged.from), to: Math.max(e.to, merged.to) };
  }
  rest.push(merged);
  bed.empty = rest.sort((a, b) => a.from - b.from);
}

/**
 * What one read shows about where nothing eligible lies. A page holds
 * every frame between the moment and the last frame it returned, so the
 * stretch between the moment and the nearest eligible frame is empty for
 * the Darkroom's purposes — a moment drawn there would only find that
 * same frame again — and so is the stretch beyond the furthest one, when
 * the page reached the end of the window it read (`range`), which is the
 * most a read can say: what lies past the window was not asked about.
 */
function learn(bed: Bed, side: "before" | "after", moment: number, range: TimeRange, page: Page, eligible: readonly Print[]): void {
  const last = page.prints[page.prints.length - 1];
  const times = eligible.map((p) => p.takenAt);
  if (side === "before") {
    if (times.length === 0) {
      markEmpty(bed, page.hasNextPage && last ? Math.floor(last.takenAt) + 1 : range.from, moment + 1);
      return;
    }
    markEmpty(bed, Math.floor(Math.max(...times)) + 1, moment + 1);
    if (!page.hasNextPage) markEmpty(bed, range.from, Math.min(...times));
  } else {
    if (times.length === 0) {
      markEmpty(bed, moment + 1, page.hasNextPage && last ? last.takenAt : range.to);
      return;
    }
    markEmpty(bed, moment + 1, Math.min(...times));
    if (!page.hasNextPage) markEmpty(bed, Math.floor(Math.max(...times)) + 1, range.to);
  }
}

/** Which rule emptied a try: nothing usable at all, all seen lately, or all near a recent pick. */
type Miss = "barren" | "quiet" | "near";

/** One pick's tries so far: the rules eased for it, and the beds that keep coming up empty. */
interface Eased {
  /** Year avoidance and the year cap. */
  spread: boolean;
  /** The six-hour rule. */
  apart: boolean;
  /** Years with one or two photographs. */
  tiny: boolean;
  /** Tries in a row, this pick, that found nothing usable at all in a bed, whatever the rules. */
  barren: Map<Bed, number>;
}

/** One side of a drawn moment, as read: its eligible frames, nearest first, and whether the read reached the bed's end with nothing left over. */
interface Side {
  eligible: Print[];
  whole: boolean;
}

/**
 * Surprise me, as finite rolls of twenty-four.
 *
 * Each pick chooses a year (by weight, avoiding the last two picks' years
 * and any year that has had its share of the roll), draws a moment
 * uniformly inside it — over the parts not yet known to be empty — and
 * reads the nearest frames before it, and after it too when those are
 * thin or the moment fell in a gap. It chooses among their moments by
 * quality. A candidate is never one already shown this visit, one
 * developed within the year or set aside, or a third from one import
 * pile. It is preferably not one seen in the last 21 days, not within six
 * hours of the last eight picks, and, after two of one shape, of the
 * other shape.
 *
 * Six tries at each step. When they fail, the rule that was in the way
 * eases — the quiet window halves for the rest of the roll; the year
 * rules or the six-hour rule step aside for this one pick; the smallest
 * years are let in — and it tries again. Years read end to end and found
 * empty are put away, so a library of two tiny years and two large ones
 * never spends its tries on the tiny ones; a year that keeps coming up
 * empty is passed over for the rest of the pick, never the visit. Only
 * when the years are known, every rule has eased and nothing at all is
 * left is the visit `exhausted`.
 *
 * Every read keeps to a window of time around the drawn moment, a month
 * and then at most a year either side, so no question grows with the
 * library — not even before the years are counted, when the bed is the
 * library's whole span.
 */
export class Surprise {
  private readonly lib: LibrarySource;
  private readonly now: number;
  private readonly ceiling: number;
  private readonly seenWithin: (id: string, days: number) => boolean;
  private readonly held: (id: string) => boolean;
  private rand: () => number;
  private readonly picked = new Set<string>();
  /** The last few picks of the visit, newest last. */
  private readonly recent: Print[] = [];
  private readonly perPile = new Map<number, number>();
  private yearPicks = new Map<number, number>();
  private beds: Bed[] | null = null;
  private readonly cold: Bed | null = null;
  private dealt: number;
  private quiet = QUIET_LADDER[0];
  private isExhausted = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(source: LibrarySource, opts: SurpriseOptions) {
    this.lib = gated(source);
    this.now = opts.now ?? Date.now();
    this.ceiling = this.now - REDISCOVERY_AGE_DAYS * DAY_MS;
    this.seenWithin = opts.seenWithin;
    this.held = opts.held;
    this.rand = mulberry32(opts.seed);
    for (const id of opts.exclude ?? []) this.picked.add(id);
    this.dealt = Math.min(ROLL_LENGTH, Math.max(0, Math.floor(opts.alreadyDealt ?? 0)));
    if (opts.oldest != null && Number.isFinite(opts.oldest)) {
      const from = Math.max(opts.oldest, EARLIEST_PLAUSIBLE);
      if (from < this.ceiling) {
        this.cold = { year: null, range: { from, to: this.ceiling }, weight: 1, tiny: false, dry: false, empty: [] };
      }
    }
    if (opts.years) this.setYears(opts.years);
  }

  /** Twenty-four dealt: the end page comes next. */
  get rollDone(): boolean {
    return this.dealt >= ROLL_LENGTH;
  }

  /**
   * Nothing left to deal, even with every rule eased and a quiet window of
   * no days at all. Never said before the year index is known: until then
   * the picks draw on the library's whole span, and an empty draw there
   * only means the years must be counted first.
   */
  get exhausted(): boolean {
    return this.isExhausted;
  }

  /** The year index, once it has been read. Years already found empty stay put away. */
  setYears(list: readonly YearCount[]): void {
    const thisYear = new Date(this.now).getFullYear();
    const before = new Map((this.beds ?? []).map((b) => [b.year, b]));
    const beds: Bed[] = [];
    for (const { year, count } of list) {
      if (!(count > 0)) continue;
      const r = yearRange(year);
      const range = { from: Math.max(r.from, EARLIEST_PLAUSIBLE), to: Math.min(r.to, this.ceiling) };
      if (range.to <= range.from) continue;
      // The square root keeps a year of ten thousand from drowning a year
      // of forty; the age term leans, gently, toward the back of the drawer.
      const age = Math.max(0, thisYear - year);
      const weight = Math.sqrt(count) * (1 + AGE_LEAN * Math.min(age, AGE_LEAN_YEARS));
      const known = before.get(year);
      beds.push({
        year,
        range,
        weight,
        tiny: count < POOL_MIN_COUNT,
        count,
        dry: known?.dry ?? false,
        empty: known?.empty ?? [],
      });
    }
    this.beds = beds;
    if (beds.some((b) => !b.dry)) this.isExhausted = false;
  }

  /**
   * Up to `count` more prints, never past the end of the roll. Calls are
   * taken one at a time, in order, so the deal for a seed is always the
   * same deal. With no oldest date to start cold from and no years yet,
   * there is nowhere to draw from: it deals nothing, and is not exhausted,
   * until `setYears` arrives. Nor is it exhausted when the cold start
   * comes up short: it deals what it found and waits for the years.
   */
  next(count: number): Promise<Print[]> {
    const run = this.queue.then(() => this.deal(count));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * A new roll with a new seed. What this visit has shown stays excluded,
   * the year shares and the quiet window start again. Meant for the end
   * page, when nothing is being dealt.
   */
  anotherRoll(seed: number): void {
    this.rand = mulberry32(seed);
    this.dealt = 0;
    this.yearPicks = new Map();
    this.quiet = QUIET_LADDER[0];
    this.isExhausted = false;
  }

  private async deal(count: number): Promise<Print[]> {
    const out: Print[] = [];
    if (this.beds === null && this.cold === null) return out;
    while (out.length < count && !this.rollDone && !this.isExhausted) {
      const p = await this.pickOne();
      if (!p) {
        // Before the years are known an empty pick means "not yet": the
        // room counts the years and asks again.
        if (this.beds !== null) this.isExhausted = true;
        break;
      }
      this.record(p);
      out.push(p);
    }
    return out;
  }

  private record(p: Print): void {
    this.picked.add(p.id);
    this.recent.push(p);
    if (this.recent.length > OCCASION_MEMORY) this.recent.shift();
    const year = yearOf(p);
    this.yearPicks.set(year, (this.yearPicks.get(year) ?? 0) + 1);
    const pile = pileKey(p);
    this.perPile.set(pile, (this.perPile.get(pile) ?? 0) + 1);
    this.dealt += 1;
  }

  private async pickOne(): Promise<Print | null> {
    const eased: Eased = { spread: false, apart: false, tiny: false, barren: new Map() };
    let misses = new Set<Miss>();
    let tries = 0;
    for (;;) {
      const bed = this.chooseBed(eased);
      if (!bed) {
        if (eased.tiny) return null;
        eased.tiny = true;
        continue;
      }
      const result = await this.attempt(bed, eased);
      if (typeof result !== "string") return result;
      misses.add(result);
      tries += 1;
      if (tries < ATTEMPTS_PER_STEP) continue;
      tries = 0;
      if (!this.ease(eased, misses)) return null;
      misses = new Set();
    }
  }

  /**
   * Ease one rule — the one the failed tries ran into, where that is
   * clear — and say whether there was one left to ease. The quiet window
   * stays eased for the rest of the roll, as the history it guards is
   * the same for every pick; the others only for this pick.
   */
  private ease(eased: Eased, misses: ReadonlySet<Miss>): boolean {
    const quieter = () => {
      this.quiet = QUIET_LADDER[QUIET_LADDER.indexOf(this.quiet) + 1] ?? 0;
    };
    if (misses.has("quiet") && this.quiet > 0) quieter();
    else if (misses.has("near") && !eased.apart) eased.apart = true;
    else if (!eased.spread) eased.spread = true;
    else if (!eased.apart) eased.apart = true;
    else if (this.quiet > 0) quieter();
    else if (!eased.tiny) eased.tiny = true;
    else return false;
    return true;
  }

  /**
   * Where the next moment is drawn from. Until the years have been
   * counted, the whole span of the library, which needs no count at all;
   * a span that keeps coming up empty this pick gives way, and the pick
   * waits for the years. Once they are known, a year, by weight — the
   * index has already left out the lost dates and weighs a year of one
   * stray photograph by the root of one, so an outlier dated 1904 cannot
   * pull the picks to the library's first month the way a draw over the
   * whole span can. The year avoids the last picks' years and any year
   * that has had its share of this roll; when those rules leave nothing,
   * the share gives way first and then the avoidance, so a pool of one or
   * two years still deals.
   */
  private chooseBed(eased: Eased): Bed | null {
    const passed = (b: Bed) => (eased.barren.get(b) ?? 0) >= BARREN_LIMIT;
    if (this.beds === null) return this.cold && !this.cold.dry && !passed(this.cold) ? this.cold : null;
    const live = this.beds.filter((b) => !b.dry && (eased.tiny || !b.tiny));
    if (live.length === 0) return null;
    // A year that keeps coming up empty steps aside for the rest of this
    // pick while another is left; only when none is left is it tried
    // again, so a pick never ends while a year still has unread time.
    const fresh = live.filter((b) => !passed(b));
    const pool = fresh.length > 0 ? fresh : live;
    let options = pool;
    if (!eased.spread) {
      const avoidCount = pool.length >= 3 ? 2 : pool.length === 2 ? 1 : 0;
      const avoid = new Set(this.recent.slice(this.recent.length - avoidCount).map(yearOf));
      const share = Math.max(2, Math.ceil(ROLL_LENGTH / pool.length) + 1);
      const apart = pool.filter((b) => !avoid.has(b.year!));
      const within = apart.filter((b) => (this.yearPicks.get(b.year!) ?? 0) < share);
      options = within.length > 0 ? within : apart.length > 0 ? apart : pool;
    }
    return this.weighted(options, (b) => b.weight);
  }

  /**
   * A moment drawn uniformly over the bed's range, leaving out the
   * stretches already known to hold nothing eligible — so a year whose
   * photographs all date from one fortnight in April is drawn from that
   * fortnight after a read or two, not eleven times out of twelve from
   * the empty months either side of it. Null when nothing is left.
   */
  private drawIn(bed: Bed): number | null {
    const open: TimeRange[] = [];
    let cursor = bed.range.from;
    for (const e of bed.empty) {
      if (e.from > cursor) open.push({ from: cursor, to: e.from });
      cursor = Math.max(cursor, e.to);
    }
    if (cursor < bed.range.to) open.push({ from: cursor, to: bed.range.to });
    const total = open.reduce((n, o) => n + (o.to - o.from), 0);
    if (total < 1) return null;
    let r = Math.floor(this.rand() * total);
    for (const o of open) {
      const length = o.to - o.from;
      if (r < length) return Math.floor(o.from + r);
      r -= length;
    }
    return Math.floor(open[open.length - 1].to - 1);
  }

  /** One try: a moment drawn inside the bed, the frames either side of it read, and a pick, or the reason there was none. */
  private async attempt(bed: Bed, eased: Eased): Promise<Print | Miss> {
    const moment = this.drawIn(bed);
    if (moment == null) {
      bed.dry = true;
      return "barren";
    }
    const before = await this.readSide(bed, "before", moment);
    let frames = before.eligible;
    let readAll = before.whole;
    let found = this.candidates(frames, eased);
    // Thin before the moment, nothing there that may be shown, or the
    // moment fell in a gap: read the far side too. In a small year the two
    // sides are the whole year, and an empty answer then means the year
    // is empty.
    const nearest = frames.length > 0 ? frames[0].takenAt : -Infinity;
    const thin = frames.length < READ_AROUND_ENOUGH || typeof found === "string" || moment - nearest > READ_ACROSS_GAP_MS;
    if (thin && moment + 1 < bed.range.to) {
      const after = await this.readSide(bed, "after", moment);
      frames = frames.concat(after.eligible);
      readAll = readAll && after.whole;
      found = this.candidates(frames, eased);
    }
    if (typeof found !== "string") {
      eased.barren.delete(bed);
      return this.weighted(found, quality);
    }
    if (found === "barren") {
      eased.barren.set(bed, (eased.barren.get(bed) ?? 0) + 1);
      // Only a bed read end to end is put away. One that merely came up
      // empty a few times running has learned where it is empty, and its
      // next draw keeps to the rest.
      if (readAll) bed.dry = true;
    } else {
      eased.barren.delete(bed);
    }
    return found;
  }

  /**
   * The nearest frames on one side of a moment, within a window of time:
   * a month, and a year when the month was read to its end and held too
   * few eligible frames to choose from. Never past the bed's own ends,
   * and never further than a year, however far those are — a moment in a
   * long gap finds nothing, the gap it read is learned, and the next draw
   * keeps out of it.
   */
  private async readSide(bed: Bed, side: "before" | "after", moment: number): Promise<Side> {
    const eligible = (p: Print) => isEligible(p, { now: this.now });
    let read: Side = { eligible: [], whole: false };
    // A year too sparse for a month to hold enough to choose from would
    // only cost the month's read before the year's: go straight to the year.
    const sparse =
      bed.count != null &&
      (bed.count * READ_NEAR_MS) / Math.max(1, bed.range.to - bed.range.from) < 2 * READ_AROUND_ENOUGH;
    for (const reach of sparse ? [READ_FAR_MS] : [READ_NEAR_MS, READ_FAR_MS]) {
      const range =
        side === "before"
          ? { from: Math.max(bed.range.from, moment + 1 - reach), to: moment + 1 }
          : { from: moment + 1, to: Math.min(bed.range.to, moment + 1 + reach) };
      const page = await this.lib.page({ range, first: READ_AROUND, order: side === "before" ? "desc" : "asc" });
      const frames = page.prints.filter(eligible);
      learn(bed, side, moment, range, page, frames);
      const atEnd = side === "before" ? range.from <= bed.range.from : range.to >= bed.range.to;
      read = { eligible: frames, whole: atEnd && !page.hasNextPage };
      if (page.hasNextPage || atEnd || frames.length >= READ_AROUND_ENOUGH) break;
    }
    return read;
  }

  /** The moments among these frames that may be dealt now, paced by shape; or which rule left none. */
  private candidates(frames: readonly Print[], eased: Eased): Print[] | Miss {
    const usable = condense(frames).filter(
      (p) => !this.picked.has(p.id) && !this.held(p.id) && (this.perPile.get(pileKey(p)) ?? 0) < PILE_SHOWN,
    );
    if (usable.length === 0) return "barren";
    const days = this.quiet;
    const quiet = days > 0 ? usable.filter((p) => !this.seenWithin(p.id, days)) : usable;
    if (quiet.length === 0) return "quiet";
    const recent = this.recent.slice(-OCCASION_MEMORY);
    const apart = eased.apart
      ? quiet
      : quiet.filter((p) => recent.every((r) => Math.abs(r.takenAt - p.takenAt) >= SAME_OCCASION_MS));
    if (apart.length === 0) return "near";
    return this.paced(apart);
  }

  /** After two of one shape, only the other shapes — when there is one to choose. */
  private paced(list: Print[]): Print[] {
    if (this.recent.length < 2) return list;
    const shape = shapeOf(this.recent[this.recent.length - 1]);
    if (shapeOf(this.recent[this.recent.length - 2]) !== shape) return list;
    const other = list.filter((p) => shapeOf(p) !== shape);
    return other.length > 0 ? other : list;
  }

  private weighted<T>(list: readonly T[], weight: (item: T) => number): T {
    const total = list.reduce((n, item) => n + weight(item), 0);
    let r = this.rand() * total;
    for (const item of list) {
      r -= weight(item);
      if (r < 0) return item;
    }
    return list[list.length - 1];
  }
}

// ---------------------------------------------------------------------------
// By year: an edit
// ---------------------------------------------------------------------------

/** The edit of a year of `n` photographs: about 2.5·√n, at least 12 or all of a smaller year, at most 120, never more than the year. */
export function editSize(n: number): number {
  if (!(n > 0)) return 0;
  const count = Math.floor(n);
  const e = Math.round(EDIT_SCALE * Math.sqrt(count));
  return Math.min(count, Math.min(EDIT_MAX, Math.max(Math.min(count, EDIT_MIN), e)));
}

/**
 * An edit's prints shared among the months, in proportion to the square
 * root of each month's count, by largest remainder: a month of four
 * hundred gets twice the share of a month of a hundred, not four times.
 * Every month with photographs gets at least one, and the shares add up
 * to `e`. (Should `e` be smaller than the number of months with
 * photographs, the fullest months get one each.)
 */
export function monthSlots(months: readonly number[], e: number): number[] {
  const counts = Array.from({ length: 12 }, (_, m) => Math.max(0, months[m] ?? 0));
  const slots = counts.map(() => 0);
  const total = Math.max(0, Math.floor(e));
  const filled = counts.map((c, m) => m).filter((m) => counts[m] > 0);
  if (total === 0 || filled.length === 0) return slots;
  if (total < filled.length) {
    const fullest = [...filled].sort((a, b) => counts[b] - counts[a] || a - b).slice(0, total);
    for (const m of fullest) slots[m] = 1;
    return slots;
  }
  const roots = counts.map((c) => Math.sqrt(c));
  const sum = roots.reduce((a, b) => a + b, 0);
  const quota = roots.map((r) => (total * r) / sum);
  quota.forEach((q, m) => {
    slots[m] = Math.floor(q);
  });
  let left = total - slots.reduce((a, b) => a + b, 0);
  const byRemainder = filled
    .map((m) => m)
    .sort((a, b) => quota[b] - slots[b] - (quota[a] - slots[a]) || counts[b] - counts[a] || a - b);
  for (const m of byRemainder) {
    if (left === 0) break;
    slots[m] += 1;
    left -= 1;
  }
  for (const m of filled) {
    if (slots[m] > 0) continue;
    // A month that rounded down to nothing takes one from the month most over its share.
    let donor = -1;
    for (const d of filled) {
      if (slots[d] < 2) continue;
      if (donor < 0 || slots[d] - quota[d] > slots[donor] - quota[donor]) donor = d;
    }
    // There always is one while `e` covers every month that has photographs.
    if (donor < 0) break;
    slots[donor] -= 1;
    slots[m] = 1;
  }
  return slots;
}

interface Slice {
  range: TimeRange;
  /** The edit prefers the moment nearest this. */
  middle: number;
}

/**
 * A month's `s` slots as `s` equal slices of its time. Shifted (for MORE
 * FROM), the boundaries between slices move half a slice later, and each
 * slice prefers the moment nearest where an unshifted edit put its
 * boundary — so the second edit's picks fall between the first's.
 */
function monthSlices(month: TimeRange, s: number, shifted: boolean): Slice[] {
  const width = (month.to - month.from) / s;
  const at = (x: number) => Math.round(month.from + x * width);
  const bounds = [month.from];
  for (let j = 1; j < s; j++) bounds.push(at(shifted ? j + 0.5 : j));
  bounds.push(month.to);
  return bounds.slice(0, -1).map((from, j) => {
    const range = { from, to: bounds[j + 1] };
    const middle = shifted ? Math.min(range.to - 1, Math.max(range.from, at(j + 1))) : at(j + 0.5);
    return { range, middle };
  });
}

export interface YearEditOptions {
  now?: number;
  /** `monthIndex()` for the year: twelve counts. */
  months: readonly number[];
  /** Open at this month (0–11) rather than January. */
  fromMonth?: number;
  /** The print the caption thread came from: it takes its own slice's place, and the edit opens at its month. */
  pin?: Print | null;
  /** MORE FROM: everything this year has already shown this visit. */
  exclude?: Iterable<string>;
  /** MORE FROM: slices shifted by half their width. */
  shifted?: boolean;
  seenWithin: (id: string, days: number) => boolean;
}

/**
 * A year as an edit, the way a contact sheet is marked up: not every
 * frame, but a few from every stretch of it, in order, January to
 * December.
 *
 * Each month's share of the edit is read as that many slices of its time,
 * one page each. From each slice comes its best moment — not seen lately,
 * then the weightiest, then the one nearest the middle of the slice —
 * kept two hours from the pick before it where it can be. A slice with
 * nothing passes its slot to the next slice of the month; a slot still
 * unused at the end of the month is dropped. Months are built only as
 * they are needed, with two ready ahead of the one being read, so opening
 * a year of eight thousand photographs costs a handful of pages.
 */
export class YearEdit {
  /** E: how many prints the whole year's edit holds. */
  readonly size: number;
  /** N: how many photographs the year holds. */
  readonly yearCount: number;
  private readonly lib: LibrarySource;
  private readonly year: number;
  private readonly now: number;
  private readonly slots: number[];
  private readonly shifted: boolean;
  private readonly seenWithin: (id: string, days: number) => boolean;
  private readonly allowRecent: boolean;
  private readonly pin: Print | null;
  private readonly shown = new Set<string>();
  /** When this edit's picks were taken, for the two-hour rule. */
  private readonly times: number[] = [];
  private readonly ready: Print[] = [];
  /** The next month to build. */
  private month: number;
  /** The month of the last print handed out. */
  private reading: number;
  private handed = 0;
  private pinAt: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(source: LibrarySource, year: number, opts: YearEditOptions) {
    this.lib = gated(source);
    this.year = year;
    this.now = opts.now ?? Date.now();
    this.shifted = Boolean(opts.shifted);
    this.seenWithin = opts.seenWithin;
    const months = Array.from({ length: 12 }, (_, m) => Math.max(0, Math.floor(opts.months[m] ?? 0)));
    this.yearCount = months.reduce((a, b) => a + b, 0);
    this.size = editSize(this.yearCount);
    this.slots = monthSlots(months, this.size);
    const range = yearRange(year);
    // The one place photographs from the last few months appear: a year
    // that reaches into them — this year, or last year in January.
    this.allowRecent = range.to > this.now - REDISCOVERY_AGE_DAYS * DAY_MS;
    const pin = opts.pin && opts.pin.takenAt >= range.from && opts.pin.takenAt < range.to ? opts.pin : null;
    const pinMonth = pin ? new Date(pin.takenAt).getMonth() : null;
    const from = Math.min(11, Math.max(0, Math.floor(opts.fromMonth ?? pinMonth ?? 0)));
    this.pin = pin && pinMonth != null && pinMonth >= from ? pin : null;
    if (this.pin && pinMonth != null && this.slots[pinMonth] === 0) this.slots[pinMonth] = 1;
    for (const id of opts.exclude ?? []) this.shown.add(id);
    this.month = from;
    this.reading = from;
    this.skipEmptyMonths();
  }

  /** Every month built and every print handed out. */
  get done(): boolean {
    return this.month > 11 && this.ready.length === 0;
  }

  /** Where the pinned print falls in this edit's sequence, once its month is built: the chapter's starting index. */
  get pinIndex(): number | null {
    return this.pinAt;
  }

  /**
   * Up to `count` more prints, in order. Builds only what is needed to
   * answer, then keeps two months ready beyond the one being read, in the
   * background; a failure there is left for the next call to meet.
   */
  next(count: number): Promise<Print[]> {
    const run = this.queue.then(() => this.deal(count));
    this.queue = run.then(
      () => this.buildAhead().catch(() => undefined),
      () => undefined,
    );
    return run;
  }

  private async deal(count: number): Promise<Print[]> {
    while (this.ready.length < count && this.month <= 11) await this.buildNext();
    const out = this.ready.splice(0, Math.max(0, count));
    this.handed += out.length;
    if (out.length > 0) this.reading = new Date(out[out.length - 1].takenAt).getMonth();
    return out;
  }

  private async buildAhead(): Promise<void> {
    while (this.month <= 11 && this.month <= this.reading + BUILD_AHEAD_MONTHS) await this.buildNext();
  }

  private skipEmptyMonths(): void {
    while (this.month <= 11 && this.slots[this.month] === 0) this.month += 1;
  }

  /** The next month, read and chosen. A failed read leaves the month to be built again. */
  private async buildNext(): Promise<void> {
    const m = this.month;
    const slices = monthSlices(monthRange(this.year, m), this.slots[m], this.shifted);
    const pages = await Promise.all(
      slices.map((slice) => this.lib.page({ range: slice.range, first: SLICE_FIRST, order: "asc" })),
    );
    const usable = pages.map((page) =>
      page.prints.filter((p) => isEligible(p, { now: this.now, allowRecent: this.allowRecent })),
    );
    // MORE FROM: a moment that holds a print this visit has already shown
    // is left out whole, whichever slice its frames fell in. Leaving out
    // only the shown frame would let the rest of its burst stand in for
    // it, and the member would see the same photograph again.
    const all = usable.flat();
    const spoken = all.some((p) => this.shown.has(p.id)) ? sameMoment(all, (p) => this.shown.has(p.id)) : null;
    const picks: Print[] = [];
    const take = (p: Print) => {
      picks.push(p);
      this.shown.add(p.id);
      this.times.push(p.takenAt);
    };
    let carried = 0;
    slices.forEach((slice, i) => {
      let want = 1 + carried;
      const pin = this.pin;
      const pinned = pin != null && pin.takenAt >= slice.range.from && pin.takenAt < slice.range.to;
      let frames = usable[i];
      if (pinned) {
        // The print the member came from takes its slice's place, and its
        // own moment goes with it.
        take(pin);
        want -= 1;
        frames = frames.filter((p) => p.id !== pin.id && Math.abs(p.takenAt - pin.takenAt) > MOMENT_GAP_MS);
      }
      // Condensed before the shown are taken out, so a moment is the same
      // moment it was when it was shown, and its representative the same frame.
      const moments = condense(frames).filter((m) => !this.shown.has(m.id) && !spoken?.has(m.id));
      while (want > 0) {
        const best = this.best(moments, slice.middle);
        if (!best) break;
        moments.splice(moments.indexOf(best), 1);
        take(best);
        want -= 1;
      }
      carried = want;
    });
    picks.sort(byTime);
    if (this.pin) {
      const at = picks.findIndex((p) => p.id === this.pin!.id);
      if (at >= 0) this.pinAt = this.handed + this.ready.length + at;
    }
    this.ready.push(...picks);
    this.month = m + 1;
    this.skipEmptyMonths();
  }

  /** A slice's best moment: two hours from the edit's other picks where it can be; then unseen, weightiest, nearest the middle. */
  private best(moments: readonly Print[], middle: number): Print | null {
    if (moments.length === 0) return null;
    const apart = moments.filter((p) => this.times.every((t) => Math.abs(t - p.takenAt) >= EDIT_GAP_MS));
    const pool = apart.length > 0 ? apart : moments;
    let best: Print | null = null;
    let key: [number, number, number] = [Infinity, Infinity, Infinity];
    for (const p of pool) {
      const k: [number, number, number] = [
        this.seenWithin(p.id, EDIT_QUIET_DAYS) ? 1 : 0,
        -quality(p),
        Math.abs(p.takenAt - middle),
      ];
      if (k[0] < key[0] || (k[0] === key[0] && (k[1] < key[1] || (k[1] === key[1] && k[2] < key[2])))) {
        best = p;
        key = k;
      }
    }
    return best;
  }
}
