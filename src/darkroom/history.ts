import { AppState, InteractionManager, Platform } from "react-native";
import { deleteDiskCache, readDiskCache, writeDiskCache, type DiskCacheOptions } from "@/utils/diskCache";

/**
 * What the Darkroom remembers between visits, so the twentieth visit is
 * not the first one again: which photographs were looked at lately, which
 * were developed and posted, and whether today's On this day was seen to
 * its end.
 *
 * Only the library's own identifiers and a time are kept, in one small
 * file in the phone's cache folder. The cache is never backed up, and if
 * iOS empties it to make room the Darkroom only forgets a little sooner.
 * Not a pixel, not a date of the photograph, not a place, and nothing of
 * it is ever sent anywhere. Nothing is suppressed for good: a photograph
 * looked at is passed over for a few weeks and then comes round again,
 * and the file lets go of it altogether after two months. A photograph
 * posted from here is let go after a year.
 *
 * Writing the file costs a frame, so it is never written per swipe. The
 * marks gather in memory and go to disk together: when the room loses
 * focus, when the app leaves the foreground, and after every twenty-five
 * new marks — each time once the animations in flight have finished.
 */

const FILE = "darkroom-history.json";
const KEY = "vintage.darkroom-history";
const IN_CACHE: DiskCacheOptions = { dir: "cache" };

/** How many looked-at photographs are remembered; the oldest are let go first. */
export const SEEN_LIMIT = 3000;
export const DEVELOPED_LIMIT = 1000;
/** A photograph looked at is left alone this long before Surprise offers it again. */
export const QUIET_DAYS = 21;
/** A photograph posted from this phone is not offered as a rediscovery for a year after. */
export const DEVELOPED_QUIET_DAYS = 365;
/** Past this a look is forgotten altogether, not just no longer counted. */
export const SEEN_KEPT_DAYS = 60;
/** The file is written after this many new marks, as well as on blur and in the background. */
export const MARKS_PER_WRITE = 25;
const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type Entries = [string, number][];

export interface StoredHistory {
  seen: Entries;
  developed: Entries;
  dayFinished: string | null;
}

/**
 * The stored file, checked entry by entry: a file from another build is
 * not trusted blindly. A file with no version is the work-in-progress
 * build's, which had the same entries; a later version is not this
 * build's to read.
 */
export function parseHistory(raw: unknown): StoredHistory | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== undefined && r.v !== 1) return null;
  const entries = (v: unknown): Entries =>
    Array.isArray(v)
      ? v.filter(
          (e): e is [string, number] =>
            Array.isArray(e) && typeof e[0] === "string" && e[0].length > 0 && typeof e[1] === "number" && Number.isFinite(e[1]),
        )
      : [];
  const day = typeof r.dayFinished === "string" && DAY_PATTERN.test(r.dayFinished) ? r.dayFinished : null;
  return { seen: entries(r.seen), developed: entries(r.developed), dayFinished: day };
}

/** Put `id` at the newest end of an insertion-ordered map, letting the oldest go past `limit`. */
export function remember(map: Map<string, number>, id: string, at: number, limit: number): void {
  map.delete(id);
  map.set(id, at);
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/**
 * Entries in time order with the oldest let go: past the age they are
 * kept for, past the limit, or stamped later than tomorrow — a time from
 * a clock that has since been set back, which would otherwise hold its
 * photograph back for as long as the clock was wrong.
 */
function sound(entries: Entries, now: number, keptDays: number, limit: number): Map<string, number> {
  const from = now - keptDays * DAY_MS;
  const to = now + DAY_MS;
  const map = new Map<string, number>();
  for (const [id, at] of [...entries].sort((a, b) => a[1] - b[1])) {
    if (at >= from && at <= to) remember(map, id, at, limit);
  }
  return map;
}

interface History {
  seen: Map<string, number>;
  developed: Map<string, number>;
  dayFinished: string | null;
}

let history: History | null = null;
/** Something in memory is not yet on disk. */
let dirty = false;
/** Marks since the file was last written. */
let marks = 0;
/** A write is waiting for the animations in flight to finish. */
let scheduled = false;
let listening = false;
/** The work-in-progress build's copy in Documents is still there. */
let oldFileLeft = false;

/**
 * The work-in-progress build kept this file in Documents, which is backed
 * up with the phone. Its entries are taken over once, and the old copy is
 * deleted as soon as they are safely in the cache folder. The browser has
 * only the one localStorage key, so there is nothing to move there.
 */
function readOldFile(): StoredHistory | null {
  return Platform.OS === "web" ? null : readDiskCache(FILE, KEY, parseHistory);
}

function deleteOldFile(): void {
  if (Platform.OS !== "web") deleteDiskCache(FILE, KEY);
}

function load(): History {
  listenForBackground();
  if (history) return history;
  const now = Date.now();
  const fromCache = readDiskCache(FILE, KEY, parseHistory, IN_CACHE);
  const fromOld = fromCache ? null : readOldFile();
  oldFileLeft = fromOld != null;
  const stored = fromCache ?? fromOld;
  const seen = sound(stored?.seen ?? [], now, SEEN_KEPT_DAYS, SEEN_LIMIT);
  const developed = sound(stored?.developed ?? [], now, DEVELOPED_QUIET_DAYS, DEVELOPED_LIMIT);
  history = { seen, developed, dayFinished: stored?.dayFinished ?? null };
  // Whatever was let go on the way in leaves the file at the next write,
  // and an old file's entries move to the cache folder then.
  const letGo = seen.size !== (stored?.seen.length ?? 0) || developed.size !== (stored?.developed.length ?? 0);
  dirty = fromOld != null || letGo;
  return history;
}

/** Once: whenever the app stops being in front, what is in memory goes to disk. */
function listenForBackground(): void {
  if (listening) return;
  listening = true;
  try {
    AppState.addEventListener("change", (state) => {
      if (state !== "active") flushHistory();
    });
  } catch {
    // No app state to follow (a test, or a host without it): the room's blur still writes.
  }
}

function write(): void {
  if (!history || !dirty) return;
  const now = Date.now();
  // Looks past their two months are let go here as well as on load, so a
  // long-lived session never writes them back.
  const seenFrom = now - SEEN_KEPT_DAYS * DAY_MS;
  for (const [id, at] of history.seen) if (at < seenFrom) history.seen.delete(id);
  const developedFrom = now - DEVELOPED_QUIET_DAYS * DAY_MS;
  for (const [id, at] of history.developed) if (at < developedFrom) history.developed.delete(id);
  writeDiskCache(
    FILE,
    KEY,
    { v: 1, seen: [...history.seen], developed: [...history.developed], dayFinished: history.dayFinished },
    IN_CACHE,
  );
  dirty = false;
  marks = 0;
  if (oldFileLeft) {
    oldFileLeft = false;
    deleteOldFile();
  }
}

/**
 * Put what is in memory on disk, once the animations in flight have
 * finished, so a write never lands in the middle of a page turn or a
 * screen's fade. Calls while one is waiting join it.
 */
export function flushHistory(): void {
  if (!dirty || scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    write();
  };
  try {
    InteractionManager.runAfterInteractions(run);
  } catch {
    run();
  }
}

/** The photograph was looked at — settled on, with its image drawn, for long enough to count. */
export function markSeen(id: string, at = Date.now()): void {
  if (!id) return;
  remember(load().seen, id, at, SEEN_LIMIT);
  dirty = true;
  marks += 1;
  if (marks >= MARKS_PER_WRITE) flushHistory();
}

/** Looked at within the last `days` days. Zero days is never: Surprise's last resort. */
export function seenWithin(id: string, days: number, now = Date.now()): boolean {
  if (!(days > 0)) return false;
  const at = load().seen.get(id);
  return at != null && now - at < days * DAY_MS;
}

/** The photograph was developed and posted to VINTAGE. Kept in memory; whoever records it flushes. */
export function recordDeveloped(id: string, at = Date.now()): void {
  if (!id) return;
  remember(load().developed, id, at, DEVELOPED_LIMIT);
  dirty = true;
}

export function developedRecently(id: string, now = Date.now(), days = DEVELOPED_QUIET_DAYS): boolean {
  const at = load().developed.get(id);
  return at != null && now - at < days * DAY_MS;
}

/** When the photograph was posted from this phone, or null. */
export function developedAt(id: string): number | null {
  return load().developed.get(id) ?? null;
}

/** The local day ("YYYY-MM-DD") On this day was last seen to its end, or null. */
export function dayFinished(): string | null {
  return load().dayFinished;
}

/** On this day was seen to its end page on `day`, so it does not open the room again that day. */
export function finishDay(day: string): void {
  if (!DAY_PATTERN.test(day)) return;
  const h = load();
  if (h.dayFinished === day) return;
  h.dayFinished = day;
  dirty = true;
}

/** "YYYY-MM-DD" on this phone's own calendar: the day the member is living in, not UTC's. */
export function localDay(ms = Date.now()): string {
  const d = new Date(ms);
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

/** What was looked at, what was posted, and the finished day — gone, file and all. */
export function forgetHistory(): void {
  history = { seen: new Map(), developed: new Map(), dayFinished: null };
  dirty = false;
  marks = 0;
  deleteDiskCache(FILE, KEY, IN_CACHE);
  oldFileLeft = false;
  deleteOldFile();
}
