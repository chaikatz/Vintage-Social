import { onlineManager, type InfiniteData, type QueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * Refreshing Home: from its newest page, in one request.
 *
 * The feed is a list of pages, and React Query refreshes a list of pages
 * by reading every one of them again, one after another, from the first.
 * A member a few hundred photographs down who pulled to refresh, tapped
 * Home, came back to the app or came back online waited on one request
 * per page loaded (twenty pages, twenty round trips in a row) before
 * anything changed: one request per page.
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
 * one read again. Should the reading fail (the server not answering, or
 * no signal), the pages the reader had are put back as they were, and
 * as old as they were, so a refresh that could not happen costs nothing:
 * left alone, the reader was down to the first page until they scrolled
 * the rest back in, online.
 *
 * With no signal a read neither fails nor lands: it is tried once, and
 * its further tries wait for the signal (src/lib/queryClient.ts). So
 * while the phone says it has none, nothing is let go and nothing asked
 * for (null); Home refreshes a reader at the top once it is back. And a
 * read the signal drops once it is out, which then waits, is taken for
 * one that failed: the pages are put back and the read called off, and
 * the signal's return finds the feed as stale as it was.
 */
export async function refreshFromFirstPage<R extends { isError: boolean }>(
  client: Pick<QueryClient, "getQueryData" | "getQueryState" | "setQueryData" | "getQueryCache" | "cancelQueries">,
  key: QueryKey,
  refetch: () => Promise<R>,
): Promise<R | null> {
  if (!onlineManager.isOnline()) return null;
  const before = client.getQueryData<InfiniteData<unknown, unknown>>(key);
  const updatedAt = client.getQueryState(key)?.dataUpdatedAt;
  const trimmed = firstPageOnly(before);
  if (trimmed === before) return refetch();
  client.setQueryData(key, trimmed);
  // As the cache holds it (it shares what it can with what it held before).
  const placed = client.getQueryData(key);
  // Put back only over the trimmed feed itself, never over anything newer.
  const putBack = () => {
    if (client.getQueryData(key) === placed) client.setQueryData(key, before, { updatedAt });
  };
  const query = client.getQueryCache().find({ queryKey: key, exact: true });
  let waiting = false;
  const stop = client.getQueryCache().subscribe((event) => {
    if (waiting || event.query !== query || event.type !== "updated" || event.action.type !== "pause") return;
    waiting = true;
    // Put back first: the read, called off, returns the feed to what it
    // held last, and that is now the pages.
    putBack();
    void client.cancelQueries({ queryKey: key, exact: true });
  });
  try {
    const result = await refetch();
    if (result.isError) putBack();
    return result;
  } finally {
    stop();
  }
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
