import type { ProfileRow } from "@/types/db";
import { matchTier } from "./memberSearch";

/**
 * Who comes first when you search for a member.
 *
 * The people you were just looking at, the people you follow and the
 * people who follow you are almost always who you mean; a stranger with
 * the same first letters is not. Results are reordered so those rise,
 * in that order of closeness, and the search's own order is kept among
 * equals. Pure, so it is tested.
 *
 * Given what was typed, how well each matches comes first, as the search
 * asked (src/utils/memberSearch.ts): usernames that start with it, then
 * names with a word that does, then the rest that contain it; closeness
 * orders each of those.
 */
export interface SearchCircle {
  recentIds: ReadonlySet<string>;
  followingIds: ReadonlySet<string>;
  followerIds: ReadonlySet<string>;
}

export function closeness(id: string, circle: SearchCircle): number {
  let score = 0;
  if (circle.recentIds.has(id)) score += 4;
  if (circle.followingIds.has(id)) score += 2;
  if (circle.followerIds.has(id)) score += 1;
  return score;
}

export function rankSearch<T extends Pick<ProfileRow, "id"> & Partial<Pick<ProfileRow, "username" | "full_name">>>(
  results: readonly T[],
  circle: SearchCircle,
  /** What was typed, as searchNeedle reads it; without it, closeness alone. */
  needle?: string,
): T[] {
  const tierOf = (r: T) =>
    needle && r.username != null ? matchTier(needle, { username: r.username, full_name: r.full_name ?? null }) ?? 3 : 0;
  return results
    .map((r, i) => ({ r, i, t: tierOf(r), s: closeness(r.id, circle) }))
    .sort((a, b) => a.t - b.t || b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}
