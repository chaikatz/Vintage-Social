import type { Surprise, YearCount, YearEdit } from "@/darkroom/discovery";
import type { ChapterKey } from "@/darkroom/session";
import type { Print } from "@/darkroom/types";

/**
 * The hand that deals a chapter: one engine reader (a Surprise roll or a
 * year's edit), the read in flight, and whoever is showing the chapter.
 *
 * A chapter outlives the room that showed it — its position is kept in
 * memory (`keepChapter`) so going On this day → 2016 → On this day comes
 * back to the same print, and so does leaving the room and coming back.
 * The reader goes with it. That is why a batch belongs to the dealer and
 * not to the room: an engine reader that has handed out twelve prints has
 * moved on past them, so a batch that arrives after the room left, or
 * after it turned to another chapter, must not be dropped (that left a
 * silent gap in a year read in order). It goes to the room now showing
 * the chapter, if any, or else into the chapter's kept position.
 *
 * One read at a time, whoever asks: two rooms showing the same chapter
 * one after the other share the flight rather than both asking the
 * reader for more.
 *
 * A reader can be given as a promise — a restored year waits for its
 * month counts before its edit can be built — and the deal waits for it.
 */

/** What the dealer needs of an engine reader. */
export interface Reader {
  next(count: number): Promise<Print[]>;
  /** Nothing more will come. */
  readonly done: boolean;
  /** Surprise: how it ended — the roll dealt, or nothing left at all. */
  readonly ending?: "roll" | "exhausted" | null;
  /** By year: the edit's size E and the year's count N. */
  readonly size?: number;
  readonly yearCount?: number;
  setYears?(years: readonly YearCount[]): void;
  anotherRoll?(seed: number): void;
}

export function surpriseReader(s: Surprise): Reader {
  return {
    next: (count) => s.next(count),
    get done() {
      return s.rollDone || s.exhausted;
    },
    get ending() {
      return s.exhausted ? "exhausted" : s.rollDone ? "roll" : null;
    },
    setYears: (years) => s.setYears(years),
    anotherRoll: (seed) => s.anotherRoll(seed),
  };
}

export function editReader(e: YearEdit): Reader {
  return {
    next: (count) => e.next(count),
    get done() {
      return e.done;
    },
    size: e.size,
    yearCount: e.yearCount,
  };
}

/** A batch, and whether more will follow; `failed` when the library would not answer. */
export type Delivery = (batch: Print[], more: boolean, failed: boolean) => void;

/** Empty batches in a row (a roll waiting on its year index) before the deal is taken as over. */
const EMPTY_LIMIT = 3;
/** How long to wait before asking again after an empty batch. */
const EMPTY_RETRY_MS = 1500;

export class Dealer {
  /** The room showing this chapter; batches go to it. */
  listener: Delivery | null = null;
  private engine: Reader | null = null;
  private building: Promise<Reader | null> | null = null;
  private flight: Promise<void> | null = null;
  private empties = 0;
  private stalled = false;
  private failedLast = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly key: ChapterKey,
    reader: Reader | Promise<Reader | null>,
    private readonly opts: {
      /** A batch that arrived with no room showing the chapter. */
      orphan: (dealer: Dealer, batch: Print[], more: boolean) => void;
      /** Keeps some dealt prints out, as a restored year keeps out what its deck already holds. */
      accept?: (p: Print) => boolean;
    },
  ) {
    if (reader instanceof Promise) {
      this.building = reader.then(
        (r) => {
          this.engine = r;
          this.building = null;
          if (!r) this.stalled = true;
          return r;
        },
        () => {
          this.building = null;
          this.stalled = true;
          this.failedLast = true;
          return null;
        },
      );
    } else {
      this.engine = reader;
    }
  }

  /** The engine reader, once built. */
  get reader(): Reader | null {
    return this.engine;
  }

  /** More can be dealt: the reader is still being built, or is not done. */
  get more(): boolean {
    if (this.stalled) return false;
    if (this.building) return true;
    return this.engine != null && !this.engine.done;
  }

  get reading(): boolean {
    return this.flight != null;
  }

  /** The last read failed; `read` tries again. */
  get failed(): boolean {
    return this.failedLast;
  }

  /** Deal up to `count` more, unless a read is already in flight. */
  read(count: number): Promise<void> {
    if (this.flight) return this.flight;
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    this.failedLast = false;
    if (this.stalled && this.engine) this.stalled = false;
    const run = (async () => {
      try {
        const engine = this.engine ?? (await this.building);
        if (!engine) {
          // The reader could not be built: the room offers to start the chapter again.
          this.failedLast = true;
          this.deliver([], false, true);
          return;
        }
        const dealt = await engine.next(count);
        const accept = this.opts.accept;
        const batch = accept ? dealt.filter(accept) : dealt;
        if (dealt.length === 0 && !engine.done) {
          this.empties += 1;
          if (this.empties >= EMPTY_LIMIT) this.stalled = true;
        } else {
          this.empties = 0;
        }
        // A rebuilt reader whose first picks the deck already held deals
        // again at once, rather than leaving the member on a waiting page.
        const again = batch.length === 0 && dealt.length > 0 && !engine.done;
        this.deliver(batch, this.more, false);
        if (again) queueMicrotask(() => void this.read(count));
        else if (dealt.length === 0 && this.more && this.listener) {
          this.retry = setTimeout(() => {
            this.retry = null;
            if (this.listener) void this.read(count);
          }, EMPTY_RETRY_MS);
        }
      } catch {
        this.failedLast = true;
        this.deliver([], false, true);
      } finally {
        this.flight = null;
      }
    })();
    this.flight = run;
    return run;
  }

  /** The year index has arrived: a roll dealt cold can now draw from it. */
  setYears(years: readonly YearCount[]): void {
    this.engine?.setYears?.(years);
    if (this.engine?.setYears) {
      this.empties = 0;
      this.stalled = false;
    }
  }

  /** A new roll, this visit's picks still excluded. */
  anotherRoll(seed: number): boolean {
    if (!this.engine?.anotherRoll) return false;
    this.engine.anotherRoll(seed);
    this.empties = 0;
    this.stalled = false;
    return true;
  }

  /** No room will show this chapter again: stop any pending retry. */
  release(): void {
    this.listener = null;
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
  }

  private deliver(batch: Print[], more: boolean, failed: boolean): void {
    if (this.listener) this.listener(batch, more, failed);
    else this.opts.orphan(this, batch, more && !failed);
  }
}

/** `prints` with `batch` added at the end, leaving out any already there. Sequences only ever append. */
export function appendNew(prints: readonly Print[], batch: readonly Print[]): Print[] {
  if (batch.length === 0) return prints as Print[];
  const ids = new Set(prints.map((p) => p.id));
  const fresh = batch.filter((p) => {
    if (ids.has(p.id)) return false;
    ids.add(p.id);
    return true;
  });
  return fresh.length === 0 ? (prints as Print[]) : [...prints, ...fresh];
}
