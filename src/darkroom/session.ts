import { deleteDiskCache, readDiskCache, writeDiskCache } from "@/utils/diskCache";
import { localDay } from "./history";
import { monthYearWords } from "./labels";
import type { DarkroomMode, DayReach, Print } from "./types";

/**
 * Where the member was.
 *
 * Leaving the Darkroom to develop a photograph, or to look at the ordinary
 * picker, or closing the app for an evening, should not lose the place.
 * So the last chapter and the prints around the one in front of the
 * member are kept in a small file in Documents, and offered back on entry
 * for twelve hours; an On this day place only on the same calendar day,
 * because tomorrow's anniversaries are other photographs. After that a
 * visit starts fresh, which is what makes the next visit a new one.
 *
 * One store, written from two places. The room keeps it current as pages
 * settle and puts it on disk when it loses focus or the app leaves the
 * foreground. Posting a developed photograph moves it on past that print
 * (see `posted.ts`), so coming back starts at the next one. Either way the
 * file is written in one go from here, so neither can undo the other.
 *
 * The Post tab reads the place for its "You left off in August 2018." line
 * from this file alone. It never asks the library anything.
 *
 * Every other chapter visited in this run of the app keeps its own
 * position, in memory only: going On this day → 2016 → On this day comes
 * back to the same print. Those are gone when the app is closed.
 */

const PLACE_FILE = "darkroom-place.json";
const PLACE_KEY = "vintage.darkroom-place";
const INTRO_FILE = "darkroom-intro.json";
const INTRO_KEY = "vintage.darkroom-intro";

export const PLACE_KEPT_MS = 12 * 3_600_000;
/** The deck keeps this many prints behind the current one, so a swipe back still finds them. */
export const DECK_BEHIND = 20;
export const DECK_MAX = 120;
/** Positions kept for this many chapters at most; the one left longest ago goes first. */
export const CHAPTERS_KEPT = 6;

const MODES: readonly DarkroomMode[] = ["on-this-day", "surprise", "year", "set-aside"];
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface SavedPlace {
  v: 1;
  mode: DarkroomMode;
  year: number | null;
  month: number;
  index: number;
  deck: Print[];
  savedAt: number;
  /** The local calendar day it was saved on, "YYYY-MM-DD". */
  day: string;
}

/** A print as the place file keeps it: its identifier, address, shape and date, and nothing else. */
interface StoredPrint {
  id: string;
  uri: string | number;
  w: number;
  h: number;
  t: number;
}

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Only the fields the file keeps, so memory and disk always hold the same place. */
function bare(p: Print): Print {
  return { id: p.id, uri: p.uri, width: p.width, height: p.height, takenAt: p.takenAt, subtypes: [] };
}

/**
 * The stored place, checked field by field. A print in the deck that does
 * not fit is left out, and the index moves with it so it still points at
 * the same photograph.
 */
export function parsePlace(raw: unknown): SavedPlace | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const mode = MODES.find((m) => m === r.mode);
  if (!mode) return null;
  const year = isInt(r.year) ? r.year : null;
  if (mode === "year" && year == null) return null;
  const month = isInt(r.month) && r.month >= 0 && r.month <= 11 ? r.month : 0;
  const { index: storedIndex, savedAt, deck: storedDeck } = r;
  if (!isInt(storedIndex) || storedIndex < 0 || !isNum(savedAt) || !Array.isArray(storedDeck)) return null;
  let index = storedIndex;
  const deck: Print[] = [];
  storedDeck.forEach((v: unknown, i: number) => {
    const e = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const fits =
      typeof e.id === "string" && e.id.length > 0 &&
      (typeof e.uri === "string" || typeof e.uri === "number") &&
      isNum(e.w) && isNum(e.h) && isNum(e.t);
    if (fits) {
      const s = e as unknown as StoredPrint;
      deck.push({ id: s.id, uri: s.uri, width: s.w, height: s.h, takenAt: s.t, subtypes: [] });
    } else if (i < storedIndex) {
      index -= 1;
    }
  });
  if (deck.length === 0) return null;
  const day = typeof r.day === "string" && DAY_PATTERN.test(r.day) ? r.day : localDay(savedAt);
  return { v: 1, mode, year, month, index: Math.min(index, deck.length), deck, savedAt, day };
}

function toFile(p: SavedPlace) {
  return {
    v: 1,
    mode: p.mode,
    year: p.year,
    month: p.month,
    index: p.index,
    deck: p.deck.map((d): StoredPrint => ({ id: d.id, uri: d.uri, w: d.width, h: d.height, t: d.takenAt })),
    savedAt: p.savedAt,
    day: p.day,
  };
}

export type ChapterKey = string;

export interface ChapterPosition {
  prints: Print[];
  index: number;
  /** The reader that was dealing the chapter, to carry on from. */
  reader: unknown;
  more: boolean;
  reach: DayReach | null;
}

/** Positions per chapter, most recently kept last. */
const chapters = new Map<ChapterKey, { pos: ChapterPosition; keptAt: number; day: string }>();

let place: SavedPlace | null = null;
let placeLoaded = false;
/** The place in memory differs from the file. */
let placeDirty = false;
/**
 * The print just posted, which the place was moved past. A save from a
 * room that has not yet heard — the room under compose writing on
 * unmount, or as the app goes to the background — still stands on it,
 * and is moved past it too. A new visit, or a save anywhere else, ends it.
 */
let movedPast: string | null = null;
/**
 * Shut by `forgetDarkroom` until a member is next signed in. A room still
 * open when the session ended goes on working from memory, but nothing it
 * keeps reaches the disk for the next member to find; `reopenSession` lets
 * that memory go before anyone else reads it.
 */
let sealed = false;

function loadPlace(): SavedPlace | null {
  if (!placeLoaded) {
    place = readDiskCache(PLACE_FILE, PLACE_KEY, parsePlace);
    placeLoaded = true;
    placeDirty = false;
  }
  return place;
}

/**
 * Still good to go back to: under twelve hours old, and On this day only
 * on the day it was left. Stamped well after now means a clock since set
 * back, which cannot vouch for twelve hours either.
 */
function fresh(at: number, day: string, onThisDay: boolean, now: number): boolean {
  const age = now - at;
  if (age < -PLACE_KEPT_MS || age >= PLACE_KEPT_MS) return false;
  return !onThisDay || day === localDay(now);
}

/** The place if it may still be offered; a stale one is deleted, file and all, on the way. */
function current(now: number): SavedPlace | null {
  const p = loadPlace();
  if (!p) return null;
  if (fresh(p.savedAt, p.day, p.mode === "on-this-day", now)) return p;
  forgetPlace();
  return null;
}

/**
 * Keep where the member is, in memory. The deck is trimmed to the twenty
 * prints behind the current one and what has been dealt ahead of it, 120
 * at most, and the index re-based onto it. A chapter with nothing in it
 * yet is no place to come back to, so it clears the place instead.
 * `flushPlace` puts it on disk.
 */
export function savePlace(
  p: { mode: DarkroomMode; year: number | null; month: number; index: number; prints: readonly Print[] },
  now = Date.now(),
): void {
  placeLoaded = true;
  placeDirty = true;
  const at = Math.max(0, Math.min(Math.trunc(p.index) || 0, p.prints.length));
  const start = Math.max(0, at - DECK_BEHIND);
  const deck = p.prints.slice(start, start + DECK_MAX).map(bare);
  if (deck.length === 0) {
    place = null;
    movedPast = null;
    return;
  }
  let index = Math.min(at - start, deck.length);
  if (movedPast && deck[index]?.id === movedPast) index = Math.min(index + 1, deck.length);
  else movedPast = null;
  place = { v: 1, mode: p.mode, year: p.year, month: p.month, index, deck, savedAt: now, day: localDay(now) };
}

/** Put the place on disk, or delete the file when there is none. Nothing to do when nothing changed. */
export function flushPlace(): void {
  if (sealed || !placeDirty) return;
  placeDirty = false;
  if (place) writeDiskCache(PLACE_FILE, PLACE_KEY, toFile(place));
  else deleteDiskCache(PLACE_FILE, PLACE_KEY);
}

/**
 * The place to resume on entry, or null: past twelve hours, or an On
 * this day place from another day. Reading it starts a new visit.
 */
export function readPlace(now = Date.now()): SavedPlace | null {
  movedPast = null;
  return current(now);
}

/**
 * The Post tab's line for a place worth going back to: "You left off in
 * August 2018.", from the print the place stands on — or, at the end of
 * the deck, the last one shown. Read from the file, never the library.
 */
export function placeLine(now = Date.now()): string | null {
  const p = current(now);
  if (!p) return null;
  const print = p.deck[Math.min(p.index, p.deck.length - 1)];
  return print ? `You left off in ${monthYearWords(print.takenAt)}.` : null;
}

/**
 * The photograph `assetId` was posted. If the place stands on it, it
 * moves on to the next print, and so does any chapter position standing
 * on it; the place then goes to disk.
 */
export function advancePlace(assetId: string): void {
  const p = loadPlace();
  if (p && p.deck[p.index]?.id === assetId) {
    place = { ...p, index: Math.min(p.index + 1, p.deck.length) };
    placeDirty = true;
  }
  movedPast = assetId;
  for (const kept of chapters.values()) {
    const pos = kept.pos;
    if (pos.prints[pos.index]?.id === assetId) kept.pos = { ...pos, index: Math.min(pos.index + 1, pos.prints.length) };
  }
  flushPlace();
}

/** The place gone, file and all. */
export function forgetPlace(): void {
  place = null;
  placeLoaded = true;
  placeDirty = false;
  movedPast = null;
  deleteDiskCache(PLACE_FILE, PLACE_KEY);
}

/** No more writes of the place or the first-visit flag, until `reopenSession`. */
export function sealSession(): void {
  sealed = true;
}

/**
 * A member is signed in again after a seal: the place, the positions and
 * the first-visit flag kept in memory while it was shut belonged to the
 * member who left, so they go, and the next read starts from the files.
 * Without a seal there is nothing to let go, and nothing changes.
 */
export function reopenSession(): void {
  if (!sealed) return;
  sealed = false;
  place = null;
  placeLoaded = false;
  placeDirty = false;
  movedPast = null;
  chapters.clear();
  intro = null;
}

// ---------------------------------------------------------------------------
// Positions per chapter, in memory
// ---------------------------------------------------------------------------

/** "on-this-day" | "surprise" | "set-aside", or "year:2016:7" for 2016 opened from August. */
export function chapterKey(mode: DarkroomMode, year: number | null, month: number): ChapterKey {
  return mode === "year" ? `year:${year ?? "none"}:${month}` : mode;
}

/**
 * Keep a chapter's position as the member leaves it. Only the last few
 * chapters are kept, so a long evening of jumping between years never
 * holds more than a handful of decks in memory.
 */
export function keepChapter(key: ChapterKey, pos: ChapterPosition, now = Date.now()): void {
  chapters.delete(key);
  chapters.set(key, { pos, keptAt: now, day: localDay(now) });
  while (chapters.size > CHAPTERS_KEPT) {
    const oldest = chapters.keys().next().value;
    if (oldest === undefined) break;
    chapters.delete(oldest);
  }
}

/**
 * The position the chapter was left at, or null. The same rule as the
 * place: an app left in the background for a day should not hand back
 * yesterday's On this day.
 */
export function recallChapter(key: ChapterKey, now = Date.now()): ChapterPosition | null {
  const kept = chapters.get(key);
  if (!kept) return null;
  if (fresh(kept.keptAt, kept.day, key === "on-this-day", now)) return kept.pos;
  chapters.delete(key);
  return null;
}

export function forgetChapters(): void {
  chapters.clear();
}

// ---------------------------------------------------------------------------
// The first-visit page, once
// ---------------------------------------------------------------------------

let intro: boolean | null = null;

/** The first-visit page has been passed on this phone, by whoever is signed in. */
export function introSeen(): boolean {
  if (intro === null) intro = readDiskCache(INTRO_FILE, INTRO_KEY, (raw) => (raw === true ? true : null)) === true;
  return intro;
}

export function markIntroSeen(): void {
  intro = true;
  if (!sealed) writeDiskCache(INTRO_FILE, INTRO_KEY, true);
}

/** At sign-out: the next member is shown the first-visit page, and what it says, again. */
export function forgetIntro(): void {
  intro = false;
  deleteDiskCache(INTRO_FILE, INTRO_KEY);
}
