import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import type { ProfileRow } from "@/types/db";

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
}

export async function updateOwnProfile(userId: string, edits: ProfileEdits): Promise<void> {
  if (isDemoMode()) {
    demo.demoUpdateProfile(userId, edits);
    return;
  }
  const { error } = await supabase.from("profiles").update(edits).eq("id", userId);
  if (error) throw error;
}

export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  if (isDemoMode()) return demo.demoIsFollowing(followerId, followeeId);

  const { data, error } = await supabase
    .from("follows")
    .select("followee_id")
    .eq("follower_id", followerId)
    .eq("followee_id", followeeId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function follow(followerId: string, followeeId: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoFollow(followerId, followeeId);
    return;
  }
  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: followerId, followee_id: followeeId });
  if (error && error.code !== "23505") throw error;
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
