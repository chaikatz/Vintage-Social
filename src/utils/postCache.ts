import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import type { PostRow } from "@/types/db";

/**
 * One post, changed everywhere it is already on screen.
 *
 * A post lives in several caches at once: the feed's pages, a profile's
 * grid, the photographs a member was tagged in, explore, and its own page.
 * When its words change, every copy is rewritten in place so the change
 * shows at once wherever the reader happens to be looking — the refetch
 * that follows only confirms it.
 *
 * Pure over the cache shapes: a list of rows, a list of pages of rows, or
 * one row. Anything else is left alone.
 */
export function rewritePostEverywhere<T extends Pick<PostRow, "id">>(
  queryClient: QueryClient,
  postId: string,
  change: (post: T) => T,
): void {
  const rewrite = (value: unknown): unknown =>
    rewriteValue(value, postId, change as unknown as (p: { id: string }) => { id: string });
  for (const key of ["feed", "user-posts", "tagged-posts", "explore", "post", "memories"] as const) {
    queryClient.setQueriesData({ queryKey: [key] }, rewrite);
  }
}

/** The same rewrite, over whatever shape the cache holds. Exported for tests. */
export function rewriteValue<P extends { id: string }>(
  value: unknown,
  postId: string,
  change: (post: P) => P,
): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    let touched = false;
    const next = value.map((item) => {
      const out = rewriteValue(item, postId, change);
      if (out !== item) touched = true;
      return out;
    });
    return touched ? next : value;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.id === "string" && obj.id === postId && "media_path" in obj) {
      return change(obj as unknown as P);
    }
    // react-query's infinite shape: { pages: [...], pageParams: [...] }
    if (Array.isArray(obj.pages)) {
      const pages = rewriteValue(obj.pages, postId, change);
      return pages === obj.pages ? value : { ...obj, pages };
    }
  }
  return value;
}

/**
 * The caches that hold lists of posts: the feed's pages, every member's
 * grid and the photographs they were tagged in, explore. Home, a profile's
 * Posted, Taken, Timeline, Map and Places, the Eras and On this day all
 * draw from these, so a post gone from them is gone from every one.
 */
const POST_LISTS = ["feed", "user-posts", "tagged-posts", "explore", "memories"] as const;

/**
 * Keyed by the one post, and about nothing else. Its own page is among
 * them but handled apart: see `removePostEverywhere`.
 */
const ABOUT_THE_POST = ["comments", "post-tags", "likers", "share-link"] as const;

/**
 * Elsewhere the post shows up, kept by the server and changed by the
 * delete itself: its likes and comments as notices, the messages it was
 * sent in, which now carry no photograph, and its author's post count.
 * Read again where on screen.
 */
const CHANGED_BY_THE_DELETE = ["activity", "conversations", "messages", "profile", "profile-by-id"] as const;

/**
 * One post, deleted: gone from everywhere it is on screen, at once.
 *
 * Until now the lists were only refetched, so a deleted post stayed in the
 * grid until the network answered, and wherever nothing refetched (the
 * photographs someone was tagged in, a message that carried it) it stayed
 * longer. Now it is taken out of every list by hand first, the way
 * `rewritePostEverywhere` changes a caption, and the refetch that follows
 * only confirms it. A read of a list already out is called off before the
 * row is taken out, because it may have left before the delete and would
 * put the row back when it landed; the refetch asks again.
 *
 * Its own page may still be on screen, on its way out: the post is
 * deleted from that page's "…". That page keeps what it shows until it
 * has gone, rather than flashing "This photograph is gone" while it slides
 * away, and only then is the post set to null, so a link to it later (a
 * message, a notification) says it is gone at once. Comments, tags, likers
 * and the share link of the post are let go the same way.
 *
 * The likes and comment previews are keyed by the ids on screen, so the
 * next read after the row has gone asks for a new key by itself; nothing
 * is done to them.
 */
export async function removePostEverywhere(queryClient: QueryClient, postId: string): Promise<void> {
  await Promise.all(POST_LISTS.map((key) => queryClient.cancelQueries({ queryKey: [key] })));
  for (const key of POST_LISTS) {
    queryClient.setQueriesData({ queryKey: [key] }, (value: unknown) => removeValue(value, postId));
  }
  void queryClient.cancelQueries({ queryKey: ["post", postId], exact: true });
  onceUnobserved(queryClient, ["post", postId], (query) => queryClient.setQueryData(query.queryKey, null));
  for (const key of ABOUT_THE_POST) {
    onceUnobserved(queryClient, [key, postId], (query) =>
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true }),
    );
  }
  for (const key of [...POST_LISTS, ...CHANGED_BY_THE_DELETE]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/**
 * Runs `then` for each query under `queryKey` as soon as no screen is
 * showing it: at once when none is, else when the last one lets go.
 */
function onceUnobserved(queryClient: QueryClient, queryKey: QueryKey, then: (query: Query) => void): void {
  const cache = queryClient.getQueryCache();
  for (const query of cache.findAll({ queryKey })) {
    if (query.getObserversCount() === 0) {
      then(query);
      continue;
    }
    const unsubscribe = cache.subscribe((event) => {
      if (event.query !== query) return;
      if (event.type === "removed") {
        unsubscribe();
      } else if (event.type === "observerRemoved" && query.getObserversCount() === 0) {
        unsubscribe();
        then(query);
      }
    });
  }
}

/**
 * The post taken out of whatever list shape the cache holds: a list of
 * rows, or react-query's infinite `{ pages, pageParams }`, whose pages
 * keep their number (a page left empty stays, so pageParams still line up
 * with it). Anything else, and a list without the post, is returned as it
 * was. Pure; exported for tests.
 */
export function removeValue(value: unknown, postId: string): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    const isThePost = (item: unknown) =>
      item != null &&
      typeof item === "object" &&
      (item as { id?: unknown }).id === postId &&
      "media_path" in (item as object);
    return value.some(isThePost) ? value.filter((item) => !isThePost(item)) : value;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.pages)) {
      let touched = false;
      const pages = obj.pages.map((page) => {
        const out = removeValue(page, postId);
        if (out !== page) touched = true;
        return out;
      });
      return touched ? { ...obj, pages } : value;
    }
  }
  return value;
}
