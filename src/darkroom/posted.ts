import { flushHistory, recordDeveloped } from "./history";
import { putBack } from "./setAside";
import { advancePlace } from "./session";

/**
 * A photograph developed in the Darkroom has been posted. Three things
 * follow, on this phone only:
 *
 * - history remembers it was posted, so Surprise does not offer it again
 *   for a year and its caption can say when it went up;
 * - it comes off the shelf, if it was set aside — it is no longer waiting
 *   to be decided on;
 * - the place moves on past it, so going back in starts at the next
 *   print rather than the one just shared.
 *
 * Each file is written once. Called by compose after the post exists, so
 * nothing here may throw: a failure costs a repeat later, never the post.
 */
export function markDeveloped(assetId: string, at = Date.now()): void {
  if (!assetId) return;
  try {
    recordDeveloped(assetId, at);
    flushHistory();
  } catch {
    // Best-effort, as above.
  }
  try {
    putBack(assetId);
  } catch {
    // Best-effort, as above.
  }
  try {
    advancePlace(assetId);
  } catch {
    // Best-effort, as above.
  }
}
