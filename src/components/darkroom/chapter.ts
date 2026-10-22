import type { DayResult } from "@/darkroom/discovery";
import type { ChapterKey, SavedPlace } from "@/darkroom/session";
import type { DarkroomMode, DayReach, Print } from "@/darkroom/types";
import type { Dealer } from "./dealer";
import type { DayState, EmptyWhy, Ending } from "./words";

/**
 * The shape of the room's state, and the rules about chapters that need
 * no library to decide: which way in the room opens on, where a chapter
 * opens, what leaves a chapter when the member turns past it, and how a
 * chapter ends. `src/darkroom/useDarkroom.ts` holds the state; these are
 * pure, so the tests can hold them to their word.
 */

/** On this day opens the room when the day itself holds at least this many moments. */
export const DEFAULT_DAY_MINIMUM = 3;

/** A jump inside a chapter fades the stage out over this, and back in over the same (§5.5). */
export const JUMP_HALF_MS = 80;

/** What fills the stage. */
export type RoomView =
  | { kind: "checking" }
  | { kind: "firstVisit"; access: "undetermined" | "granted" }
  | { kind: "denied" }
  | { kind: "empty"; why: EmptyWhy }
  | { kind: "prints" };

/** The chapter on the stage. */
export interface Chapter {
  key: ChapterKey;
  mode: DarkroomMode;
  year: number | null;
  /** The month a year chapter opened at; 0 otherwise. */
  month: number;
  prints: Print[];
  /** The settled page; `prints.length` is the end page. */
  index: number;
  /** More will be dealt past the end of `prints`. */
  more: boolean;
  reach: DayReach | null;
  /** The last read failed. */
  failed: boolean;
  /** The pager's key: a new one for every chapter shown, so it mounts at the chapter's own index. */
  generation: number;
  /** Bumped when prints before the index were taken out, so the pager keeps its place. */
  rebase: number;
}

/** Where the room is, even when its chapter has nothing to show: the running head and the Contents ribbon. */
export interface Where {
  mode: DarkroomMode;
  year: number | null;
  month: number;
}

/** A chapter being dealt. `mode` is null while the first way in is still being decided. */
export interface Loading {
  mode: DarkroomMode | null;
  year: number | null;
  month: number;
  since: number;
  /** A jump inside a chapter, which fades the stage, rather than a cut to another. */
  jump: boolean;
}

/** How a chapter is opened. */
export interface OpenSpec {
  mode: DarkroomMode;
  year: number | null;
  month: number;
  startId?: string | null;
  /** On this day: open at that year's first print. */
  startYear?: number | null;
  /** The caption thread's print, pinned into its year's edit and made current. */
  pin?: Print | null;
  /** MORE FROM: an edit shifted by half a slice, without what this visit has shown of the year. */
  shifted?: boolean;
  /** A print to keep in front of the member through a fresh deal (the library changed). */
  keep?: Print | null;
  /** Deal afresh rather than going back to a kept position. */
  fresh?: boolean;
  jump?: boolean;
}

/** The default rule's choice (§4.2): the day itself holds three moments, and was not already seen to its end today. */
export function opensOnThisDay(day: DayResult | null, finished: string | null, today: string): boolean {
  return day != null && finished !== today && day.reach === "day" && day.prints.length >= DEFAULT_DAY_MINIMUM;
}

/**
 * A complete On this day answer: it reached as far as it needed to. An
 * answer that stopped at the day with fewer than three moments was only
 * the first decision's question, the day alone, and says nothing yet
 * about the weeks around it.
 */
export function dayComplete(day: DayResult): boolean {
  return !(day.reach === "day" && day.prints.length < DEFAULT_DAY_MINIMUM);
}

/** What Contents can say of On this day. */
export function dayStateOf(day: DayResult | null): DayState {
  if (!day || !dayComplete(day)) return "unknown";
  if (day.prints.length === 0) return "none";
  return day.reach;
}

/** Where to open in a chapter: at a given print, at a year's first print, or at the start. */
export function startIndex(prints: readonly Print[], at: { startId?: string | null; startYear?: number | null }): number {
  if (at.startId) {
    const i = prints.findIndex((p) => p.id === at.startId);
    if (i >= 0) return i;
  }
  if (at.startYear != null) {
    const i = prints.findIndex((p) => new Date(p.takenAt).getFullYear() === at.startYear);
    if (i >= 0) return i;
  }
  return 0;
}

/**
 * On a settle, the prints that have left the chapter are taken out, all
 * but the one now in front of the member, so a print put back stays
 * until the member turns away from it and tapping again undoes it. The
 * index follows the print it stood on (or the end page), and `rebased`
 * says prints before it went, so the pager must keep its place.
 */
export function dropOnSettle(
  prints: readonly Print[],
  index: number,
  gone: (p: Print, i: number) => boolean,
): { prints: Print[]; index: number; rebased: boolean } {
  let rebased = false;
  let at = index;
  const kept: Print[] = [];
  prints.forEach((p, i) => {
    if (i !== index && gone(p, i)) {
      if (i < index) {
        rebased = true;
        at -= 1;
      }
      return;
    }
    kept.push(p);
  });
  if (kept.length === prints.length) return { prints: prints as Print[], index, rebased: false };
  return { prints: kept, index: Math.max(0, Math.min(at, kept.length)), rebased };
}

/**
 * Where a page of a deck falls among a fuller list of the same chapter:
 * its print, found by id; or, for the deck's end page, just past the
 * deck's last print, since a deck holds only the twenty prints behind
 * the member and its own index counts from the first of those. Null
 * when the list does not hold the print.
 */
export function pageAmong(prints: readonly Print[], deck: readonly Print[], index: number): number | null {
  const id = deck[index]?.id;
  if (id) {
    const i = prints.findIndex((p) => p.id === id);
    return i >= 0 ? i : null;
  }
  const last = deck[deck.length - 1]?.id;
  if (!last) return null;
  const j = prints.findIndex((p) => p.id === last);
  return j >= 0 ? j + 1 : null;
}

/** The place's print, found again among a chapter's prints; or the place's own index, held in range. */
export function placeIndex(prints: readonly Print[], place: Pick<SavedPlace, "deck" | "index">): number {
  return pageAmong(prints, place.deck, place.index) ?? Math.max(0, Math.min(place.index, prints.length));
}

/**
 * What a choice in Contents opens, or null when it leaves the room as it
 * is: the chapter already open, its year line, or the month already in
 * view (§3.10). A month of the year open is a jump inside it (§4.3). The
 * month the chapter itself opened at is turned back to among the prints
 * already dealt, so it shows the same prints from that month's first;
 * any other month has its own kept position.
 */
export function choiceOf(
  room: { showing: boolean; where: Where | null; chapter: Pick<Chapter, "prints" | "index"> | null },
  mode: DarkroomMode,
  year: number | null,
  month: number | null,
): OpenSpec | null {
  const w = room.where;
  const here = room.showing && w != null && w.mode === mode;
  if (here && mode !== "year") return null;
  if (here && w.year === year) {
    if (month == null) return null;
    if (month === w.month) {
      const c = room.chapter;
      const inView = c?.prints[c.index];
      if (inView && new Date(inView.takenAt).getMonth() === month) return null;
      const first = c?.prints.find((p) => new Date(p.takenAt).getMonth() === month) ?? c?.prints[0];
      return first ? { mode, year, month, jump: true, startId: first.id } : { mode, year, month, jump: true, fresh: true };
    }
  }
  // A month of the year already open is a jump inside it; anything else is a cut.
  const jump = mode === "year" && w?.mode === "year" && w.year === year;
  return { mode, year: mode === "year" ? year : null, month: mode === "year" ? month ?? 0 : 0, jump };
}

/** How a chapter ends, for its end page. */
export function endingOf(ch: Chapter, dealer: Dealer | null): Ending {
  if (ch.failed) return { kind: "readFailed" };
  if (ch.mode === "on-this-day") return { kind: "day", reach: ch.reach };
  if (ch.mode === "set-aside") return { kind: "shelf" };
  if (ch.mode === "surprise") return dealer?.reader?.ending === "exhausted" ? { kind: "exhausted" } : { kind: "roll" };
  const r = dealer?.reader;
  const smaller = r?.size != null && r.yearCount != null ? r.size < r.yearCount : false;
  return { kind: "year", year: ch.year ?? new Date().getFullYear(), smaller, fromMonth: ch.month, shown: ch.prints.length };
}
