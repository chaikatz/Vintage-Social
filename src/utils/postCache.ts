import type { QueryClient } from "@tanstack/react-query";
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
