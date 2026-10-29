import { useSyncExternalStore } from "react";
import { readDiskCache, writeDiskCache } from "@/utils/diskCache";

/**
 * Editorial (Preview): how Home sets out each post, a trial.
 *
 * Original is the feed as it has always been. Editorial is the same posts
 * and the same buttons, arranged as entries in a photographic journal (see
 * src/components/feed/EditorialPostCard.tsx). Only Home reads it; every
 * other screen that shows a post keeps the original card.
 *
 * A preference of the phone's, like the appearance: one small file in
 * Documents, read once when Home first draws, written the moment it is
 * changed, never sent anywhere. Signing out leaves it, as it leaves the
 * light or dark print; it says how this phone shows a feed, not anything
 * about the member.
 *
 * The experiment is meant to come out cleanly: delete this file and
 * src/components/feed/, and take back out the seam in Home (the
 * `FeedCard` line) and the Feed layout row in Settings that read it.
 */

export type FeedLayout = "original" | "editorial";

/** The choices, in the order Settings offers them. The first is the default. */
export const FEED_LAYOUTS: readonly { value: FeedLayout; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "editorial", label: "Editorial (Preview)" },
];

const FILE = "feed-layout.json";
const KEY = "vintage.feed-layout";

/** Anything but a stored "editorial" is the original feed. */
export function parseFeedLayout(raw: unknown): FeedLayout {
  return raw === "editorial" ? "editorial" : "original";
}

let layout: FeedLayout | null = null;
const listeners = new Set<() => void>();

/** The layout in effect, read from the phone the first time it is asked for. */
export function getFeedLayout(): FeedLayout {
  if (layout === null) layout = readDiskCache(FILE, KEY, parseFeedLayout) ?? "original";
  return layout;
}

/** Takes effect at once on a Home already drawn, and is kept for the next launch. */
export function setFeedLayout(next: FeedLayout): void {
  if (getFeedLayout() === next) return;
  layout = next;
  writeDiskCache(FILE, KEY, next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe a component to the layout, so a change in Settings redraws it. */
export function useFeedLayout(): FeedLayout {
  return useSyncExternalStore(subscribe, getFeedLayout, getFeedLayout);
}

/** Test seam: listen the way a component does, without rendering one. */
export function __subscribeForTest(listener: () => void): () => void {
  return subscribe(listener);
}

/** Test seam: forget what was read, so the next ask reads the phone again. */
export function __resetFeedLayoutForTest(): void {
  layout = null;
  listeners.clear();
}
