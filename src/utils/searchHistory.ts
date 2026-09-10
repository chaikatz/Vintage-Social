import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import type { ProfileRow } from "@/types/db";

/**
 * Who you looked for lately.
 *
 * A short list of the members you opened from Search, kept on the phone
 * and nowhere else: it is a convenience for the person typing, not a
 * signal about anyone. Nothing is sent, nothing is synced, and clearing it
 * clears it. Fifteen is plenty — beyond that it stops being "recent".
 */

export type RecentSearch = Pick<ProfileRow, "id" | "username" | "full_name" | "avatar_url">;

export const RECENT_MAX = 15;

/** The list with `entry` at the front, once, and the oldest dropped. Pure. */
export function pushRecent(list: readonly RecentSearch[], entry: RecentSearch, max = RECENT_MAX): RecentSearch[] {
  const rest = list.filter((r) => r.id !== entry.id);
  return [entry, ...rest].slice(0, max);
}

/** The list without `id`. Pure. */
export function dropRecent(list: readonly RecentSearch[], id: string): RecentSearch[] {
  return list.filter((r) => r.id !== id);
}

/** Only rows that still look like a member — the file is ours, but read it as if it weren't. */
export function parseRecent(raw: string | null | undefined): RecentSearch[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentSearch[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.username !== "string") continue;
      out.push({
        id: r.id,
        username: r.username,
        full_name: typeof r.full_name === "string" ? r.full_name : null,
        avatar_url: typeof r.avatar_url === "string" ? r.avatar_url : null,
      });
    }
    return out.slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Persistence. One small JSON file in the app's documents folder on the
// phone; localStorage in the browser review build. Every read and write is
// best-effort — a history that fails to save is not worth an error.
// ---------------------------------------------------------------------------

const KEY = "vintage.recent-searches";
const FILE = "recent-searches.json";

function readRaw(): string | null {
  try {
    if (Platform.OS === "web") {
      return typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    }
    const file = new File(Paths.document, FILE);
    return file.exists ? file.textSync() : null;
  } catch {
    return null;
  }
}

function writeRaw(raw: string): void {
  try {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") localStorage.setItem(KEY, raw);
      return;
    }
    const file = new File(Paths.document, FILE);
    if (!file.exists) file.create();
    file.write(raw);
  } catch {
    // Not worth an error — see above.
  }
}

export function loadRecent(): RecentSearch[] {
  return parseRecent(readRaw());
}

export function rememberRecent(entry: RecentSearch): RecentSearch[] {
  const next = pushRecent(loadRecent(), entry);
  writeRaw(JSON.stringify(next));
  return next;
}

export function forgetRecent(id: string): RecentSearch[] {
  const next = dropRecent(loadRecent(), id);
  writeRaw(JSON.stringify(next));
  return next;
}

export function clearRecent(): RecentSearch[] {
  writeRaw("[]");
  return [];
}
