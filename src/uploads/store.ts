import { useSyncExternalStore } from "react";
import type { PendingPost } from "./types";

/**
 * The pending posts, as a module-level store read with useSyncExternalStore.
 *
 * It lives here, above the navigator, rather than in a provider or a
 * screen's state: leaving compose for Home can remount the whole tab tree,
 * and a post that is still going up must not vanish with it. Every reader
 * gets the same frozen array until something changes, which is what
 * useSyncExternalStore needs to avoid re-rendering for nothing.
 */

const EMPTY: readonly PendingPost[] = Object.freeze([]);
let snapshot: readonly PendingPost[] = EMPTY;
const listeners = new Set<() => void>();

export function getPendingPosts(): readonly PendingPost[] {
  return snapshot;
}

export function setPendingPosts(next: readonly PendingPost[]): void {
  snapshot = next.length === 0 ? EMPTY : Object.freeze([...next]);
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One reader's failure is not the store's.
    }
  }
}

export function subscribePendingPosts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePendingPosts(): readonly PendingPost[] {
  return useSyncExternalStore(subscribePendingPosts, getPendingPosts, getPendingPosts);
}

/**
 * Whether Home should go to the top for these pending cards: a card it
 * has not seen yet (a post just shared), or one that has just failed
 * while Home was out of sight. The cards are the list's header, so a
 * member who had scrolled down would otherwise come back mid-feed with no
 * sign of either. A card already seen, or failed in view, is no reason
 * to move anyone. `seen` is Home's memory of each card's last state, and
 * is brought up to date here.
 */
export function pendingNeedsTop(
  seen: Map<string, PendingPost["state"]>,
  pending: readonly Pick<PendingPost, "id" | "state">[],
  homeInView: boolean,
): boolean {
  let toTop = false;
  for (const p of pending) {
    const before = seen.get(p.id);
    if (before === undefined) toTop = true;
    else if (p.state === "failed" && before !== "failed" && !homeInView) toTop = true;
    seen.set(p.id, p.state);
  }
  return toTop;
}
