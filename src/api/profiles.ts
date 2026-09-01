import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import type { FollowStatus, ProfileRow } from "@/types/db";

export async function fetchProfileByUsername(username: string): Promise<ProfileRow | null> {
  if (isDemoMode()) return demo.demoFetchProfileByUsername(username);

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
}

export async function fetchProfileById(id: string): Promise<ProfileRow | null> {
  if (isDemoMode()) return demo.demoFetchProfileById(id);

  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
}

/** Plain prefix/substring search over usernames and names. No suggestions. */
export async function searchProfiles(q: string): Promise<ProfileRow[]> {
  const needle = q.trim();
  if (needle.length < 2) return [];
  if (isDemoMode()) return demo.demoSearchProfiles(needle);

  const escaped = needle.replace(/[%_\\]/g, "\\$&").replace(/,/g, "");
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("status", "approved")
    .or(`username.ilike.%${escaped}%,full_name.ilike.%${escaped}%`)
    .order("username")
    .limit(30);
  if (error) throw error;
  return (data ?? []) as ProfileRow[];
}

export interface ProfileEdits {
  full_name?: string;
  bio?: string;
  avatar_url?: string;
  city?: string;
  is_private?: boolean;
}

export async function updateOwnProfile(userId: string, edits: ProfileEdits): Promise<void> {
  if (isDemoMode()) {
    demo.demoUpdateProfile(userId, edits);
    return;
  }
  const { error } = await supabase.from("profiles").update(edits).eq("id", userId);
  if (error) throw error;
}

/**
 * Where a follow stands: accepted, waiting on a private member, or absent.
 */
export async function followState(
  followerId: string,
  followeeId: string,
): Promise<FollowStatus | null> {
  if (isDemoMode()) return demo.demoFollowState(followerId, followeeId);

  const { data, error } = await supabase
    .from("follows")
    .select("status")
    .eq("follower_id", followerId)
    .eq("followee_id", followeeId)
    .maybeSingle();
  if (error) throw error;
  return (data?.status as FollowStatus) ?? null;
}

export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  return (await followState(followerId, followeeId)) === "accepted";
}

/**
 * Follow a member. Following a private member files a request instead —
 * the returned status says which happened, so the button can read
 * "Requested" rather than pretending it worked.
 */
export async function follow(followerId: string, followeeId: string): Promise<FollowStatus> {
  if (isDemoMode()) return demo.demoFollow(followerId, followeeId);

  const { data: target } = await supabase
    .from("profiles")
    .select("is_private")
    .eq("id", followeeId)
    .maybeSingle();
  const status: FollowStatus = target?.is_private ? "pending" : "accepted";
  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: followerId, followee_id: followeeId, status });
  if (error && error.code !== "23505") throw error;
  return status;
}

/** A private member accepting or declining a request that is waiting on them. */
export async function decideFollowRequest(
  followerId: string,
  followeeId: string,
  accept: boolean,
): Promise<void> {
  if (isDemoMode()) {
    demo.demoDecideFollowRequest(followerId, followeeId, accept);
    return;
  }
  // Declining removes the row outright rather than leaving a rejected
  // record around — a request that was turned down can simply be made again.
  const rows = supabase.from("follows");
  const { error } = accept
    ? await rows
        .update({ status: "accepted" })
        .eq("follower_id", followerId)
        .eq("followee_id", followeeId)
    : await rows.delete().eq("follower_id", followerId).eq("followee_id", followeeId);
  if (error) throw error;
}

/** Members waiting on you to let them in. */
export async function fetchPendingRequests(followeeId: string): Promise<ProfileRow[]> {
  if (isDemoMode()) return demo.demoPendingRequests(followeeId);

  const { data, error } = await supabase
    .from("follows")
    .select("follower:profiles!follows_follower_id_fkey(*)")
    .eq("followee_id", followeeId)
    .eq("status", "pending");
  if (error) throw error;
  return ((data ?? []) as unknown as { follower: ProfileRow }[]).map((r) => r.follower);
}

/** The members you follow — who you can pass a photograph along to. */
export async function fetchFollowing(userId: string): Promise<ProfileRow[]> {
  if (isDemoMode()) return demo.demoFetchFollowing(userId);

  const { data, error } = await supabase
    .from("follows")
    .select("followee:profiles!follows_followee_id_fkey(*)")
    .eq("follower_id", userId)
    .eq("status", "accepted");
  if (error) throw error;
  return ((data ?? []) as unknown as { followee: ProfileRow }[]).map((r) => r.followee);
}

/**
 * Whether the viewer may see this member's photographs. Public members are
 * open to every approved member; a private member is visible to themselves
 * and to accepted followers only.
 */
export async function canViewPosts(viewerId: string, authorId: string): Promise<boolean> {
  if (viewerId === authorId) return true;
  if (isDemoMode()) return demo.demoCanViewPosts(viewerId, authorId);

  const { data } = await supabase
    .from("profiles")
    .select("is_private")
    .eq("id", authorId)
    .maybeSingle();
  if (!data?.is_private) return true;
  return isFollowing(viewerId, authorId);
}

export async function unfollow(followerId: string, followeeId: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoUnfollow(followerId, followeeId);
    return;
  }
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", followerId)
    .eq("followee_id", followeeId);
  if (error) throw error;
}
