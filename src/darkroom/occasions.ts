import { readAll } from "./discovery";
import { byTime, EARLIEST_PLAUSIBLE, isEligible, MAX_PAGE, quality } from "./eligibility";
import { fullDate, monthName } from "./labels";
import type { LibrarySource, Print, Span, TimeRange } from "./types";

/**
 * Lately, and the occasions of a library.
 *
 * Contents lists, under LATELY, this week, last weekend and this month;
 * and under OCCASIONS the stretches of days on end that hold many
 * photographs — a weekend away, a wedding, a fortnight in Lisbon — newest
 * first, each with a cover and a count. All of it is worked out on the
 * phone from the dates the library already gives. Nothing here looks at
 * a pixel, and nothing is sent anywhere.
 *
 *   An occasion   days that each hold at least five photographs, no more
 *                 than one quiet day apart, twelve or more photographs in
 *                 all, and never longer than a fortnight. A day runs to
 *                 four in the morning, so a night out stays one day.
 *   Its name      plainly its dates — "June 14, 2024", "June 12–15,
 *                 2024", "June 30 – July 2, 2024" — or, where the place
 *                 is known, the place and the month: "Lisbon · June 2024".
 *
 * The library is read newest first, a page at a time, a stretch of time at
 * a time, only as far as Contents asks: a first read finds this month and
 * the first few occasions, and each EARLIER OCCASIONS reads on from there.
 * What one read finds is kept for the session (`Occasions`), so opening
 * Contents again reads nothing.
 *
 * The rules (`occasionsIn`, `lately`, `occasionTitle`) are pure, so the
 * tests can hold them to their word.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY_MS = 24 * HOUR;

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/** A day of an occasion holds at least this many photographs. */
export const OCCASION_DAY_MIN = 5;
/** An occasion holds at least this many photographs in all. */
export const OCCASION_MIN = 12;
/** Busy days this many calendar days apart, or fewer, are one occasion: one quiet day may fall between. */
export const OCCASION_GAP_DAYS = 2;
/** No occasion is longer than this many days; a longer run is read as several, the newest first. */
export const OCCASION_MAX_DAYS = 14;
/** A day of an occasion runs to this hour of the next morning. */
export const NIGHT_ENDS_HOUR = 4;
/** The week starts on a Monday. */
export const WEEK_STARTS_ON = 1;

/** Each read settles at least this many new occasions, unless the library or the read's bounds run out first. */
export const OCCASIONS_PER_READ = 8;
/** One read asks the library no more than this many pages. */
export const PAGES_PER_READ = 24;
/** Each page reaches back over a stretch this long to begin with… */
export const FIRST_STRETCH_MS = 31 * DAY_MS;
/** …twice as far after a stretch that was nearly empty, but never further than this. */
export const LONGEST_STRETCH_MS = 366 * DAY_MS;
/** A stretch that held fewer than this many photographs was nearly empty. */
const SPARSE = 40;
/**
 * The photographs kept in memory for the stretches found, at most: past
 * this, an occasion further back is listed with its count and cover, and
 * its photographs are read again when it is opened (`readSpan`).
 */
export const HELD_PRINTS = 6000;

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/** A local calendar date as a whole number of days, whatever the clocks did in between. */
function ordinal(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m, d) / DAY_MS);
}

/** Back from a day number to its local date. */
function dateOf(day: number): Date {
  const u = new Date(day * DAY_MS);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
}

/** The day a photograph belongs to: its local date, with the small hours given to the day before. */
export function occasionDay(t: number): number {
  const d = new Date(t);
  const shifted = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() - NIGHT_ENDS_HOUR, d.getMinutes());
  return ordinal(shifted.getFullYear(), shifted.getMonth(), shifted.getDate());
}

/** Midnight at the start of a local date, `days` from it. */
function midnight(d: Date, days = 0): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

// ---------------------------------------------------------------------------
// Lately
// ---------------------------------------------------------------------------

/**
 * The three recent stretches, as they stand at `now`, in local time:
 *
 *   This week      from the start of the week (a Monday) to the end of today
 *   Last weekend   the last Saturday and Sunday that are over, midnight to midnight
 *   This month     from the first of the month to the end of today
 *
 * Every edge is a local midnight, worked out from the calendar, so a
 * change of the clocks moves none of them. Counts are not known here.
 */
export function lately(now: number, weekStartsOn = WEEK_STARTS_ON): Pick<Span, "kind" | "from" | "to" | "title" | "head">[] {
  const today = new Date(now);
  const end = midnight(today, 1);
  const back = (today.getDay() - weekStartsOn + 7) % 7;
  const weekFrom = midnight(today, -back);
  // The Monday on or before today ends the last weekend that is over.
  const sinceMonday = (today.getDay() + 6) % 7;
  const weekendTo = midnight(today, -sinceMonday);
  const weekendFrom = midnight(new Date(weekendTo), -2);
  const monthFrom = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  return [
    { kind: "week", from: weekFrom, to: end, title: "This week", head: "This week" },
    { kind: "weekend", from: weekendFrom, to: weekendTo, title: "Last weekend", head: "Last weekend" },
    { kind: "month", from: monthFrom, to: end, title: "This month", head: "This month" },
  ];
}

/**
 * The recent stretches with what they hold, from photographs read back at
 * least as far as the earliest of them: a stretch with nothing in it is
 * left out, and so is one that holds exactly what a stretch before it
 * holds (this month, in the first days of a month, is this week).
 */
export function latelySpans(now: number, read: readonly Print[], weekStartsOn = WEEK_STARTS_ON): { span: Span; prints: Print[] }[] {
  const out: { span: Span; prints: Print[] }[] = [];
  const sorted = [...read].sort(byTime);
  for (const w of lately(now, weekStartsOn)) {
    const prints = sorted.filter((p) => p.takenAt >= w.from && p.takenAt < w.to);
    if (prints.length === 0) continue;
    const same = out.some(
      (o) => o.prints.length === prints.length && o.prints[0].id === prints[0].id && o.prints[o.prints.length - 1].id === prints[prints.length - 1].id,
    );
    if (same) continue;
    out.push({ span: { ...w, count: prints.length, cover: coverOf(prints) }, prints });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Occasions
// ---------------------------------------------------------------------------

/** An occasion as `occasionsIn` finds it: its days, and its photographs in the order they were taken. */
export interface FoundOccasion {
  /** Its first and last day (`occasionDay`). */
  first: number;
  last: number;
  prints: Print[];
}

/**
 * The occasions among some photographs, newest first.
 *
 * The photographs are put on their days (a day running to four in the
 * morning). A day with at least `OCCASION_DAY_MIN` of them is a busy day.
 * Walking back from the newest, busy days no more than `OCCASION_GAP_DAYS`
 * apart are one run, and a run is closed once it would grow longer than
 * `OCCASION_MAX_DAYS` — so a run is decided from its newest day, and
 * reading further back never changes one already found. A run of at
 * least `OCCASION_MIN` photographs is an occasion, holding every
 * photograph of its days, the quiet day between included.
 *
 * Where a place is known for photographs on both sides of a quiet day
 * (`placeOf`), and the two are further apart than `PLACE_APART_KM`, they
 * are two occasions: a weekend at home and the flight out are not one.
 */
export function occasionsIn(
  prints: readonly Print[],
  placeOf?: (p: Print) => { lat: number; lng: number } | null,
): FoundOccasion[] {
  const byDay = new Map<number, Print[]>();
  for (const p of prints) {
    const day = occasionDay(p.takenAt);
    const list = byDay.get(day);
    if (list) list.push(p);
    else byDay.set(day, [p]);
  }
  const days = [...byDay.keys()].sort((a, b) => b - a);
  const busy = days.filter((d) => byDay.get(d)!.length >= OCCASION_DAY_MIN);
  const runs: number[][] = [];
  for (const day of busy) {
    const run = runs[runs.length - 1];
    const newest = run?.[0];
    const oldest = run?.[run.length - 1];
    const joins =
      run != null &&
      oldest! - day <= OCCASION_GAP_DAYS &&
      newest! - day < OCCASION_MAX_DAYS &&
      !(placeOf && apart(byDay.get(oldest!)!, byDay.get(day)!, placeOf));
    if (joins) run.push(day);
    else runs.push([day]);
  }
  const out: FoundOccasion[] = [];
  for (const run of runs) {
    const last = run[0];
    const first = run[run.length - 1];
    const held: Print[] = [];
    for (let d = first; d <= last; d++) held.push(...(byDay.get(d) ?? []));
    if (held.length >= OCCASION_MIN) out.push({ first, last, prints: held.sort(byTime) });
  }
  return out;
}

/** Two days' photographs this far apart, where both have a place, are two occasions. */
export const PLACE_APART_KM = 100;

function apart(
  later: readonly Print[],
  earlier: readonly Print[],
  placeOf: (p: Print) => { lat: number; lng: number } | null,
): boolean {
  const a = placeIn(later, "first", placeOf);
  const b = placeIn(earlier, "last", placeOf);
  return a != null && b != null && kmBetween(a, b) > PLACE_APART_KM;
}

function placeIn(
  list: readonly Print[],
  end: "first" | "last",
  placeOf: (p: Print) => { lat: number; lng: number } | null,
): { lat: number; lng: number } | null {
  const sorted = [...list].sort(byTime);
  if (end === "last") sorted.reverse();
  for (const p of sorted) {
    const at = placeOf(p);
    if (at) return at;
  }
  return null;
}

/** Great-circle distance, in kilometres. */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The photograph that stands for a stretch: from its busiest day, the
 * weightiest of that day's (`quality`), nearest the middle of it.
 */
export function coverOf(prints: readonly Print[]): Print | null {
  if (prints.length === 0) return null;
  const byDay = new Map<number, Print[]>();
  for (const p of prints) {
    const day = occasionDay(p.takenAt);
    const list = byDay.get(day);
    if (list) list.push(p);
    else byDay.set(day, [p]);
  }
  let busiest: Print[] = [];
  for (const list of byDay.values()) if (list.length > busiest.length) busiest = list;
  const day = [...busiest].sort(byTime);
  const middle = (day.length - 1) / 2;
  let best = day[0];
  let bestScore = -Infinity;
  day.forEach((p, i) => {
    const score = quality(p) * 1000 - Math.abs(i - middle);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  });
  return best;
}

/**
 * An occasion's name: plainly its dates, from its first day to its last.
 *
 *   June 14, 2024
 *   June 12–15, 2024
 *   June 30 – July 2, 2024
 *   December 28, 2023 – January 2, 2024
 *
 * Where the place is known, the place and the month instead:
 * "Lisbon · June 2024", "Lisbon · June–July 2024".
 */
export function occasionTitle(first: number, last: number, place: string | null = null): string {
  const a = dateOf(Math.min(first, last));
  const b = dateOf(Math.max(first, last));
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  if (place) {
    const months = sameMonth
      ? `${monthName(a.getMonth())} ${a.getFullYear()}`
      : sameYear
        ? `${monthName(a.getMonth())}–${monthName(b.getMonth())} ${a.getFullYear()}`
        : `${monthName(a.getMonth())} ${a.getFullYear()} – ${monthName(b.getMonth())} ${b.getFullYear()}`;
    return `${place} · ${months}`;
  }
  if (a.getTime() === b.getTime()) return fullDate(a.getTime());
  if (sameMonth) return `${monthName(a.getMonth())} ${a.getDate()}–${b.getDate()}, ${a.getFullYear()}`;
  if (sameYear) return `${monthName(a.getMonth())} ${a.getDate()} – ${monthName(b.getMonth())} ${b.getDate()}, ${a.getFullYear()}`;
  return `${fullDate(a.getTime())} – ${fullDate(b.getTime())}`;
}

/** The running head holds about this many of its capitals. */
const HEAD_FITS = 24;

/** The running head's name for an occasion: its title where that fits, else the place, else the month it began. */
export function occasionHead(title: string, first: number, place: string | null = null): string {
  if (title.length <= HEAD_FITS) return title;
  if (place && place.length <= HEAD_FITS) return place;
  const a = dateOf(first);
  return `${monthName(a.getMonth())} ${a.getFullYear()}`;
}

/**
 * An occasion as Contents lists it and the room opens it: from four in the
 * morning of its first day to four in the morning after its last, so a
 * night out belongs to the day it began, as its photographs do.
 */
export function occasionSpan(found: FoundOccasion, place: string | null = null): Span {
  const first = dateOf(found.first);
  const last = dateOf(found.last);
  const title = occasionTitle(found.first, found.last, place);
  return {
    kind: "occasion",
    from: new Date(first.getFullYear(), first.getMonth(), first.getDate(), NIGHT_ENDS_HOUR).getTime(),
    to: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1, NIGHT_ENDS_HOUR).getTime(),
    title,
    head: occasionHead(title, found.first, place),
    count: found.prints.length,
    cover: coverOf(found.prints),
  };
}

/** The chapter key's part for a stretch: the same stretch, the same key. */
export function spanKey(span: Pick<Span, "from" | "to">): string {
  return `${span.from}:${span.to}`;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** What Contents shows of lately and the occasions. */
export interface OccasionsView {
  /** This week, last weekend, this month: those with anything in them. Null until they have been read. */
  lately: Span[] | null;
  /** Newest first. */
  occasions: Span[];
  /** There may be earlier occasions: EARLIER OCCASIONS reads on. */
  more: boolean;
}

/**
 * The library read newest first for its occasions, as far as has been
 * asked, and kept: what has been found, and the photographs of each, for
 * the chapter it opens.
 *
 * Each page is one bounded question — the newest photographs of a stretch
 * of time before what has already been read — so nothing ever reads the
 * whole library, and nothing reads the same stretch twice. A read stops
 * once it has settled `OCCASIONS_PER_READ` new occasions, or after
 * `PAGES_PER_READ` pages, or at the oldest photograph. No more than
 * `HELD_PRINTS` photographs are kept for the stretches it found. An occasion is
 * settled only once the reading is past the days that could still join
 * it; until then its photographs wait (`carry`). Photographs that belong
 * to no occasion, and are too far back to join one, are let go.
 */
export class Occasions {
  /** Everything at or after this instant has been read. */
  private frontier: number;
  /** The span of the next page's stretch. */
  private stretch = FIRST_STRETCH_MS;
  /** Read, near the frontier, and not yet settled into an occasion: in the order taken. */
  private carry: Print[] = [];
  /** Photographs read since the earliest of the recent stretches began, until those are known. */
  private recent: Print[] = [];
  private readonly floor: number;
  private readonly latelyFrom: number;
  private readonly found: Span[] = [];
  private readonly held = new Map<string, Print[]>();
  private heldCount = 0;
  private latelyFound: Span[] | null = null;
  private ended = false;
  private reading: Promise<OccasionsView> | null = null;
  private begun = false;
  private done = false;

  constructor(
    private readonly lib: LibrarySource,
    private readonly now: number,
    oldest: number | null,
    private readonly weekStartsOn = WEEK_STARTS_ON,
  ) {
    this.frontier = midnight(new Date(now), 1);
    this.floor = Math.max(EARLIEST_PLAUSIBLE, oldest ?? EARLIEST_PLAUSIBLE);
    this.latelyFrom = Math.min(...lately(now, weekStartsOn).map((w) => w.from));
    if (oldest == null) this.ended = true;
  }

  /** A read has finished: what it found is what Contents shows. */
  get ready(): boolean {
    return this.done;
  }

  /** The first read, once: asked again, the same read is waited for, or what it found is given back. */
  first(): Promise<OccasionsView> {
    if (this.reading) return this.reading;
    return this.begun ? Promise.resolve(this.view) : this.more();
  }

  /** What has been found so far. */
  get view(): OccasionsView {
    return { lately: this.latelyFound ?? (this.ended ? [] : null), occasions: [...this.found], more: !this.ended };
  }

  /** The photographs of a stretch this reader found, for its chapter; null when it did not find it. */
  printsOf(span: Pick<Span, "from" | "to">): Print[] | null {
    return this.held.get(spanKey(span)) ?? null;
  }

  /** Read on, unless a read is under way, which is waited for instead. */
  more(): Promise<OccasionsView> {
    if (this.reading) return this.reading;
    this.begun = true;
    const run = this.read()
      .then((view) => {
        this.done = true;
        return view;
      })
      .catch((e: unknown) => {
        // A first read the library would not answer is asked again next time, from where it got to.
        if (!this.done) this.begun = false;
        throw e;
      })
      .finally(() => {
        this.reading = null;
      });
    this.reading = run;
    return run;
  }

  private async read(): Promise<OccasionsView> {
    const target = this.found.length + OCCASIONS_PER_READ;
    let pages = 0;
    while (!this.ended && pages < PAGES_PER_READ && (this.found.length < target || this.latelyFound == null)) {
      pages += 1;
      await this.page();
      this.settle();
    }
    if (this.ended) this.settle();
    return this.view;
  }

  /** One page: the newest photographs of the stretch before the frontier. */
  private async page(): Promise<void> {
    const to = this.frontier;
    const from = Math.max(this.floor, to - this.stretch);
    const page = await this.lib.page({ range: { from, to }, first: MAX_PAGE, order: "desc" });
    const prints = page.prints;
    const known = new Set(this.carry.map((p) => p.id));
    const fresh = prints.filter((p) => !known.has(p.id));
    if (page.hasNextPage && prints.length > 0) {
      // More in this stretch than a page holds: on from the oldest frame's own instant, so frames sharing it are not skipped.
      const oldest = Math.floor(prints[prints.length - 1].takenAt);
      this.frontier = fresh.length > 0 && oldest + 1 < to ? oldest + 1 : Math.min(oldest, to - 1);
    } else {
      this.frontier = from;
      this.stretch = prints.length < SPARSE ? Math.min(LONGEST_STRETCH_MS, this.stretch * 2) : this.stretch;
      if (from <= this.floor) this.ended = true;
    }
    const usable = fresh.filter((p) => isEligible(p));
    this.carry = [...this.carry, ...usable].sort(byTime);
    if (this.latelyFound == null) {
      this.recent.push(...usable.filter((p) => p.takenAt >= this.latelyFrom));
      if (this.frontier <= this.latelyFrom || this.ended) {
        const found = latelySpans(this.now, this.recent, this.weekStartsOn);
        for (const f of found) this.hold(f.span, f.prints);
        this.latelyFound = found.map((f) => f.span);
        this.recent = [];
      }
    }
  }

  /** Keeps a stretch's photographs for its chapter, while the session holds fewer than `HELD_PRINTS`. */
  private hold(span: Span, prints: Print[]): void {
    if (this.heldCount + prints.length > HELD_PRINTS) return;
    this.held.set(spanKey(span), prints);
    this.heldCount += prints.length;
  }

  /**
   * Occasions far enough above the frontier that nothing still to be read
   * could join them are settled, newest first, and their photographs held
   * for their chapters. The rest of what was read waits while it is near
   * enough the frontier to join an occasion; the rest is let go.
   */
  private settle(): void {
    const frontierDay = occasionDay(this.frontier);
    const settled = new Set<string>();
    for (const o of occasionsIn(this.carry)) {
      if (!this.ended && o.first - OCCASION_GAP_DAYS <= frontierDay) continue;
      const span = occasionSpan(o);
      this.found.push(span);
      this.hold(span, o.prints);
      for (const p of o.prints) settled.add(p.id);
    }
    this.found.sort((a, b) => b.from - a.from);
    this.carry = this.ended
      ? []
      : this.carry.filter((p) => !settled.has(p.id) && occasionDay(p.takenAt) <= frontierDay + OCCASION_GAP_DAYS + OCCASION_MAX_DAYS);
  }
}

/**
 * Every photograph of a stretch, read again from the library: for a
 * chapter whose stretch the reader of this session did not find (the
 * library changed since, and the reader was let go).
 */
export async function readSpan(lib: LibrarySource, range: TimeRange): Promise<Print[]> {
  const all = await readAll(lib, range, PAGES_PER_READ * 4);
  return all.filter((p) => isEligible(p));
}
