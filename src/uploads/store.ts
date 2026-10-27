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
