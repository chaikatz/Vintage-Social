import type { ProfileRow } from "@/types/db";

/**
 * Who comes first when you search for a member.
 *
 * The people you were just looking at, the people you follow and the
 * people who follow you are almost always who you mean; a stranger with
 * the same first letters is not. Results are reordered so those rise,
 * in that order of closeness, and the search's own order is kept among
 * equals. Pure, so it is tested.
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

export function rankSearch<T extends Pick<ProfileRow, "id">>(results: readonly T[], circle: SearchCircle): T[] {
  return results
    .map((r, i) => ({ r, i, s: closeness(r.id, circle) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}
