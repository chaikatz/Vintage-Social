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

/** How many names one list call returns at most, and how many one remove takes. */
export const FILES_PER_LIST = 1000;
const FILES_PER_REMOVE = 100;
/** A ceiling on pages, so a listing that never ends cannot hold the deletion. */
const MAX_LIST_PAGES = 200;

/**
 * Every file in the member's folder of a bucket, a page of a thousand at
 * a time. One list call stops at a thousand without saying so; the
 * database's backstop (0018) removes only the rows of what is left, not
 * the files, so a prolific member's photographs would stay in a public
 * bucket after they had deleted their account. All the names are read
 * before any is removed, so removing cannot shift the pages being read.
 */
async function listOwnFiles(bucket: Bucket, userId: string): Promise<string[]> {
  const paths: string[] = [];
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(userId, { limit: FILES_PER_LIST, offset: page * FILES_PER_LIST, sortBy: { column: "name", order: "asc" } });
    // A page that cannot be read ends the listing; what was read is still removed.
    if (error) break;
    const rows = data ?? [];
    for (const f of rows) paths.push(`${userId}/${f.name}`);
    if (rows.length < FILES_PER_LIST) break;
  }
  return paths;
}

async function removeOwnFiles(userId: string): Promise<void> {
  for (const bucket of BUCKETS) {
    try {
      const paths = await listOwnFiles(bucket, userId);
      for (let i = 0; i < paths.length; i += FILES_PER_REMOVE) {
        await supabase.storage.from(bucket).remove(paths.slice(i, i + FILES_PER_REMOVE));
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
