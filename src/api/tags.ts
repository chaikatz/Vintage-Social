import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import type { PostRow, PostTagWithMember, TagStatus } from "@/types/db";
import { readInChunks } from "./batch";

/**
 * Tagging members in a photograph.
 *
 * A tag is the author saying "you were there". It is pending until the
 * tagged member accepts it — only then does the photograph appear on
 * their own profile — and they can decline or later remove themselves.
 * Everyone else only ever sees accepted tags. The database enforces all
 * of that (migration 0015); this file just asks.
 */

const TAG_WITH_MEMBER = "*, member:profiles!post_tags_user_id_fkey(id, username, full_name, avatar_url)";

/**
 * A row the database refused for what it says, which another try would
 * not change: a policy (the member no longer approved, or a block between
 * the two), a member since gone, a check.
 */
function refusedRow(error: { code?: string }): boolean {
  return error.code === "42501" || error.code === "23503" || error.code === "23514";
}

/**
 * Name the members in a freshly published post. Resolves with the members
 * the database would not let be tagged (none, nearly always); the rest are
 * on the post. Any other error is thrown: an error is an error.
 *
 * All of them go in one request. One statement is all or nothing, though,
 * so a single member refused (suspended, or blocking the author, since the
 * post was composed), or one already in from an earlier try, kept every
 * other tag off as well. Then each goes again on its own, and only the
 * refused are left off.
 */
export async function tagMembers(postId: string, taggedBy: string, userIds: string[]): Promise<string[]> {
  const ids = [...new Set(userIds)].filter((id) => id && id !== taggedBy);
  if (ids.length === 0) return [];
  if (isDemoMode()) {
    demo.demoTagMembers(postId, taggedBy, ids);
    return [];
  }
  const row = (user_id: string) => ({ post_id: postId, user_id, tagged_by: taggedBy });
  const { error } = await supabase.from("post_tags").insert(ids.map(row));
  if (!error) return [];
  const already = error.code === "23505";
  if (!already && !refusedRow(error)) throw error;
  // One member alone: that answer was theirs.
  if (ids.length === 1) return already ? [] : ids;
  const refused = await Promise.all(
    ids.map(async (id) => {
      const { error: one } = await supabase.from("post_tags").insert(row(id));
      if (!one || one.code === "23505") return null;
      if (refusedRow(one)) return id;
      throw one;
    }),
  );
  return refused.filter((id): id is string => id !== null);
}

/** Everyone tagged in a post that the viewer is allowed to know about. */
export async function fetchPostTags(postId: string): Promise<PostTagWithMember[]> {
  if (isDemoMode()) return demo.demoFetchPostTags(postId);
  const { data, error } = await supabase
    .from("post_tags")
    .select(TAG_WITH_MEMBER)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as PostTagWithMember[];
}

/** The photographs a member has accepted being tagged in — theirs to show. */
export async function fetchTaggedPosts(userId: string): Promise<PostRow[]> {
  if (isDemoMode()) return demo.demoFetchTaggedPosts(userId);
  const { data, error } = await supabase
    .from("post_tags")
    .select("post:posts!post_tags_post_id_fkey(*)")
    .eq("user_id", userId)
    .eq("status", "accepted")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as { post: PostRow | null }[];
  return rows.map((r) => r.post).filter((p): p is PostRow => Boolean(p) && !p!.removed_at);
}

/**
 * Which of these posts the viewer is tagged in, and where each tag stands.
 * A hundred posts a request, so a long Activity list never outgrows one
 * request's URL (./batch).
 */
export async function fetchMyTagStatus(userId: string, postIds: string[]): Promise<Record<string, TagStatus>> {
  if (postIds.length === 0) return {};
  if (isDemoMode()) return demo.demoMyTagStatus(userId, postIds);
  const rows = await readInChunks(postIds, async (chunk) => {
    const { data, error } = await supabase
      .from("post_tags")
      .select("post_id, status")
      .eq("user_id", userId)
      .in("post_id", chunk);
    if (error) throw error;
    return (data ?? []) as { post_id: string; status: TagStatus }[];
  });
  const out: Record<string, TagStatus> = {};
  for (const row of rows) out[row.post_id] = row.status;
  return out;
}

/** Accept or decline a tag on yourself. */
export async function decideTag(userId: string, postId: string, status: Exclude<TagStatus, "pending">): Promise<void> {
  if (isDemoMode()) {
    demo.demoDecideTag(userId, postId, status);
    return;
  }
  const { error } = await supabase
    .from("post_tags")
    .update({ status, decided_at: new Date().toISOString() })
    .eq("post_id", postId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Take yourself out of a photograph, or take a tag back from your own post. */
export async function removeTag(postId: string, userId: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoRemoveTag(postId, userId);
    return;
  }
  const { error } = await supabase.from("post_tags").delete().eq("post_id", postId).eq("user_id", userId);
  if (error) throw error;
}
