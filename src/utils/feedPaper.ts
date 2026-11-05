import { useSyncExternalStore } from "react";
import { DynamicColorIOS, Platform, type ColorValue } from "react-native";
import { colors, dark } from "@/theme";
import { readDiskCache, writeDiskCache } from "@/utils/diskCache";
import { useFeedLayout } from "@/utils/feedLayout";

/**
 * Editorial (Preview): the paper the prints are set on, part of the same
 * trial as the layout (see src/utils/feedLayout.ts).
 *
 * Off-white is the app's own paper, the one the prints were first set on.
 * White is plain white. It is one or the other for the whole feed, never
 * both: the screen behind the prints, the bar at its top and every print
 * are the one paper. In the dark appearance both are the dark print's
 * black, as the rest of the app is.
 *
 * Kept as the layout is: one small file in Documents, read once, written
 * the moment it is changed, never sent anywhere, and left at sign-out.
 * EDITORIAL_FEED_PREVIEW.md says how to take it out with the rest.
 */

export type FeedPaper = "off-white" | "white";

/** The choices, in the order Settings offers them. The first is the default. */
export const FEED_PAPERS: readonly { value: FeedPaper; label: string }[] = [
  { value: "off-white", label: "Off-white" },
  { value: "white", label: "White" },
];

const FILE = "feed-paper.json";
const KEY = "vintage.feed-paper";

/** Anything but a stored "white" is the off-white. */
export function parseFeedPaper(raw: unknown): FeedPaper {
  return raw === "white" ? "white" : "off-white";
}

let paper: FeedPaper | null = null;
const listeners = new Set<() => void>();

/** The paper in effect, read from the phone the first time it is asked for. */
export function getFeedPaper(): FeedPaper {
  if (paper === null) paper = readDiskCache(FILE, KEY, parseFeedPaper) ?? "off-white";
  return paper;
}

/** Takes effect at once on a feed already drawn, and is kept for the next launch. */
export function setFeedPaper(next: FeedPaper): void {
  if (getFeedPaper() === next) return;
  paper = next;
  writeDiskCache(FILE, KEY, next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe a component to the paper, so a change in Settings redraws it. */
export function useFeedPaper(): FeedPaper {
  return useSyncExternalStore(subscribe, getFeedPaper, getFeedPaper);
}

/** White on the light print; the dark print keeps its black. */
const WHITE: ColorValue = Platform.OS === "ios" ? DynamicColorIOS({ light: "#FFFFFF", dark: dark.paper }) : "#FFFFFF";

const PAPERS: Record<FeedPaper, { backgroundColor: ColorValue }> = {
  "off-white": { backgroundColor: colors.paper },
  white: { backgroundColor: WHITE },
};

/** A print, or anything around one, on the paper chosen. */
export function paperStyle(choice: FeedPaper): { backgroundColor: ColorValue } {
  return PAPERS[choice];
}

/**
 * What a screen of posts lies on, and the bars around it: the paper chosen
 * here while the feed is Editorial, and otherwise the app's own, the
 * off-white, exactly as it has always been.
 */
export function useFeedBackground(): { backgroundColor: ColorValue } {
  const layout = useFeedLayout();
  const choice = useFeedPaper();
  return paperStyle(layout === "editorial" ? choice : "off-white");
}

/** Test seam: listen the way a component does, without rendering one. */
export function __subscribeToPaperForTest(listener: () => void): () => void {
  return subscribe(listener);
}

/** Test seam: forget what was read, so the next ask reads the phone again. */
export function __resetFeedPaperForTest(): void {
  paper = null;
  listeners.clear();
}
