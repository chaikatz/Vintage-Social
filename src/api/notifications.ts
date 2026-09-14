import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import type { NotificationPrefsRow } from "@/types/db";

/**
 * Where a member can be reached, and what they want to hear about.
 *
 * The phone registers its push token here once it has one; the `push`
 * edge function (supabase/functions/push) reads the tokens and the
 * preferences when something happens. Both tables are the member's own
 * rows only (migration 0017), so nothing here needs an argument beyond the
 * signed-in member's id.
 */

export type NotificationPrefs = Omit<NotificationPrefsRow, "user_id" | "updated_at">;

export const PREF_KEYS = ["likes", "comments", "follows", "tags", "messages", "posts", "memories"] as const;

export const DEFAULT_PREFS: NotificationPrefs = {
  likes: true,
  comments: true,
  follows: true,
  tags: true,
  messages: true,
  posts: true,
  memories: true,
};

/**
 * A row from the table, or nothing at all, as a full set of preferences.
 * Absent means all of it — the same default the function assumes — and a
 * column that isn't a boolean reads as true, never as silence.
 */
export function parsePrefs(row: Partial<Record<string, unknown>> | null | undefined): NotificationPrefs {
  const out = { ...DEFAULT_PREFS };
  if (!row) return out;
  for (const key of PREF_KEYS) {
    const value = row[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

/** Remember this phone. Idempotent: the token is the key. */
export async function registerPushToken(
  userId: string,
  token: string,
  platform: "ios" | "android" | "web",
  device: string | null,
): Promise<void> {
  if (isDemoMode()) return;
  const { error } = await supabase.from("push_tokens").upsert(
    {
      token,
      user_id: userId,
      platform,
      device,
      updated_at: new Date().toISOString(),
      // A token that came back to life is live again.
      invalid_at: null,
    },
    { onConflict: "token" },
  );
  if (error) throw error;
}

/** Forget this phone — on sign out, so the next member in isn't told about the last. */
export async function unregisterPushToken(token: string): Promise<void> {
  if (isDemoMode()) return;
  const { error } = await supabase.from("push_tokens").delete().eq("token", token);
  if (error) throw error;
}

export async function fetchNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  if (isDemoMode()) return DEFAULT_PREFS;
  const { data, error } = await supabase
    .from("notification_prefs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return parsePrefs(data as Partial<Record<string, unknown>> | null);
}

export async function updateNotificationPrefs(userId: string, prefs: NotificationPrefs): Promise<void> {
  if (isDemoMode()) return;
  const { error } = await supabase
    .from("notification_prefs")
    .upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}
