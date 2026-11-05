import type { InfiniteData } from "@tanstack/react-query";

/**
 * Refreshing Home: from its newest page, in one request.
 *
 * The feed is a list of pages, and React Query refreshes a list of pages
 * by reading every one of them again, one after another, from the first.
 * A member a few hundred photographs down who pulled to refresh, tapped
 * Home, came back to the app or came back online waited on one request
 * per page loaded (twenty pages, twenty round trips in a row) before
 * anything changed, and the deeper pages cost the database more each time
 * (they are read by offset).
 *
 * Now a refresh drops every page but the first and reads that one: the
 * newest photographs, which is what a refresh is for, and the rest load
 * again as the reader scrolls. Coming back to the app or back online
 * refreshes the same way, and only for a reader at the top of the feed;
 * one further down keeps their place and their pages, and refreshes when
 * they ask to (pull, or tap Home).
 */

/** The feed with only its first page, or as it was when it has no more than one. */
export function firstPageOnly<T, P>(data: InfiniteData<T, P> | undefined): InfiniteData<T, P> | undefined {
  if (!data || !Array.isArray(data.pages) || data.pages.length <= 1) return data;
  return { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) };
}

/** How far down the feed, in cards, a reader still counts as at the top. */
export const NEAR_TOP = 2;

/**
 * Whether coming back to the app (or back online) refreshes the feed: the
 * reader is at its top, and what it shows is older than a query's usual
 * staleness. `seenIndex` is the last card reported on screen, or -1.
 */
export function refreshOnReturn({
  seenIndex,
  updatedAt,
  now,
  staleMs,
}: {
  seenIndex: number;
  updatedAt: number;
  now: number;
  staleMs: number;
}): boolean {
  if (seenIndex > NEAR_TOP) return false;
  if (!(updatedAt > 0)) return false;
  return now - updatedAt >= staleMs;
}
