import { makeLazyWriter, readDiskCache, writeDiskCache } from "@/utils/diskCache";

/**
 * What the Darkroom remembers between visits, so the twentieth visit is
 * not the first one again: which photographs were looked at lately, and
 * which were developed and posted.
 *
 * Only the library's own identifiers and a time are kept, in one small
 * file on this phone. Not a pixel, not a date of the photograph, not a
 * place, and nothing of it is ever sent anywhere. Nothing is suppressed
 * for good: a photograph looked at is passed over for a few weeks and
 * then comes round again like any other.
 */

const FILE = "darkroom-history.json";
const KEY = "vintage.darkroom-history";

/** How many looked-at photographs are remembered; the oldest are let go first. */
export const SEEN_LIMIT = 3000;
export const DEVELOPED_LIMIT = 1000;
/** A photograph looked at is left alone this long before Surprise offers it again. */
export const QUIET_DAYS = 21;
const DAY_MS = 86_400_000;

type Entries = [string, number][];

/** The stored file, checked entry by entry: a file from another build is not trusted blindly. */
export function parseHistory(raw: unknown): { seen: Entries; developed: Entries } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const entries = (v: unknown): Entries =>
    Array.isArray(v)
      ? v.filter(
          (e): e is [string, number] =>
            Array.isArray(e) && typeof e[0] === "string" && e[0].length > 0 && typeof e[1] === "number" && Number.isFinite(e[1]),
        )
      : [];
  return { seen: entries(r.seen), developed: entries(r.developed) };
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

let seen: Map<string, number> | null = null;
let developed: Map<string, number> = new Map();

function load(): Map<string, number> {
  if (seen) return seen;
  const stored = readDiskCache(FILE, KEY, parseHistory);
  seen = new Map(stored?.seen ?? []);
  developed = new Map(stored?.developed ?? []);
  return seen;
}

const persist = makeLazyWriter(() =>
  writeDiskCache(FILE, KEY, { seen: [...load().entries()], developed: [...developed.entries()] }),
);

export function markSeen(id: string, at = Date.now()): void {
  remember(load(), id, at, SEEN_LIMIT);
  persist();
}

export function seenRecently(id: string, now = Date.now(), days = QUIET_DAYS): boolean {
  const at = load().get(id);
  return at != null && now - at < days * DAY_MS;
}

/** The photograph was developed and posted to VINTAGE. */
export function markDeveloped(id: string, at = Date.now()): void {
  load();
  remember(developed, id, at, DEVELOPED_LIMIT);
  persist();
}

/** A photograph posted from this phone is not offered as a rediscovery for a year after. */
export const DEVELOPED_QUIET_DAYS = 365;

export function developedRecently(id: string, now = Date.now(), days = DEVELOPED_QUIET_DAYS): boolean {
  load();
  const at = developed.get(id);
  return at != null && now - at < days * DAY_MS;
}

/** When the photograph was posted from this phone, or null. */
export function developedAt(id: string): number | null {
  load();
  return developed.get(id) ?? null;
}

/** Everything the Darkroom keeps, gone — on sign-out, so the next member on this phone starts clean. */
export function forgetHistory(): void {
  seen = new Map();
  developed = new Map();
  writeDiskCache(FILE, KEY, { seen: [], developed: [] });
}
