import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import type { PostRow, PostWithAuthor } from "@/types/db";
import type { PostDraft, PreparedMedia } from "./types";

/**
 * The server has the post: put it in the feed and the profile at once.
 *
 * The row goes into the caches by hand rather than by refetching. A
 * refetch of the feed re-reads every page already loaded, one after the
 * other, plus the likes and comment previews keyed on their ids, and the
 * new post would only appear once all of that came back. The row is the
 * one the server just accepted, so it is known exactly; only its media
 * paths are the phone's own files, which `mediaUrl` passes straight
 * through, so the card draws at once from disk instead of fetching back
 * from the CDN what was just uploaded. The next ordinary refetch replaces
 * it with the stored row.
 */

export interface ConfirmedRowInput {
  draft: PostDraft;
  prepared: PreparedMedia;
  /** Local file addresses for drawing it now. */
  mediaUri: string;
  thumbUri: string | null;
  createdAt: string;
}

export function confirmedRow({ draft, prepared, mediaUri, thumbUri, createdAt }: ConfirmedRowInput): PostWithAuthor {
  return {
    id: draft.id,
    author_id: draft.userId,
    media_type: draft.kind,
    media_path: mediaUri,
    thumb_path: thumbUri,
    width: prepared.width,
    height: prepared.height,
    duration_seconds: draft.kind === "video" ? prepared.duration : null,
    filter_id: draft.filterId,
    filter_baked: prepared.baked,
    show_date_stamp: draft.showDateStamp,
    caption: draft.caption.trim(),
    taken_at: draft.takenAt,
    // As it was inserted, so the refetched row changes nothing on screen.
    location: draft.location?.trim() || null,
    lat: draft.lat,
    lng: draft.lng,
    place_id: draft.placeId,
    like_count: 0,
    comment_count: 0,
    created_at: createdAt,
    removed_at: null,
    removed_by: null,
    author: { ...draft.author },
  };
}

/** The feed's pages with the row on top of the first, unless it is already somewhere in them. */
export function prependToFeed(
  data: InfiniteData<PostWithAuthor[]> | undefined,
  row: PostWithAuthor,
): InfiniteData<PostWithAuthor[]> | undefined {
  if (!data || !Array.isArray(data.pages)) return data;
  if (data.pages.some((page) => page.some((p) => p.id === row.id))) return data;
  const [first = [], ...rest] = data.pages;
  return { ...data, pages: [[row, ...first], ...rest] };
}

/** A flat list (the profile grid) with the row on top, unless it is already there. */
export function prependToList<T extends { id: string }>(list: T[] | undefined, row: T): T[] | undefined {
  if (!Array.isArray(list)) return list;
  if (list.some((p) => p.id === row.id)) return list;
  return [row, ...list];
}

function withoutAuthor(row: PostWithAuthor): PostRow {
  const { author: _author, ...rest } = row;
  return rest;
}

/**
 * Posts the member deleted in this run of the app. A confirmed post is put
 * back into the feed and the grid after a read that was already out lands
 * (below), and that read may have left before the delete did; a post
 * deleted meanwhile is not put back. Ids are never reused, so remembering
 * them until the app closes costs nothing.
 */
const deletedIds = new Set<string>();

/** The member deleted this post: never place it again. Called through the outbox's notePostDeleted. */
export function markPostDeleted(id: string): void {
  deletedIds.add(id);
}

/** Whether the feed's pages hold the row. */
export function feedHas(data: InfiniteData<PostWithAuthor[]> | undefined, id: string): boolean {
  return Boolean(data?.pages?.some((page) => page.some((p) => p.id === id)));
}

/**
 * Resolves once a fetch of this query that is already out has finished:
 * true then, or at once when none is out; false if the query is dropped
 * from the cache first. A fetch that started before the post existed
 * ends by writing pages read without it (a refetch reads them afresh, and
 * a next page is added to the pages as they were when it began), so
 * whatever was put in by hand meanwhile is gone when it lands.
 */
function fetchSettled(queryClient: QueryClient, key: QueryKey): Promise<boolean> {
  const cache = queryClient.getQueryCache();
  const query = cache.find({ queryKey: key, exact: true });
  if (!query || query.state.fetchStatus === "idle") return Promise.resolve(query != null);
  return new Promise((resolve) => {
    const unsubscribe = cache.subscribe((event) => {
      if (event.query !== query) return;
      if (event.type === "removed") {
        unsubscribe();
        resolve(false);
      } else if (event.type === "updated" && query.state.fetchStatus === "idle") {
        unsubscribe();
        resolve(true);
      }
    });
  });
}

/**
 * Prepend into ['feed', userId] and ['user-posts', userId], then mark both
 * stale without refetching. The feed pages by offset: the prepended row
 * pushes everything along by one, so a refetch of every page now would be
 * wasted work, and the next page simply repeats one row, which Home drops
 * by id. When the feed has nothing loaded yet there is nothing to put the
 * row into, so that one query is refetched instead.
 *
 * A pull to refresh or a next page already on its way would overwrite the
 * row (and the stale mark) when it lands, so where one is out the row is
 * put back once it has. Resolves, after that, with whether the feed holds
 * the row: the pending card hands over to it then, and not before.
 *
 * A post the member has deleted is never placed, at first or later.
 */
export function placeConfirmedPost(queryClient: QueryClient, userId: string, row: PostWithAuthor): Promise<boolean> {
  const feedKey = ["feed", userId];
  const gridKey = ["user-posts", userId];
  const placeInFeed = (refetchType: "none" | "active") => {
    if (deletedIds.has(row.id)) return;
    queryClient.setQueryData<InfiniteData<PostWithAuthor[]>>(feedKey, (data) => prependToFeed(data, row));
    // After the write: setting the data clears the stale mark.
    void queryClient.invalidateQueries({ queryKey: feedKey, refetchType });
  };
  const placeInGrid = () => {
    if (deletedIds.has(row.id)) return;
    queryClient.setQueryData<PostRow[]>(gridKey, (list) => prependToList(list, withoutAuthor(row)));
    void queryClient.invalidateQueries({ queryKey: gridKey, refetchType: "none" });
  };
  const hadFeed = queryClient.getQueryData(feedKey) != null;
  placeInFeed(hadFeed ? "none" : "active");
  placeInGrid();
  if (fetchOut(queryClient, gridKey)) {
    void fetchSettled(queryClient, gridKey).then((alive) => {
      if (alive) placeInGrid();
    });
  }
  const inFeed = () => feedHas(queryClient.getQueryData<InfiniteData<PostWithAuthor[]>>(feedKey), row.id);
  if (!fetchOut(queryClient, feedKey)) return Promise.resolve(inFeed());
  return fetchSettled(queryClient, feedKey).then((alive) => {
    if (alive) placeInFeed("none");
    return inFeed();
  });
}

function fetchOut(queryClient: QueryClient, key: QueryKey): boolean {
  const status = queryClient.getQueryState(key)?.fetchStatus;
  return status != null && status !== "idle";
}
