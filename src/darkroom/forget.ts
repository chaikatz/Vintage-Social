import { forgetHistory } from "./history";
import { forgetSetAside } from "./setAside";
import { forgetPlace } from "./session";

/**
 * Everything the Darkroom keeps on this phone — what was looked at, what
 * was set aside, where the member was — gone. Called on sign-out, so the
 * next member to sign in on this phone finds no trace of the last one's
 * browsing.
 */
export function forgetDarkroom(): void {
  try {
    forgetHistory();
    forgetSetAside();
    forgetPlace();
  } catch {
    // Best-effort: signing out must never fail on this.
  }
}
