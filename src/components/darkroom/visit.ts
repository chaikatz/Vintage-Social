import { stillInLibrary } from "@/darkroom/develop";
import {
  monthIndex,
  onThisDay,
  Surprise,
  YearEdit,
  yearIndex,
  type DayResult,
  type YearCount,
} from "@/darkroom/discovery";
import { developedRecently, localDay, seenWithin } from "@/darkroom/history";
import { keepChapter, recallChapter, type ChapterKey } from "@/darkroom/session";
import { isSetAside, setAsidePrints } from "@/darkroom/setAside";
import type { LibrarySource, Print } from "@/darkroom/types";
import { dayComplete } from "./chapter";
import { appendNew, Dealer, type Reader } from "./dealer";

/**
 * One visit to the room: what it has asked the library and what it has
 * shown, so the same question is not asked twice and the same photograph
 * is not dealt twice.
 *
 *   the oldest photograph's date, for Surprise's cold start;
 *   each year's month counts, asked only for a year that is opened;
 *   today's On this day, for the day it was asked on;
 *   the year index, shared by every visit for ten minutes and let go
 *     when Photos says the library changed;
 *   every print settled on, and by year, for Surprise's exclusions and
 *     for MORE FROM;
 *   the Surprise dealers of the visit, which learn the year index when
 *     it arrives.
 *
 * It makes the engine's readers with the room's history and shelf wired
 * in, and wraps them in dealers whose late batches find their chapter's
 * kept position (`orphan`).
 */

const YEARS_FRESH_MS = 10 * 60_000;
/** Without the module, set-aside prints this many pages either side of the current one are checked. */
const PRUNE_NEAR = 2;

let yearCache: { at: number; years: YearCount[] } | null = null;

/**
 * A batch that arrived with no room showing its chapter goes into the
 * chapter's kept position, so the prints its reader has already moved
 * past are there when the chapter is next opened.
 */
export function orphan(dealer: Dealer, batch: Print[], more: boolean): void {
  const pos = recallChapter(dealer.key);
  if (!pos || pos.reader !== dealer) return;
  keepChapter(dealer.key, { ...pos, prints: appendNew(pos.prints, batch), more });
}

export class Visit {
  readonly shown = new Set<string>();
  readonly shownByYear = new Map<number, Set<string>>();
  private readonly surprises = new Set<Dealer>();
  private oldestAsked: Promise<number | null> | null = null;
  private readonly monthsAsked = new Map<number, Promise<number[]>>();
  private day: { day: string; result: DayResult } | null = null;

  constructor(readonly source: LibrarySource) {}

  /** When the oldest photograph was taken; null for an empty library. Asked once a visit. */
  oldest(): Promise<number | null> {
    if (!this.oldestAsked) {
      const asked = this.source.oldest();
      this.oldestAsked = asked;
      asked.catch(() => {
        if (this.oldestAsked === asked) this.oldestAsked = null;
      });
    }
    return this.oldestAsked;
  }

  /** A year's twelve month counts. */
  months(year: number): Promise<number[]> {
    let asked = this.monthsAsked.get(year);
    if (!asked) {
      asked = monthIndex(this.source, year);
      this.monthsAsked.set(year, asked);
      asked.catch(() => this.monthsAsked.delete(year));
    }
    return asked;
  }

  /** The year index if it is fresh in memory. */
  freshYears(): YearCount[] | null {
    return yearCache && Date.now() - yearCache.at < YEARS_FRESH_MS ? yearCache.years : null;
  }

  /** The year index, counted again unless it is fresh; every Surprise of the visit is given it. */
  async years(force = false): Promise<YearCount[]> {
    const known = force ? null : this.freshYears();
    if (known) return known;
    const years = await yearIndex(this.source, Date.now());
    yearCache = { at: Date.now(), years };
    for (const d of this.surprises) d.setYears(years);
    return years;
  }

  /** Today's On this day, if it has been asked to the end today. */
  knownDay(): DayResult | null {
    const d = this.day;
    return d && d.day === localDay() && dayComplete(d.result) ? d.result : null;
  }

  remember(result: DayResult, at = Date.now()): void {
    this.day = { day: localDay(at), result };
  }

  /** Today's On this day, asked to the end. */
  async askDay(): Promise<DayResult> {
    const known = this.knownDay();
    if (known) return known;
    const result = await onThisDay(this.source, { now: Date.now() });
    this.remember(result);
    return result;
  }

  /**
   * The day alone, for the first decision: a thin day is not swept out to
   * the season before Surprise may begin. `maxReach` is honoured where
   * the engine knows it; elsewhere the whole answer comes back, which
   * decides the same way, a little later.
   */
  askDayOnly(now: number): Promise<DayResult | null> {
    const dayOnly = { now, maxReach: "day" as const };
    return onThisDay(this.source, dayOnly).then(
      (result) => {
        this.remember(result, now);
        return result;
      },
      () => null,
    );
  }

  /** A print the member settled on. */
  record(print: Print): void {
    this.shown.add(print.id);
    const year = new Date(print.takenAt).getFullYear();
    let ids = this.shownByYear.get(year);
    if (!ids) this.shownByYear.set(year, (ids = new Set()));
    ids.add(print.id);
  }

  /** A new roll's reader: nothing this visit has shown, nothing seen lately, posted this year or set aside. */
  surprise(oldest: number | null, extra: { exclude?: Iterable<string>; alreadyDealt?: number } = {}): Surprise {
    return new Surprise(this.source, {
      now: Date.now(),
      seed: Date.now() >>> 0,
      oldest,
      years: this.freshYears(),
      seenWithin: (id, days) => seenWithin(id, days),
      // Posted this year, or on the shelf: the member knows where those are.
      held: (id) => developedRecently(id) || isSetAside(id),
      exclude: [...this.shown, ...(extra.exclude ?? [])],
      alreadyDealt: extra.alreadyDealt,
    });
  }

  /** A year's edit. MORE FROM leaves out what this visit has shown of the year. */
  edit(year: number, months: readonly number[], opts: { fromMonth?: number; pin?: Print | null; shifted?: boolean; exclude?: Iterable<string> } = {}): YearEdit {
    return new YearEdit(this.source, year, {
      now: Date.now(),
      months,
      fromMonth: opts.fromMonth,
      pin: opts.pin ?? null,
      shifted: opts.shifted,
      exclude: opts.exclude ?? (opts.shifted ? this.shownByYear.get(year) : undefined),
      seenWithin: (id, days) => seenWithin(id, days),
    });
  }

  /** A dealer for a Surprise roll, told the year index when it arrives. */
  surpriseDealer(key: ChapterKey, reader: Reader | Promise<Reader | null>): Dealer {
    const d = new Dealer(key, reader, { orphan });
    this.surprises.add(d);
    const years = this.freshYears();
    if (years && !(reader instanceof Promise)) d.setYears(years);
    return d;
  }

  editDealer(key: ChapterKey, reader: Reader | Promise<Reader | null>, accept?: (p: Print) => boolean): Dealer {
    return new Dealer(key, reader, { orphan, accept });
  }

  /** A Surprise dealer that will never be shown. */
  drop(d: Dealer): void {
    d.release();
    this.surprises.delete(d);
  }

  /** Photos said the library changed: what was counted is counted again when next asked. */
  libraryChanged(whole: boolean): void {
    yearCache = null;
    this.oldestAsked = null;
    this.monthsAsked.clear();
    if (whole) this.day = null;
  }

  /** TRY AGAIN on the error page: everything asked again, the year index too. */
  forgetAnswers(): void {
    this.libraryChanged(true);
  }

  /**
   * Set-aside prints that no longer resolve, under full access (§7.6).
   * With the module, all of them are asked about at once. Without it, only
   * the prints either side of the one in front of the member in the Set
   * aside chapter, each by a two-second window of time around when it was
   * taken.
   */
  async goneFromShelf(nearby: { prints: readonly Print[]; index: number } | null): Promise<string[]> {
    const shelf = setAsidePrints();
    if (shelf.length === 0) return [];
    const ids = shelf.map((p) => p.id);
    const present = await stillInLibrary(ids).catch(() => null);
    if (present) {
      const known = new Set(present);
      return ids.filter((id) => !known.has(id));
    }
    if (!nearby) return [];
    const near = nearby.prints.slice(Math.max(0, nearby.index - PRUNE_NEAR), nearby.index + PRUNE_NEAR + 1);
    const checks = await Promise.all(
      near.map(async (p) => {
        try {
          const page = await this.source.page({ range: { from: p.takenAt - 1000, to: p.takenAt + 1000 }, first: 20, order: "asc" });
          return page.prints.some((q) => q.id === p.id) ? null : p.id;
        } catch {
          return null;
        }
      }),
    );
    return checks.filter((id): id is string => id != null && isSetAside(id));
  }
}
