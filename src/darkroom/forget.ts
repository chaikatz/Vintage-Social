import { forgetHistory } from "./history";
import { forgetSetAside } from "./setAside";
import { forgetChapters, forgetIntro, forgetPlace } from "./session";

/**
 * Forgetting, in the two sizes a member can ask for.
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
 * Everything the Darkroom keeps on this phone — what was looked at and
 * posted, what was set aside, where the member was, that the first-visit
 * page was passed, and the positions in memory — gone, files and all.
 * Called whenever a member stops being the one signed in, so the next
 * member to sign in on this phone finds no trace of the last one's
 * browsing, and is shown the first-visit page and what it promises.
 */
export function forgetDarkroom(): void {
  each([forgetHistory, forgetSetAside, forgetPlace, forgetIntro, forgetChapters]);
}

/**
 * Settings' "Forget what the Darkroom has shown me": what was looked at,
 * what was posted, the finished day, and where the member was. The shelf
 * stays — those are photographs the member chose to keep, and putting
 * them back is theirs to do one by one.
 */
export function forgetDarkroomHistory(): void {
  each([forgetHistory, forgetPlace, forgetChapters]);
}

/**
 * Whether the member the Darkroom remembers for is no longer the one
 * signed in, so it must forget: `was` is who was signed in before
 * (undefined before anyone was known), `now` is who is signed in now.
 *
 * A change to nobody or to somebody else is a leaving, however the
 * session ended. So is a first answer of nobody: an app that launches
 * with nobody signed in may be one whose session ended while it was
 * closed, and nothing of the Darkroom can belong to nobody. Signing in
 * after nobody is not a leaving — there was nothing left to forget.
 */
export function memberLeft(was: string | null | undefined, now: string | null): boolean {
  return now === null ? was !== null : was != null && was !== now;
}
