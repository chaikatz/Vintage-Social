import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import type { ActivityWithRefs } from "@/types/db";

/**
 * The kind of notice that is filed in Activity only to reach the member's
 * phone (0040): a new message. It is read in the inbox, which counts what
 * is unread from the messages themselves (0037), so the Activity tab leaves
 * it out rather than show each message twice.
 */
export const PUSH_ONLY_ACTIVITY = "message";

export async function fetchActivity(userId: string): Promise<ActivityWithRefs[]> {
  if (isDemoMode()) return demo.demoFetchActivity(userId);

  const { data, error } = await supabase
    .from("activity")
    .select(
      "*, actor:profiles!activity_actor_id_fkey(id, username, avatar_url), " +
        "post:posts!activity_post_id_fkey(id, media_path, thumb_path, media_type)",
    )
    .eq("recipient_id", userId)
    .neq("type", PUSH_ONLY_ACTIVITY)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data ?? []) as unknown as ActivityWithRefs[];
}

export async function markActivityRead(userId: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoMarkActivityRead(userId);
    return;
  }
  const { error } = await supabase
    .from("activity")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", userId)
    .is("read_at", null);
  if (error) throw error;
}
