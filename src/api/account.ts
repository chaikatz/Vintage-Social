import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import { isTransient, withRetry } from "@/utils/retry";
import type { Bucket } from "./media";

/**
 * Deleting an account, for good.
 *
 * In this order, and why:
 *
 *   1. The one refusal the database would give (the club's only admin) is
 *      asked first, before anything is removed.
 *   2. The member's files go, through the Storage API, the one path that
 *      removes the bytes as well as the rows, and only a live account can
 *      ask it to: once the account is deleted, its session may no longer
 *      remove anything from its folders. Each folder is emptied and then
 *      listed again until it lists empty. A folder that cannot be emptied
 *      (storage refusing, the connection gone, after a few tries) stops
 *      the deletion here, with the account still whole and the member told
 *      to try again: the database's backstop (0018) deletes only the rows
 *      of files still there, not their bytes, so going on would have left
 *      their photographs in a public bucket after the account had gone.
 *   3. The database function removes the auth user and everything of
 *      theirs cascades from it: profile, photographs, comments, likes,
 *      follows, tags, messages, push tokens (every phone's), preferences,
 *      invitation link. The membership number is never reissued. A
 *      dropped connection here is tried again a couple of times before
 *      the member hears of it: by then their files are gone, and an
 *      account left without them is the worst place to stop. Asked again
 *      after it went through (the answer was lost), it finds nothing left
 *      to delete and says so as success.
 *   4. The phone forgets the session, and with it stops taking the
 *      account's notices: auth says SIGNED_OUT, and the listener made
 *      with the client unregisters this phone from push, its token kept
 *      until then (pushAfterSignedOut, src/utils/pushKept.ts).
 *
 * The push token is not let go by hand before step 3. It was, and a
 * deletion that then failed (no signal, a timeout) left the member signed
 * in with their phone's row removed, or the phone unregistered, and no
 * notices until the app next started from cold. Now a deletion that fails
 * anywhere leaves the account as it was, notices and all.
 *
 * A retry after any failure starts again at 1 and finishes the deletion:
 * folders already empty list empty at once.
 */
const BUCKETS: Bucket[] = ["media", "thumbnails", "avatars"];

/** How many names one list call returns at most, and how many one remove takes. */
export const FILES_PER_LIST = 1000;
const FILES_PER_REMOVE = 100;
/** A ceiling on pages, so a listing that never ends cannot hold the deletion. */
const MAX_LIST_PAGES = 200;
/** Times a folder is emptied and listed again before the deletion stops for it. */
const EMPTY_ROUNDS = 3;

/** Said when a folder could not be emptied: nothing irreversible has happened to the account. */
export const FILES_NOT_REMOVED =
  "Some of your photographs could not be removed, so your account has not been deleted yet. Try again in a moment.";
/** The database's own refusal, asked first. */
export const ONLY_ADMIN = "You are the only admin. Make another member an admin before deleting this account.";

export interface DeleteOptions {
  /** Test hook: how retries wait. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Every file in the member's folder of a bucket, a page of a thousand at
 * a time (one list call stops at a thousand without saying so). All the
 * names are read before any is removed, so removing cannot shift the
 * pages being read. A page that cannot be read is an error: a listing
 * cut short would be taken for an empty folder.
 */
async function listOwnFiles(bucket: Bucket, userId: string): Promise<string[]> {
  const paths: string[] = [];
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(userId, { limit: FILES_PER_LIST, offset: page * FILES_PER_LIST, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    const rows = data ?? [];
    // A folder within the folder lists with no id; the app makes none.
    for (const f of rows) if ((f as { id?: string | null }).id !== null) paths.push(`${userId}/${f.name}`);
    if (rows.length < FILES_PER_LIST) break;
  }
  return paths;
}

/** Remove what the folder holds, then list it again, until it lists empty. */
async function emptyFolder(bucket: Bucket, userId: string): Promise<void> {
  for (let round = 0; round < EMPTY_ROUNDS; round++) {
    const paths = await listOwnFiles(bucket, userId);
    if (paths.length === 0) return;
    for (let i = 0; i < paths.length; i += FILES_PER_REMOVE) {
      const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + FILES_PER_REMOVE));
      if (error) throw error;
    }
  }
  if ((await listOwnFiles(bucket, userId)).length > 0) throw new Error(FILES_NOT_REMOVED);
}

async function removeOwnFiles(userId: string, sleep: DeleteOptions["sleep"]): Promise<void> {
  for (const bucket of BUCKETS) {
    try {
      await withRetry(() => emptyFolder(bucket, userId), { attempts: 3, retryOn: isTransient, sleep });
    } catch {
      throw new Error(FILES_NOT_REMOVED);
    }
  }
}

/** Refuses, before anything is removed, what the database would refuse after: the club's only admin leaving. */
async function refuseOnlyAdmin(userId: string): Promise<void> {
  const { data: me, error } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (me?.role !== "admin") return;
  const { count, error: countError } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .neq("id", userId);
  if (countError) throw countError;
  if (!count) throw new Error(ONLY_ADMIN);
}

export async function deleteMyAccount(userId: string, options: DeleteOptions = {}): Promise<void> {
  if (isDemoMode()) return;
  await refuseOnlyAdmin(userId);
  await removeOwnFiles(userId, options.sleep);
  // The push tokens go with the account (they cascade from it), and this
  // phone stops receiving when the session leaves it, below.
  await withRetry(
    async () => {
      const { error } = await supabase.rpc("delete_my_account");
      if (error) throw error;
    },
    { attempts: 3, retryOn: isTransient, sleep: options.sleep },
  );
  // The user no longer exists; the phone drops what it held.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
}
