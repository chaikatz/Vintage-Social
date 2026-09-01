import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import type { CommentWithAuthor, PostRow, PostWithAuthor } from "@/types/db";

export const FEED_PAGE_SIZE = 12;

const POST_WITH_AUTHOR = "*, author:profiles!posts_author_id_fkey(id, username, full_name, avatar_url)";

/**
 * The home feed: strictly chronological, only accounts the member follows
 * (plus their own posts). No ranking, no suggestions.
 */
export async function fetchFeedPage(userId: string, page: number): Promise<PostWithAuthor[]> {
  if (isDemoMode()) return demo.demoFetchFeedPage(userId, page, FEED_PAGE_SIZE);

  const { data: follows, error: followErr } = await supabase
    .from("follows")
    .select("followee_id")
    .eq("follower_id", userId);
  if (followErr) throw followErr;

  const authorIds = [userId, ...(follows ?? []).map((f) => f.followee_id as string)];
  const from = page * FEED_PAGE_SIZE;

  const { data, error } = await supabase
    .from("posts")
    .select(POST_WITH_AUTHOR)
    .in("author_id", authorIds)
    .is("removed_at", null)
    .order("created_at", { ascending: false })
    .range(from, from + FEED_PAGE_SIZE - 1);
  if (error) throw error;
  return (data ?? []) as unknown as PostWithAuthor[];
}

export async function fetchUserPosts(authorId: string): Promise<PostRow[]> {
  if (isDemoMode()) return demo.demoFetchUserPosts(authorId);

  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("author_id", authorId)
    .is("removed_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PostRow[];
}

export async function fetchPost(postId: string): Promise<PostWithAuthor | null> {
  if (isDemoMode()) return demo.demoFetchPost(postId);

  const { data, error } = await supabase
    .from("posts")
    .select(POST_WITH_AUTHOR)
    .eq("id", postId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as PostWithAuthor) ?? null;
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
  show_date_stamp: boolean;
  caption: string;
  taken_at: string | null;
  location: string | null;
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

export async function createPost(post: NewPost): Promise<void> {
  if (isDemoMode()) {
    demo.demoCreatePost(post);
    return;
  }
  const { error } = await supabase.from("posts").insert(post);
  if (error) throw error;
}

export async function deleteOwnPost(postId: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoDeletePost(postId);
    return;
  }
  const { error } = await supabase.from("posts").delete().eq("id", postId);
  if (error) throw error;
}

/** Which of these posts has the viewer liked? Returns a set of post ids. */
export async function fetchMyLikes(userId: string, postIds: string[]): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  if (isDemoMode()) return demo.demoFetchMyLikes(userId, postIds);

  const { data, error } = await supabase
    .from("likes")
    .select("post_id")
    .eq("user_id", userId)
    .in("post_id", postIds);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.post_id as string));
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

export async function fetchComments(postId: string): Promise<CommentWithAuthor[]> {
  if (isDemoMode()) return demo.demoFetchComments(postId);

  const { data, error } = await supabase
    .from("comments")
    .select("*, author:profiles!comments_author_id_fkey(id, username, avatar_url)")
    .eq("post_id", postId)
    .is("removed_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CommentWithAuthor[];
}

/**
 * The newest comments on each of these posts, for the previews under a
 * photograph in the feed. One query for the whole page rather than one per
 * card — a feed of twenty posts shouldn't cost twenty round trips.
 */
export async function fetchCommentPreviews(
  postIds: string[],
  perPost: number,
): Promise<Record<string, CommentWithAuthor[]>> {
  if (postIds.length === 0) return {};
  if (isDemoMode()) return demo.demoCommentPreviews(postIds, perPost);

  const { data, error } = await supabase
    .from("comments")
    .select("*, author:profiles!comments_author_id_fkey(id, username, avatar_url)")
    .in("post_id", postIds)
    .is("removed_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const out: Record<string, CommentWithAuthor[]> = {};
  for (const c of (data ?? []) as unknown as CommentWithAuthor[]) {
    (out[c.post_id] ??= []).push(c);
  }
  for (const id of Object.keys(out)) out[id] = out[id].slice(-perPost);
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
