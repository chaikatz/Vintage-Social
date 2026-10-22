import { deleteDiskCache, readDiskCache, writeDiskCache } from "@/utils/diskCache";
import { forgetHistory, reopenHistory, sealHistory } from "./history";
import { forgetSetAside, reopenSetAside, sealSetAside } from "./setAside";
import { forgetChapters, forgetIntro, forgetPlace, reopenSession, sealSession } from "./session";

/**
 * Forgetting, in the two sizes a member can ask for, and the record of
 * whose the Darkroom on this phone is.
 *
 * Each part is tried on its own, so one that fails never keeps the rest
 * from going — and neither may ever fail what called it: signing out
 * must sign out.
 */
function each(steps: (() => void)[]): void {
  for (const step of steps) {
    try {
      step();
    } catch {
      // Best-effort, as above.
    }
  }
}

/**
 * The member the Darkroom's files were kept for, by their account's id,
 * in Documents beside the shelf and the place. Nothing of the library is
 * in it.
 */
const OWNER_FILE = "darkroom-owner.json";
const OWNER_KEY = "vintage.darkroom-owner";

/** The stored owner's id, or null for a file that is missing or does not fit. */
export function parseOwner(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return r.v === 1 && typeof r.id === "string" && r.id.length > 0 ? r.id : null;
}

function forgetOwner(): void {
  deleteDiskCache(OWNER_FILE, OWNER_KEY);
}

/**
 * Everything the Darkroom keeps on this phone — what was looked at and
 * posted, what was set aside, where the member was, that the first-visit
 * page was passed, the positions in memory, and whose it all was — gone,
 * files and all. Called when the member signs out, here or anywhere, so
 * the next member to sign in on this phone finds no trace of the last
 * one's browsing, and is shown the first-visit page and what it promises.
 *
 * The writes are shut first and stay shut until a member is next signed
 * in (`claimDarkroom`). The room may still be open when a session ends
 * from elsewhere, and it puts the place and the history away as it is
 * left; without the seal it would write the forgotten member's place
 * straight back for the next one.
 */
export function forgetDarkroom(): void {
  each([
    sealHistory,
    sealSetAside,
    sealSession,
    forgetHistory,
    forgetSetAside,
    forgetPlace,
    forgetIntro,
    forgetChapters,
    forgetOwner,
  ]);
}

/**
 * Settings' "Forget what the Darkroom has shown me": what was looked at,
 * what was posted, the finished day, and where the member was. The shelf
 * stays — those are photographs the member chose to keep, and putting
 * them back is theirs to do one by one. The member stays signed in, so
 * nothing is sealed.
 */
export function forgetDarkroomHistory(): void {
  each([forgetHistory, forgetPlace, forgetChapters]);
}

/**
 * `userId` is signed in: the Darkroom on this phone is theirs from now on.
 *
 * Files kept for someone else are forgotten first, and so are files kept
 * for nobody on record, which only a build from before the record could
 * have left. Files kept for this member stay: a launch with no network
 * and an expired token answers "nobody" for a while, and a member who
 * never signed out must not come back to an empty shelf. Then the writes
 * a forgetting shut are opened again, with whatever memory was kept while
 * they were shut let go.
 */
export function claimDarkroom(userId: string): void {
  if (!userId) return;
  each([
    () => {
      if (readDiskCache(OWNER_FILE, OWNER_KEY, parseOwner) === userId) return;
      forgetDarkroom();
      writeDiskCache(OWNER_FILE, OWNER_KEY, { v: 1, id: userId });
    },
    reopenHistory,
    reopenSetAside,
    reopenSession,
  ]);
}
