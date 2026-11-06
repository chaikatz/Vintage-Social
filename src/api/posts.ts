import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import type { CommentWithAuthor, PostRow, PostWithAuthor, ProfileRow } from "@/types/db";
import { ROWS_PER_READ } from "@/utils/eraEdits";
import { withTimeout } from "@/utils/retry";
import { readInChunks } from "./batch";
import { pageAfter, type Cursor } from "./keyset";
import { functionMissing } from "./rpcMissing";

export const FEED_PAGE_SIZE = 12;

export const POST_WITH_AUTHOR = "*, author:profiles!posts_author_id_fkey(id, username, full_name, avatar_url)";

/**
 * Who the member follows, remembered for a minute.
 *
 * Every feed page used to cost two round trips in a row — the follow list,
 * then the posts — and the first of them is the same answer every time.
 * Keeping it briefly means the second page, and a pull-to-refresh, wait on
 * one query instead of two. Following or unfollowing forgets it at once.
 */
const FOLLOWING_TTL_MS = 60_000;
const followingCache = new Map<string, { ids: string[]; at: number }>();

export function forgetFollowingIds(userId: string): void {
  followingCache.delete(userId);
}

async function followingIds(userId: string): Promise<string[]> {
  const cached = followingCache.get(userId);
  if (cached && Date.now() - cached.at < FOLLOWING_TTL_MS) return cached.ids;
  const { data, error } = await supabase
    .from("follows")
    .select("followee_id")
    .eq("follower_id", userId)
    .eq("status", "accepted");
  if (error) throw error;
  const ids = (data ?? []).map((f) => f.followee_id as string);
  followingCache.set(userId, { ids, at: Date.now() });
  return ids;
}

/**
 * Until when the database is known to have no feed_page (migration 0025
 * not yet applied there): the feed is read the old way meanwhile, and the
 * function is looked for again after.
 */
let feedPageMissingUntil = 0;
const FEED_PAGE_RECHECK_MS = 10 * 60_000;

/** Forget whether feed_page is there (tests). */
export function forgetFeedPageMissing(): void {
  feedPageMissingUntil = 0;
}

/**
 * Where the next page of the feed starts: the last post the reader holds,
 * by the two things the feed is ordered by (./keyset).
 */
export type FeedCursor = Cursor;

/** The cursor after a page: its last post, or none when the page ended the feed. */
export function nextFeedCursor(page: Pick<PostRow, "id" | "created_at">[]): FeedCursor | undefined {
  if (page.length < FEED_PAGE_SIZE) return undefined;
  const last = page[page.length - 1];
  return { at: last.created_at, id: last.id };
}

/**
 * The home feed: strictly chronological, only accounts the member follows
 * (plus their own posts). No ranking, no suggestions.
 *
 * Asked of feed_page (migration 0025), which reads who the member follows
 * inside the database. The old way, below, puts every member followed
 * into the request's URL, which a few hundred follows outgrow (./batch):
 * the most engaged members' home feed stopped loading. The old way stays
 * for a database that does not have the function yet.
 *
 * A page is the posts after `before`, the last post of the page before
 * (none for the first). Counted by offset instead, a post deleted between
 * two pages made the next one skip a post, and a post arriving between
 * them made it repeat one.
 */
export async function fetchFeedPage(userId: string, before: FeedCursor | null): Promise<PostWithAuthor[]> {
  if (isDemoMode()) return demo.demoFetchFeedPage(userId, before, FEED_PAGE_SIZE);

  // A page is twelve photographs with their authors. A photograph whose
  // author the reader may not see comes without one (withAuthors) and is
  // left out; the page is then made up from the rows after it, so that a
  // page of fewer than twelve still means the feed has ended
  // (nextFeedCursor). A few reads at most: rows whose author is hidden
  // are rare (none on production in November 2026), and a run of them
  // longer than that ends the page early rather than reading on.
  const shown: PostWithAuthor[] = [];
  let after = before;
  for (let read = 0; read < FEED_FILL_READS; read++) {
    const rows = await readFeedRows(userId, after);
    shown.push(...withAuthors(rows));
    if (rows.length < FEED_PAGE_SIZE || shown.length >= FEED_PAGE_SIZE) break;
    const last = rows[rows.length - 1];
    after = { at: last.created_at, id: last.id };
  }
  return shown.slice(0, FEED_PAGE_SIZE);
}

/** Reads, at most, to make up one page of the feed (fetchFeedPage). */
export const FEED_FILL_READS = 4;

/**
 * The rows that came with their author. A photograph stays readable while
 * its author's profile may not be (an author outside the club: the posts
 * read policy asks only that the photograph be live and not private to
 * the reader, the profiles policy that the profile be a member's), and
 * such a row arrives with `author` null: a card with no name, no face
 * and nowhere to go. Not shown at all instead. Asking the database to
 * leave them out (the posts policy requiring a visible author) would read
 * every member's profile once for every read of photographs (a hashed
 * subplan over all of profiles, planned at 1,000 members), so it is done
 * here, on the page.
 */
export function withAuthors<T extends { author?: unknown }>(rows: T[]): T[] {
  return rows.filter((p) => p.author != null);
}

/** One read of the feed's rows after `before`, authors and all. */
async function readFeedRows(userId: string, before: FeedCursor | null): Promise<PostWithAuthor[]> {
  if (Date.now() >= feedPageMissingUntil) {
    // The order is asked of PostgREST too: the function's own order is
    // not promised to survive the query PostgREST wraps around it to join
    // the author, and sorting a page of twelve costs nothing.
    const { data, error } = await supabase
      .rpc(
        "feed_page",
        before ? { p_limit: FEED_PAGE_SIZE, p_before_at: before.at, p_before_id: before.id } : { p_limit: FEED_PAGE_SIZE },
      )
      .select(POST_WITH_AUTHOR)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (!error) return (data ?? []) as unknown as PostWithAuthor[];
    if (!functionMissing(error)) throw error;
    feedPageMissingUntil = Date.now() + FEED_PAGE_RECHECK_MS;
  }

  const authorIds = [userId, ...(await followingIds(userId))];

  const query = supabase
    .from("posts")
    .select(POST_WITH_AUTHOR)
    .in("author_id", authorIds)
    .is("removed_at", null);
  const { data, error } = await pageAfter(query, "created_at", "id", before)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(FEED_PAGE_SIZE);
  if (error) throw error;
  return (data ?? []) as unknown as PostWithAuthor[];
}

/**
 * Whose photographs came back cut short at their last read: as many as
 * PostgREST's max_rows (ROWS_PER_READ), where it stops without saying
 * so, and there may be more. Kept as each read lands, for Eras, which
 * lets nothing go over a list that may not be all of them (eraEditor,
 * pruned). Asked of the read, never of the list: a delete takes a
 * photograph off the list at once, so a read cut short at a thousand is
 * a list of 999 until the next read lands, or for as long as it fails.
 */
const cutShort = new Set<string>();

/** Whether the last read of a member's photographs may have stopped before their last. */
export function userPostsCutShort(authorId: string): boolean {
  return cutShort.has(authorId);
}

function noteRead(authorId: string, rows: PostRow[]): PostRow[] {
  if (rows.length >= ROWS_PER_READ) cutShort.add(authorId);
  else cutShort.delete(authorId);
  return rows;
}

/**
 * A member's own photographs, all of them up to PostgREST's max_rows
 * (1000), where it stops without saying so. Whether this read stopped
 * there is kept (userPostsCutShort).
 */
export async function fetchUserPosts(authorId: string): Promise<PostRow[]> {
  if (isDemoMode()) return noteRead(authorId, demo.demoFetchUserPosts(authorId));

  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("author_id", authorId)
    .is("removed_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return noteRead(authorId, (data ?? []) as PostRow[]);
}

export async function fetchPost(postId: string): Promise<PostWithAuthor | null> {
  if (isDemoMode()) return demo.demoFetchPost(postId);

  const { data, error } = await supabase
    .from("posts")
    .select(POST_WITH_AUTHOR)
    .eq("id", postId)
    .maybeSingle();
  if (error) throw error;
  const post = (data as unknown as PostWithAuthor | null) ?? null;
  // A photograph whose author the reader may not see (withAuthors) is,
  // for them, not there: the screen says so, as for one deleted.
  return post && post.author != null ? post : null;
}

export interface NewPost {
  id: string;
  author_id: string;
  media_type: "photo" | "video";
  media_path: string;
  thumb_path: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  filter_id: string;
  filter_baked: boolean;
  show_date_stamp: boolean;
  caption: string;
  taken_at: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
}

/** Photographs from across VINTAGE — the one surface showing work you don't follow. */
export async function fetchExplore(viewerId: string, limit = 60): Promise<PostRow[]> {
  if (isDemoMode()) return demo.demoFetchExplore(viewerId, limit);

  // RLS already hides private members' posts from anyone who doesn't follow
  // them, so this needs no privacy filter of its own.
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .is("removed_at", null)
    .neq("author_id", viewerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PostRow[];
}

/** An insert that has not answered in this long is called off and left to the caller's retry. */
export const CREATE_POST_TIMEOUT_MS = 20_000;

/**
 * Insert the post row. This is the moment it exists: an AFTER INSERT
 * trigger tells the author's followers straight away, so the caller must
 * only get here once the media and thumbnail are both in storage.
 *
 * One attempt, bounded. The post outbox is the one retry layer for
 * posting and runs this again on its own schedule. Each attempt has its
 * own limit, through an AbortSignal PostgREST honours, because React
 * Native's fetch has none and a stalled insert used to wait out the
 * system's idle timeout first.
 *
 * The id is chosen on the phone, once per post. So a duplicate key (23505)
 * on the primary key, the only unique constraint posts has, means an
 * earlier attempt landed and only its reply was lost: that is the post
 * being there, on any attempt, after a relaunch too.
 */
export async function createPost(
  post: NewPost,
  { timeoutMs = CREATE_POST_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  if (isDemoMode()) {
    // The demo store keeps whatever it is given; a second insert of the
    // same id would show the post twice, where the database refuses it.
    if (!demo.demoFetchPost(post.id)) demo.demoCreatePost(post);
    return;
  }
  await withTimeout(
    timeoutMs,
    async (abort) => {
      const { error } = await supabase.from("posts").insert(post).abortSignal(abort);
      if (!error) return;
      if (error.code === "23505") return;
      throw error;
    },
    { signal, what: "Saving the post" },
  );
}

/**
 * Whether the member's own post is in the database. Asked before a
 * discarded draft is removed: an insert that timed out may still have
 * landed, and then the post is live and its followers have been told.
 *
 * Three answers, because each drives something different. "yes" only when
 * the row came back, "no" only when the server answered without it, and
 * "unknown" for no answer or an error. A caller must never treat
 * "unknown" as either of the others: as "no" a live post would lose its
 * photograph, and as "yes" a post that never landed would be taken for
 * done and its files deleted.
 */
export type PostPresence = "yes" | "no" | "unknown";

export async function ownPostExists(postId: string, authorId: string, timeoutMs = 10_000): Promise<PostPresence> {
  if (isDemoMode()) return demo.demoFetchPost(postId) != null ? "yes" : "no";
  try {
    return await withTimeout(timeoutMs, async (abort) => {
      const { data, error } = await supabase
        .from("posts")
        .select("id")
        .eq("id", postId)
        .eq("author_id", authorId)
        .abortSignal(abort)
        .maybeSingle();
      if (error) return "unknown";
      return data != null ? "yes" : "no";
    });
  } catch {
    return "unknown";
  }
}

/**
 * Change the words under your own photograph. Ownership is the database's
 * to enforce — the posts update policy admits authors only — so a request
 * for somebody else's post updates nothing and comes back as such.
 */
export async function updateCaption(postId: string, caption: string): Promise<void> {
  const trimmed = caption.trim();
  if (isDemoMode()) {
    demo.demoUpdateCaption(postId, trimmed);
    return;
  }
  const { data, error } = await supabase
    .from("posts")
    .update({ caption: trimmed })
    .eq("id", postId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Only the author can change a caption.");
}

/**
 * Delete your own post, and be sure of the answer.
 *
 * The delete asks for the deleted row back. A DELETE that row-level
 * security filters out, and one for a post that is already gone, both
 * succeed with nothing deleted, so "no error" alone used to be taken for
 * done either way. When nothing came back the post is looked for: if it
 * is not there it was deleted already, by an earlier tap whose reply was
 * lost, and that is what was asked for; if it is still there it was not
 * deleted, and the caller is told.
 *
 * Its files stay in storage, as they always have.
 */
export async function deleteOwnPost(postId: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoDeletePost(postId);
    return;
  }
  const { data, error } = await supabase.from("posts").delete().eq("id", postId).select("id");
  if (error) throw error;
  if ((data ?? []).length > 0) return;
  const { data: still, error: lookError } = await supabase.from("posts").select("id").eq("id", postId).maybeSingle();
  if (lookError) throw lookError;
  if (still) throw new Error("Only the author can delete a post.");
}

/** Who liked a post, newest first. Shown only for your own posts (app/likes.tsx). */
export async function fetchLikers(postId: string): Promise<Pick<ProfileRow, "id" | "username" | "full_name" | "avatar_url">[]> {
  if (!postId) return [];
  if (isDemoMode()) return demo.demoFetchLikers(postId);
  const { data, error } = await supabase
    .from("likes")
    .select("created_at, liker:profiles!likes_user_id_fkey(id, username, full_name, avatar_url)")
    .eq("post_id", postId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? [])
    .map((row) => (row as unknown as { liker: Pick<ProfileRow, "id" | "username" | "full_name" | "avatar_url"> | null }).liker)
    .filter((p): p is Pick<ProfileRow, "id" | "username" | "full_name" | "avatar_url"> => Boolean(p));
}

/**
 * Which of these posts has the viewer liked? Returns a set of post ids.
 * Asked a hundred posts at a time: a gallery or a long scroll can hold
 * more ids than one request's URL can carry (./batch).
 */
export async function fetchMyLikes(userId: string, postIds: string[]): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  if (isDemoMode()) return demo.demoFetchMyLikes(userId, postIds);

  const rows = await readInChunks(postIds, async (chunk) => {
    const { data, error } = await supabase
      .from("likes")
      .select("post_id")
      .eq("user_id", userId)
      .in("post_id", chunk);
    if (error) throw error;
    return (data ?? []) as { post_id: string }[];
  });
  return new Set(rows.map((r) => r.post_id));
}

export async function likePost(userId: string, postId: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoLike(userId, postId);
    return;
  }
  const { error } = await supabase.from("likes").insert({ post_id: postId, user_id: userId });
  if (error && error.code !== "23505") throw error; // ignore double-like races
}

export async function unlikePost(userId: string, postId: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoUnlike(userId, postId);
    return;
  }
  const { error } = await supabase
    .from("likes")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * A photograph's conversation, oldest first. PostgREST stops at max_rows
 * (1000, ROWS_PER_READ) without saying so, and it used to stop at the
 * oldest thousand: on a photograph with more, the newest comments - the
 * ones people had just written - never appeared. It now reads the newest
 * thousand and turns them round, which is the same list whenever there
 * are fewer.
 */
export async function fetchComments(postId: string): Promise<CommentWithAuthor[]> {
  if (isDemoMode()) return demo.demoFetchComments(postId);

  const { data, error } = await supabase
    .from("comments")
    .select(PREVIEW_COMMENT)
    .eq("post_id", postId)
    .is("removed_at", null)
    .order("created_at", { ascending: false })
    .limit(ROWS_PER_READ);
  if (error) throw error;
  return ((data ?? []) as unknown as CommentWithAuthor[]).reverse();
}

/** A comment as the app shows it: the row, and who wrote it. */
const PREVIEW_COMMENT = "*, author:profiles!comments_author_id_fkey(id, username, avatar_url)";

/**
 * The newest comments on each of these posts, for the previews under a
 * photograph in the feed. One query for a hundred cards rather than one
 * per card — a feed of twenty posts shouldn't cost twenty round trips.
 *
 * Each post brings at most `perPost` comments, the newest, chosen by the
 * database (an embedded resource's order and limit apply per post). It
 * used to bring every comment on every post in the list and keep the
 * last few: a photograph with hundreds of comments sent all of them on
 * every page of the feed, and past max_rows (1000) the list was cut from
 * the newest end, so the previews showed old comments as the latest.
 */
export async function fetchCommentPreviews(
  postIds: string[],
  perPost: number,
): Promise<Record<string, CommentWithAuthor[]>> {
  if (postIds.length === 0) return {};
  if (isDemoMode()) return demo.demoCommentPreviews(postIds, perPost);

  const rows = await readInChunks(postIds, async (chunk) => {
    const { data, error } = await supabase
      .from("posts")
      .select(`id, comments!comments_post_id_fkey(${PREVIEW_COMMENT})`)
      .in("id", chunk)
      .is("comments.removed_at", null)
      .order("created_at", { referencedTable: "comments", ascending: false })
      .limit(perPost, { referencedTable: "comments" });
    if (error) throw error;
    return (data ?? []) as unknown as { id: string; comments: CommentWithAuthor[] | null }[];
  });

  const out: Record<string, CommentWithAuthor[]> = {};
  for (const post of rows) {
    const newestFirst = post.comments ?? [];
    if (newestFirst.length > 0) out[post.id] = [...newestFirst].reverse();
  }
  return out;
}

export async function addComment(userId: string, postId: string, body: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoAddComment(userId, postId, body.trim());
    return;
  }
  const { error } = await supabase
    .from("comments")
    .insert({ post_id: postId, author_id: userId, body: body.trim() });
  if (error) throw error;
}

export async function deleteOwnComment(commentId: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoDeleteComment(commentId);
    return;
  }
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  if (error) throw error;
}
