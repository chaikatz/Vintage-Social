/**
 * Tapping Home while already on Home.
 *
 * The tab bar cannot see the feed's query and the feed cannot see the tab
 * bar, so the tap is passed as a plain event: the bar says "again", the
 * feed decides what that means (scroll to the top, refetch once). Nothing
 * else subscribes, and nothing is queued — a tap with no listener is a tap
 * that did nothing, which is what it should be.
 */
const listeners = new Set<() => void>();

export function onHomeAgain(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitHomeAgain(): void {
  for (const listener of listeners) listener();
}
