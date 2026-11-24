/**
 * The screen kept awake while the replay plays, and only then: let go the
 * moment it is held, ends or closes.
 *
 * expo-keep-awake comes with Expo itself (Expo's own development tools use
 * it), so it is in every build without being listed among the app's
 * dependencies; on the web it asks the browser's Wake Lock, which may
 * quietly say no. It is reached through a guarded `require`, and every
 * call is caught: a build without it, or a browser without a wake lock,
 * only lets the screen sleep as it always does.
 */

/** The replay's own tag, so it never lets go of a wake lock another part of the app holds. */
export const KEEP_AWAKE_TAG = "vintage-replay";

interface KeepAwake {
  activateKeepAwakeAsync(tag?: string): Promise<void>;
  deactivateKeepAwake(tag?: string): Promise<void>;
}

let loaded: KeepAwake | null | undefined;

function keepAwake(): KeepAwake | null {
  if (loaded !== undefined) return loaded;
  try {
    loaded = require("expo-keep-awake") as KeepAwake;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Whether the replay has asked for the screen to stay awake, so each change is asked once. */
let awake = false;

export function stayAwake(on: boolean): void {
  if (on === awake) return;
  awake = on;
  try {
    const m = keepAwake();
    if (!m) return;
    if (on) m.activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    else m.deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
  } catch {
    // Nothing to keep the screen awake with: it sleeps as it always does.
  }
}
