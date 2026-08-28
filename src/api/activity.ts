import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import type { ActivityWithRefs } from "@/types/db";

export async function fetchActivity(userId: string): Promise<ActivityWithRefs[]> {
  if (isDemoMode()) return demo.demoFetchActivity(userId);

  const { data, error } = await supabase
    .from("activity")
    .select(
      "*, actor:profiles!activity_actor_id_fkey(id, username, avatar_url), " +
        "post:posts!activity_post_id_fkey(id, media_path, thumb_path, media_type)",
    )
    .eq("recipient_id", userId)
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
