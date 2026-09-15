import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import { forgetPushToken } from "@/utils/push";
import type { Bucket } from "./media";

/**
 * Deleting an account, for good.
 *
 * The member's files go first, through the Storage API, which is the one
 * path that removes the bytes as well as the rows. Then the database
 * function removes the auth user and everything of theirs cascades from
 * it — profile, photographs, comments, likes, follows, tags, messages,
 * tokens, preferences, invitation link. The membership number is never
 * reissued. Finally the phone forgets the session.
 *
 * File removal is best effort: a folder that cannot be listed does not
 * stop the account from going, and the function removes the rows as a
 * backstop where the platform permits it.
 */
const BUCKETS: Bucket[] = ["media", "thumbnails", "avatars"];

async function removeOwnFiles(userId: string): Promise<void> {
  for (const bucket of BUCKETS) {
    try {
      const { data } = await supabase.storage.from(bucket).list(userId, { limit: 1000 });
      const paths = (data ?? []).map((f) => `${userId}/${f.name}`);
      for (let i = 0; i < paths.length; i += 100) {
        await supabase.storage.from(bucket).remove(paths.slice(i, i + 100));
      }
    } catch {
      // Best effort; the database function follows up.
    }
  }
}

export async function deleteMyAccount(userId: string): Promise<void> {
  if (isDemoMode()) return;
  await forgetPushToken();
  await removeOwnFiles(userId);
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
  // The user no longer exists; the phone drops what it held.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
}
