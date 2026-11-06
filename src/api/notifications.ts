import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import type { NotificationPrefsRow } from "@/types/db";
import { functionMissing, noteRpcMissing, rpcKnownMissing } from "./rpcMissing";

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

/**
 * Remember this phone, under the member signed in on it. Idempotent: the
 * token is the key.
 *
 * Filed through claim_push_token (migration 0036), which moves the row
 * from whoever held it. A phone's token outlives a member on it: when the
 * member before could not take it away (no signal at their sign-out, the
 * app deleted and installed again), an upsert of it met their row, was
 * refused under row-level security (the row was not this member's), and
 * the phone went on being told about the member before. Where the
 * database does not have the function yet, the upsert, as before.
 */
export async function registerPushToken(
  userId: string,
  token: string,
  platform: "ios" | "android" | "web",
  device: string | null,
): Promise<void> {
  if (isDemoMode()) return;
  if (!rpcKnownMissing("claim_push_token")) {
    const { error } = await supabase.rpc("claim_push_token", { p_token: token, p_platform: platform, p_device: device });
    if (!error) return;
    if (!functionMissing(error)) throw error;
    noteRpcMissing("claim_push_token");
  }
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

/**
 * Forget this phone — on sign out, so the next member in isn't told about
 * the last. Resolves to how many rows went: none when the row was gone
 * already, or was another member's (row-level security lets a member
 * remove only their own, and says nothing of the rest), which the caller
 * must not take for the phone having been let go (src/utils/push.ts).
 */
export async function unregisterPushToken(token: string): Promise<number> {
  if (isDemoMode()) return 0;
  const { error, count } = await supabase.from("push_tokens").delete({ count: "exact" }).eq("token", token);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Forget every phone of the member's — on a sign-out that ends their
 * sessions on all of them (src/providers/SessionProvider.tsx), while
 * still signed in: a phone whose session has ended elsewhere is not told
 * so until its app next runs, and would be sent the member's notices
 * until then. Resolves to the tokens whose rows went (the member's own,
 * which they may read), so the caller knows from this one request
 * whether this phone's own row was among them.
 */
export async function unregisterAllPushTokens(userId: string): Promise<string[]> {
  if (isDemoMode()) return [];
  const { data, error } = await supabase.from("push_tokens").delete().eq("user_id", userId).select("token");
  if (error) throw error;
  return ((data ?? []) as { token: string }[]).map((row) => row.token);
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
