import { useSyncExternalStore } from "react";
import { Animated } from "react-native";

/**
 * Where the Post tab's pager stands, shared between the tab, which owns
 * the pager, and the header the tabs share (`TabHeader` in
 * app/(tabs)/_layout.tsx), which draws RECENT and MEMORY ROOM over it.
 *
 * `pagePosition` and `pageOffset` are the pager's own scroll, as
 * react-native-pager-view reports it: on the iPhone they are driven
 * natively (`Animated.event` with the native driver), so the header's two
 * inks cross over as the finger moves without a frame of JavaScript. Their
 * sum, `pageProgress`, is 0 on Recent and 1 on the door.
 *
 * `postPage` is the page the pager last came to rest on, for VoiceOver's
 * "selected"; `askPage` is the header's tap, which the tab answers.
 */
export const pagePosition = new Animated.Value(0);
export const pageOffset = new Animated.Value(0);
export const pageProgress = Animated.add(pagePosition, pageOffset);

export type PostPage = 0 | 1;

let current: PostPage = 0;
const pageListeners = new Set<() => void>();

/** The page the pager came to rest on. */
export function setPostPage(page: number): void {
  const next: PostPage = page === 1 ? 1 : 0;
  if (next === current) return;
  current = next;
  for (const l of pageListeners) l();
}

export function postPage(): PostPage {
  return current;
}

export function usePostPage(): PostPage {
  return useSyncExternalStore(
    (l) => {
      pageListeners.add(l);
      return () => pageListeners.delete(l);
    },
    () => current,
    () => 0,
  );
}

const askers = new Set<(page: PostPage) => void>();

/** The tab listens for the header's taps. */
export function onPageAsked(listener: (page: PostPage) => void): () => void {
  askers.add(listener);
  return () => askers.delete(listener);
}

/** The header's RECENT or MEMORY ROOM, tapped. Nothing is queued: a tap with no tab listening did nothing. */
export function askPage(page: PostPage): void {
  for (const l of askers) l(page);
}
