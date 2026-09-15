import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import type { ProfileRow } from "@/types/db";

/**
 * Blocking another member.
 *
 * A block is a row the blocker owns (migration 0018). The database does
 * the rest: neither member sees the other's photographs, comments, likes,
 * follows, tags, messages or activity, and the blocked member cannot see
 * the blocker's profile. The blocker still sees the profile they blocked,
 * so it can be found again to unblock.
 */

/** Ids of everyone this member has blocked. */
export async function fetchBlockedIds(userId: string): Promise<Set<string>> {
  if (isDemoMode() || !userId) return new Set();
  const { data, error } = await supabase.from("blocks").select("blocked_id").eq("blocker_id", userId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.blocked_id as string));
}

/** The members this member has blocked, with names, for the Settings list. */
export async function fetchBlockedProfiles(userId: string): Promise<ProfileRow[]> {
  if (isDemoMode() || !userId) return [];
  const ids = [...(await fetchBlockedIds(userId))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("profiles").select("*").in("id", ids).order("username");
  if (error) throw error;
  return (data ?? []) as ProfileRow[];
}

export async function blockMember(userId: string): Promise<void> {
  if (isDemoMode()) return;
  const { error } = await supabase.rpc("block_member", { p_user: userId });
  if (error) throw error;
}

export async function unblockMember(userId: string): Promise<void> {
  if (isDemoMode()) return;
  const { error } = await supabase.rpc("unblock_member", { p_user: userId });
  if (error) throw error;
}
