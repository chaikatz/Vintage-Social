import type { InfiniteData, QueryClient } from "@tanstack/react-query";
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
 * Prepend into ['feed', userId] and ['user-posts', userId], then mark both
 * stale without refetching. The feed pages by offset: the prepended row
 * pushes everything along by one, so a refetch of every page now would be
 * wasted work, and the next page simply repeats one row, which Home drops
 * by id. When the feed has nothing loaded yet there is nothing to put the
 * row into, so that one query is refetched instead.
 */
export function placeConfirmedPost(queryClient: QueryClient, userId: string, row: PostWithAuthor): void {
  const feedKey = ["feed", userId];
  const hadFeed = queryClient.getQueryData(feedKey) != null;
  queryClient.setQueryData<InfiniteData<PostWithAuthor[]>>(feedKey, (data) => prependToFeed(data, row));
  queryClient.setQueryData<PostRow[]>(["user-posts", userId], (list) => prependToList(list, withoutAuthor(row)));
  void queryClient.invalidateQueries({ queryKey: feedKey, refetchType: hadFeed ? "none" : "active" });
  void queryClient.invalidateQueries({ queryKey: ["user-posts", userId], refetchType: "none" });
}
