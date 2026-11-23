import { stillInLibrary } from "@/darkroom/develop";
import {
  gated,
  inBackground,
  monthIndex,
  onThisDay,
  Surprise,
  YearEdit,
  yearIndex,
  type DayResult,
  type YearCount,
} from "@/darkroom/discovery";
import { developedRecently, localDay, seenWithin } from "@/darkroom/history";
import { Occasions, readSpan, type OccasionsView } from "@/darkroom/occasions";
import { keepChapter, recallChapter, type ChapterKey } from "@/darkroom/session";
import { isSetAside, setAsidePrints } from "@/darkroom/setAside";
import type { LibrarySource, Print, Span } from "@/darkroom/types";
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
 *     it arrives;
 *   lately and the occasions (`Occasions`), read as far as Contents has
 *     asked and kept, with their photographs: within the visit, until
 *     Photos says the library changed; and taken up by a later visit
 *     only on the same day, within ten minutes, and while the recent
 *     stretch (`recentStretch`) still holds as many photographs as when
 *     the reading began — photographs taken with the room closed send
 *     the room no word, so a later visit asks.
 *
 * It makes the engine's readers with the room's history and shelf wired
 * in, and wraps them in dealers whose late batches find their chapter's
 * kept position (`orphan`).
 *
 * What the room reads of its own accord once the first print is up — the
 * year index, the whole of On this day, the open year's months — is asked
 * with `background`, in the gate's back line (`inBackground`), so the
 * prints a chapter is dealing are never kept waiting behind it. A second
 * ask for the year index or the day while one is being read waits for the
 * same answer rather than reading it all again.
 */

const YEARS_FRESH_MS = 10 * 60_000;
/** A later visit takes up the occasions read by an earlier one for no longer than this, as the year index is kept. */
export const OCCASIONS_FRESH_MS = YEARS_FRESH_MS;
/** Without the module, set-aside prints this many pages either side of the current one are checked. */
const PRUNE_NEAR = 2;

let yearCache: { at: number; years: YearCount[] } | null = null;
/**
 * Lately and the occasions, as last read: the day and the time the reading
 * began, and how many photographs the recent stretch held then (null when
 * the library would not say).
 */
let occasionCache: { day: string; at: number; source: LibrarySource; reader: Occasions; recent: number | null } | null = null;

/** Let go of what was read of lately and the occasions; a read under way stops after its page. */
function dropOccasions(): void {
  occasionCache?.reader.release();
  occasionCache = null;
}

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
  private yearsAsked: Promise<YearCount[]> | null = null;
  private dayAsked: Promise<DayResult> | null = null;
  private occasionsAsked: Promise<Occasions> | null = null;
  /** The reader of lately and the occasions this visit made, or took up from an earlier one once it had asked. */
  private occasionsMine: Occasions | null = null;
  /** Counts the library changes this visit has been told of: a reading begun before one is not kept. */
  private changes = 0;
  private day: { day: string; result: DayResult } | null = null;

  constructor(readonly source: LibrarySource) {}

  /** The library as one read asks it: in the member's line, or in the back line for what the room reads of its own accord. */
  private lib(background: boolean): LibrarySource {
    return background ? inBackground(this.source) : this.source;
  }

  /**
   * When the oldest photograph was taken; null for an empty library.
   * Asked once a visit, and handed to every reader that wants it (On this
   * day's years, the year index, Surprise's cold start), since the
   * question sorts every photograph on the phone. Let go when Photos says
   * the library changed.
   */
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
  months(year: number, background = false): Promise<number[]> {
    let asked = this.monthsAsked.get(year);
    if (!asked) {
      asked = monthIndex(this.lib(background), year);
      this.monthsAsked.set(year, asked);
      asked.catch(() => this.monthsAsked.delete(year));
    }
    return asked;
  }

  /** The year index if it is fresh in memory. */
  freshYears(): YearCount[] | null {
    return yearCache && Date.now() - yearCache.at < YEARS_FRESH_MS ? yearCache.years : null;
  }

  /**
   * The year index, counted again unless it is fresh. Every Surprise of
   * the visit is given it, however it was come by: a roll begun cold
   * before another room counted the years has still not been told them.
   */
  async years(force = false, background = false): Promise<YearCount[]> {
    const known = force ? null : this.freshYears();
    const years = known ?? (await this.countYears(force, background));
    for (const d of this.surprises) d.setYears(years);
    return years;
  }

  /**
   * The year index, counted once at a time: asked again while it is being
   * counted, the same count is waited for. A recount (`force`) starts
   * afresh, and only the newest count is kept as the fresh one.
   */
  private countYears(force: boolean, background: boolean): Promise<YearCount[]> {
    if (!force && this.yearsAsked) return this.yearsAsked;
    const asked: Promise<YearCount[]> = this.oldest()
      .then((oldest) => yearIndex(this.lib(background), Date.now(), oldest))
      .then((years) => {
        if (this.yearsAsked === asked) yearCache = { at: Date.now(), years };
        return years;
      });
    this.yearsAsked = asked;
    const done = () => {
      if (this.yearsAsked === asked) this.yearsAsked = null;
    };
    asked.then(done, done);
    return asked;
  }

  /** Today's On this day, if it has been asked to the end today. */
  knownDay(): DayResult | null {
    const d = this.day;
    return d && d.day === localDay() && dayComplete(d.result) ? d.result : null;
  }

  remember(result: DayResult, at = Date.now()): void {
    this.day = { day: localDay(at), result };
  }

  /** Today's On this day, asked to the end; asked again while it is being read, the same reading is waited for. */
  askDay(background = false): Promise<DayResult> {
    const known = this.knownDay();
    if (known) return Promise.resolve(known);
    if (this.dayAsked) return this.dayAsked;
    const asked: Promise<DayResult> = this.oldest()
      .then((oldest) => onThisDay(this.lib(background), { now: Date.now(), oldest }))
      .then((result) => {
        if (this.dayAsked === asked) this.remember(result);
        return result;
      });
    this.dayAsked = asked;
    const done = () => {
      if (this.dayAsked === asked) this.dayAsked = null;
    };
    asked.then(done, done);
    return asked;
  }

  /**
   * The day alone, for the first decision: a thin day is not swept out to
   * the season before Surprise may begin. `maxReach` is honoured where
   * the engine knows it; elsewhere the whole answer comes back, which
   * decides the same way, a little later.
   */
  askDayOnly(now: number): Promise<DayResult | null> {
    return this.oldest()
      .then((oldest) => onThisDay(this.source, { now, maxReach: "day", oldest }))
      .then(
        (result) => {
          this.remember(result, now);
          return result;
        },
        () => null,
      );
  }

  /** This visit's reader of lately and the occasions, while it is still the one kept. */
  private mine(): Occasions | null {
    const r = this.occasionsMine;
    return r && occasionCache?.reader === r && occasionCache.day === localDay() ? r : null;
  }

  /**
   * The reader of lately and the occasions: this visit's own, or one an
   * earlier visit read and this one has taken up, or a new one. It reads
   * in the gate's back line: the prints a chapter is dealing are never
   * kept waiting behind it.
   */
  private occasionReader(): Promise<Occasions> {
    const own = this.mine();
    if (own) return Promise.resolve(own);
    if (!this.occasionsAsked) {
      const asked = this.takeUpOrRead().then((reader) => {
        if (this.occasionsAsked === asked && occasionCache?.reader === reader) this.occasionsMine = reader;
        return reader;
      });
      this.occasionsAsked = asked;
      const done = () => {
        if (this.occasionsAsked === asked) this.occasionsAsked = null;
      };
      asked.then(done, done);
    }
    return this.occasionsAsked;
  }

  /**
   * What an earlier visit read, if it may be taken up: the same day, the
   * same library, within `OCCASIONS_FRESH_MS`, and the recent stretch
   * holding as many photographs as when that reading began — one count,
   * which reads no photograph. Anything else is read afresh, and what
   * was kept is let go.
   */
  private async takeUpOrRead(): Promise<Occasions> {
    const changes = this.changes;
    const kept = occasionCache;
    const day = localDay();
    if (kept && kept.day === day && kept.source === this.source && Date.now() - kept.at < OCCASIONS_FRESH_MS && kept.recent != null) {
      const now = await inBackground(this.source)
        .count(kept.reader.recentRange)
        .catch(() => null);
      if (now === kept.recent && occasionCache === kept) return kept.reader;
    }
    const oldest = await this.oldest();
    const at = Date.now();
    const reader = new Occasions(inBackground(this.source), at, oldest);
    // Counted before the first page is read: whatever arrives during the reading makes the next visit read again.
    const recent = await inBackground(this.source)
      .count(reader.recentRange)
      .catch(() => null);
    if (changes !== this.changes) {
      // The library changed meanwhile: the ask the change began keeps its own.
      reader.release();
      return reader;
    }
    dropOccasions();
    occasionCache = { day: localDay(at), at, source: this.source, reader, recent };
    return reader;
  }

  /** What this visit has found of lately and the occasions, without reading anything. */
  knownOccasions(): OccasionsView | null {
    const own = this.mine();
    return own?.ready ? own.view : null;
  }

  /**
   * Lately and the first occasions, read once a visit or taken up from an
   * earlier one; `further` reads on to earlier ones. Null when the library
   * changed while they were being read: the reading the change began
   * answers instead, and this one is not shown.
   */
  async occasions(further = false): Promise<OccasionsView | null> {
    const reader = await this.occasionReader();
    const view = await (further ? reader.more() : reader.first());
    return this.mine() === reader ? view : null;
  }

  /**
   * A stretch's photographs, for its chapter: those this visit's reader
   * found it with, or, for one it did not find (the library changed
   * since, or it was found by an earlier visit not taken up), read again.
   */
  async spanPrints(span: Span): Promise<Print[]> {
    const known = this.mine()?.printsOf(span) ?? null;
    // The member is waiting on it: asked in the front line.
    return known ?? readSpan(gated(this.source), { from: span.from, to: span.to });
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

  /** A dealer for a Surprise roll, told the year index when it arrives; a reader still being built is told once it is. */
  surpriseDealer(key: ChapterKey, reader: Reader | Promise<Reader | null>): Dealer {
    const d = new Dealer(key, reader, { orphan });
    this.surprises.add(d);
    const years = this.freshYears();
    if (years) d.setYears(years);
    return d;
  }

  /**
   * A roll begun by an earlier room and kept, shown again in this one: it
   * is told the year index as this visit learns it, and now if the room
   * already has it.
   */
  adopt(d: Dealer, known: readonly YearCount[] | null): void {
    this.surprises.add(d);
    const years = this.freshYears() ?? known;
    if (years) d.setYears(years);
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
    // Lately and the occasions are read again when next asked: photographs come and go from them.
    dropOccasions();
    this.changes += 1;
    this.occasionsMine = null;
    this.occasionsAsked = null;
    this.oldestAsked = null;
    this.monthsAsked.clear();
    // A count or a day still being read answers its own callers, but is
    // not kept, nor joined: the next ask reads the library as it is now.
    this.yearsAsked = null;
    if (whole) {
      this.day = null;
      this.dayAsked = null;
    }
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
