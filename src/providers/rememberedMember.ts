import { deleteDiskCache, readDiskCache, writeDiskCache } from "@/utils/diskCache";
import type { ProfileRow } from "@/types/db";

/**
 * The signed-in member's profile as it was last read, kept on the phone so
 * the next launch opens on it.
 *
 * The door decides where to go from the profile: approved members to the
 * app, everyone else to the waitlist. It used to wait on the splash for a
 * fresh read every launch, a round trip at best and, on a weak or absent
 * signal, as long as the read kept failing. The profile last read for the
 * same member is a good enough answer to open the app on; the fresh read
 * follows at once and replaces it, and a change it brings (a membership
 * that was suspended) moves the member on from there.
 *
 * One member's at a time, kept with their id and only ever given back for
 * that id. It goes with the session: at "Sign out", and when auth says the
 * session has left the phone. It is kept in the cache folder: not backed
 * up with the phone, and no loss if iOS empties it, as that only means one
 * launch waits for the read again.
 */

const FILE = "member.json";
const KEY = "vintage.member";
const IN_CACHE = { dir: "cache" } as const;

interface Remembered {
  v: 1;
  id: string;
  profile: ProfileRow;
}

/** The file as it was written, checked as if it were not ours: an older build's, or a damaged one, is no answer. */
export function parseRemembered(raw: unknown): Remembered | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.id !== "string" || r.id === "") return null;
  const p = r.profile as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  if (p.id !== r.id || typeof p.username !== "string" || typeof p.status !== "string" || typeof p.role !== "string") {
    return null;
  }
  return { v: 1, id: r.id, profile: p as unknown as ProfileRow };
}

/** What was last written, so the same profile read again is not written again. */
let lastWritten: string | null = null;

/** The profile last read for this member on this phone, or null. */
export function recallMember(userId: string): ProfileRow | null {
  if (!userId) return null;
  const remembered = readDiskCache(FILE, KEY, parseRemembered, IN_CACHE);
  return remembered && remembered.id === userId ? remembered.profile : null;
}

/** Keep the profile just read, for the next launch. */
export function rememberMember(profile: ProfileRow): void {
  if (!profile?.id) return;
  const value: Remembered = { v: 1, id: profile.id, profile };
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return;
  }
  if (text === lastWritten) return;
  lastWritten = text;
  writeDiskCache(FILE, KEY, value, IN_CACHE);
}

/** The session has gone: nothing of this member is opened on again. */
export function forgetMember(): void {
  lastWritten = null;
  deleteDiskCache(FILE, KEY, IN_CACHE);
}
