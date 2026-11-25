/**
 * How long the Post tab waits, once it is in front, before it asks the
 * library anything or draws a new page of the roll: by then the tab's
 * own slide (the pager's page change, about a quarter of a second) is
 * over, so the rows mounting never land in the middle of it.
 *
 * This is a timer, not InteractionManager.runAfterInteractions: React
 * Native 0.81 turns that into a bare setImmediate (its
 * disableInteractionManager flag is on by default, see
 * react-native/Libraries/Interaction/InteractionManager.js), so it no
 * longer waits for anything.
 */
export const TAB_SETTLE_MS = 280;

/** Runs `run` once the tab has settled; the function returned stops it, for a tab left first. */
export function afterTabSettles(run: () => void, ms: number = TAB_SETTLE_MS): () => void {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
}

/** The same wait, for a query: resolves once the tab has settled, or at once if the query was already stopped. */
export function tabSettled(signal?: AbortSignal, ms: number = TAB_SETTLE_MS): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
