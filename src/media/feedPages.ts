import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";

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

/**
 * A refresh from the newest page: every page but the first let go, that
 * one read again. Should the reading fail (offline, the server not
 * answering), the pages the reader had are put back as they were, and
 * as old as they were, so a refresh that could not happen costs nothing:
 * left alone, the reader was down to the first page until they scrolled
 * the rest back in, online.
 */
export async function refreshFromFirstPage<R extends { isError: boolean }>(
  client: Pick<QueryClient, "getQueryData" | "getQueryState" | "setQueryData">,
  key: QueryKey,
  refetch: () => Promise<R>,
): Promise<R> {
  const before = client.getQueryData<InfiniteData<unknown, unknown>>(key);
  const updatedAt = client.getQueryState(key)?.dataUpdatedAt;
  const trimmed = firstPageOnly(before);
  if (trimmed === before) return refetch();
  client.setQueryData(key, trimmed);
  // As the cache holds it (it shares what it can with what it held before).
  const placed = client.getQueryData(key);
  const result = await refetch();
  // Put back only over the trimmed feed itself, never over anything newer.
  if (result.isError && client.getQueryData(key) === placed) client.setQueryData(key, before, { updatedAt });
  return result;
}

/** How far down the feed, in cards, a reader still counts as at the top. */
export const NEAR_TOP = 2;

/**
 * Whether coming back to the app (or back online) refreshes the feed: it
 * never loaded (opened offline, say: it is asked for again, as the query
 * itself would have), or the reader is at its top and what it shows is
 * older than a query's usual staleness. `seenIndex` is the last card
 * reported on screen, or -1.
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
  if (!(updatedAt > 0)) return true;
  if (seenIndex > NEAR_TOP) return false;
  return now - updatedAt >= staleMs;
}
