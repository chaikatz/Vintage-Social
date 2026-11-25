/**
 * Tapping Post while already on Post, as Home's "again" is
 * (src/utils/homeRefresh.ts): the tab bar says "again", the Post tab
 * decides what that means — the roll back to the top, the newest
 * photograph selected, the newest page read once. Nothing is queued: a
 * tap with no listener is a tap that did nothing.
 */
const listeners = new Set<() => void>();

export function onPostAgain(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitPostAgain(): void {
  for (const listener of listeners) listener();
}
