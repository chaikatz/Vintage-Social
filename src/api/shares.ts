import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import type { ExportFormat, ExportPaper } from "@/utils/exportLayout";

/**
 * Sending a photograph beyond the club.
 *
 * A share link is a row the author owns (migration 0019). The database
 * mints the token and is the only thing that can; a non-member who opens
 * the link is answered by `shared_post`, which returns that one
 * photograph and nothing else. Every step of the loop leaves a quiet mark
 * in `share_events` so the club can see whether a print sent out ever
 * brings anyone to the door. Nothing here may ever stop a share: the
 * event writes are best effort, and a link that cannot be made is simply
 * no link.
 */

export type ShareEventKind = "share_started" | "link_created";

/** The author's link for a post, made if there is none yet. Null in demo mode. */
export async function ensureShareLink(postId: string, format: ExportFormat, theme: ExportPaper): Promise<string | null> {
  if (isDemoMode()) return null;
  const { data, error } = await supabase.rpc("create_post_share", {
    p_post_id: postId,
    p_format: format,
    p_theme: theme,
  });
  if (error) throw error;
  return typeof data === "string" && data.length > 0 ? data : null;
}

/** The author's current link for a post, if one exists and is live. */
export async function fetchShareLink(postId: string, userId: string): Promise<string | null> {
  if (isDemoMode() || !userId) return null;
  const { data, error } = await supabase
    .from("post_shares")
    .select("token")
    .eq("post_id", postId)
    .eq("owner_id", userId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.token as string | undefined) ?? null;
}

/** Turn the link off. Anyone holding it sees the photograph is no longer shared. */
export async function revokeShareLink(postId: string): Promise<void> {
  if (isDemoMode()) return;
  const { error } = await supabase.rpc("revoke_post_share", { p_post_id: postId });
  if (error) throw error;
}

/** A mark in the ledger. Never throws; a share is not the place to fail. */
export async function recordShareEvent(
  userId: string,
  kind: ShareEventKind,
  detail: { postId: string; token?: string | null; format: ExportFormat; theme: ExportPaper },
): Promise<void> {
  if (isDemoMode() || !userId) return;
  try {
    await supabase.from("share_events").insert({
      kind,
      actor_id: userId,
      post_id: detail.postId,
      token: detail.token ?? null,
      format: detail.format,
      theme: detail.theme,
    });
  } catch {
    // Analytics are a courtesy to the club, not a condition of sharing.
  }
}
