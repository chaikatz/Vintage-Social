import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import type { PostRow, PostTagWithMember, TagStatus } from "@/types/db";

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

/** Name the members in a freshly published post. Skips nobody silently: an error is an error. */
export async function tagMembers(postId: string, taggedBy: string, userIds: string[]): Promise<void> {
  const ids = [...new Set(userIds)].filter((id) => id && id !== taggedBy);
  if (ids.length === 0) return;
  if (isDemoMode()) {
    demo.demoTagMembers(postId, taggedBy, ids);
    return;
  }
  const { error } = await supabase
    .from("post_tags")
    .insert(ids.map((user_id) => ({ post_id: postId, user_id, tagged_by: taggedBy })));
  if (error) throw error;
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

/** Which of these posts the viewer is tagged in, and where each tag stands. */
export async function fetchMyTagStatus(userId: string, postIds: string[]): Promise<Record<string, TagStatus>> {
  if (postIds.length === 0) return {};
  if (isDemoMode()) return demo.demoMyTagStatus(userId, postIds);
  const { data, error } = await supabase
    .from("post_tags")
    .select("post_id, status")
    .eq("user_id", userId)
    .in("post_id", postIds);
  if (error) throw error;
  const out: Record<string, TagStatus> = {};
  for (const row of (data ?? []) as { post_id: string; status: TagStatus }[]) out[row.post_id] = row.status;
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
