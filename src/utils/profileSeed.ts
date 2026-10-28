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
 * The age given is the grid's own, so a screen opened on rows that are
 * already stale still reads them again in the background. An entry the
 * cache already holds that is newer than the grid is left as it is.
 */

function newer(queryClient: QueryClient, key: readonly unknown[], updatedAt: number): boolean {
  const held = queryClient.getQueryState(key);
  return held?.data !== undefined && held.dataUpdatedAt >= updatedAt;
}

/** The author, for the gallery's `["profile-by-id", id]`. */
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
  queryClient.setQueryData(key, seeded, { updatedAt });
}
