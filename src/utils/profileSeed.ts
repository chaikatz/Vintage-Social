import type { QueryClient } from "@tanstack/react-query";
import type { PostRow, PostWithAuthor, ProfileRow } from "@/types/db";

/**
 * What a profile already knows, handed to the screen a tap on it opens.
 *
 * The gallery asks for its author by id, and a single post asks for the
 * post with its author; a profile holds both. Unseeded, each of those
 * screens sat on a skeleton for a round trip before it drew anything, and
 * a clip on it could not even begin to load. Home's cards have always
 * handed their row on like this (see `seed` in usePostActions).
 *
 * An entry the cache already holds that is newer than the row handed on
 * is left as it is. The author goes in aged as its own row. A post goes
 * in already stale, so its page draws at once and still reads it again in
 * the background, as it did before it was handed anything: the grid's age
 * cannot vouch for it, since a like anywhere rewrites every grid and
 * stamps it new.
 */

function newer(queryClient: QueryClient, key: readonly unknown[], updatedAt: number): boolean {
  const held = queryClient.getQueryState(key);
  return held?.data !== undefined && held.dataUpdatedAt >= updatedAt;
}

/**
 * The author, for the gallery's `["profile-by-id", id]`, aged as the
 * profile row it is: a member's page gives that row's own age. Your own
 * page gives 0, since the session's profile has none, so an entry already
 * held is never replaced and a missing one is read again in the background.
 */
export function seedAuthor(queryClient: QueryClient, profile: ProfileRow, updatedAt: number): void {
  const key = ["profile-by-id", profile.id];
  if (newer(queryClient, key, updatedAt)) return;
  queryClient.setQueryData(key, profile, { updatedAt });
}

/**
 * The post with its author attached, in the shape `fetchPost` returns, for
 * `["post", id]`. Only a post of the profile's own member: one they were
 * tagged in belongs to someone else, whose name the profile does not hold,
 * and is read as before.
 */
export function seedPost(
  queryClient: QueryClient,
  post: PostRow & { tagged_in?: boolean },
  author: ProfileRow,
  updatedAt: number,
): void {
  if (post.tagged_in || post.author_id !== author.id) return;
  const key = ["post", post.id];
  if (newer(queryClient, key, updatedAt)) return;
  const { tagged_in: _tagged, ...row } = post;
  const seeded: PostWithAuthor = {
    ...row,
    author: { id: author.id, username: author.username, full_name: author.full_name, avatar_url: author.avatar_url },
  };
  queryClient.setQueryData(key, seeded, { updatedAt: 0 });
}
