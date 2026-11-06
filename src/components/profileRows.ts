import type { PostRow } from "@/types/db";
import { sortByTaken } from "@/utils/memories";
import type { GridPost } from "./PhotoGrid";

/**
 * Two posts by the server's timestamps, newest posted first.
 *
 * The timestamps are ISO strings in one format, so their characters
 * already sort by time: compared as they are, not through the locale's
 * collation, which the phone's runtime does a character at a time for
 * every comparison a sort makes (as the Places view now does,
 * src/utils/placeGroups.ts). A grid of two thousand photographs is some
 * twenty thousand comparisons each time it is drawn afresh.
 */
export function newestPostedFirst(a: Pick<PostRow, "created_at">, b: Pick<PostRow, "created_at">): number {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

/**
 * What a profile's grid shows: the member's own photographs and the ones
 * they were tagged in and chose to show, newest posted first, or by when
 * each was taken. Both profile pages, yours and a member's, draw this.
 */
export function profileRows(
  own: readonly PostRow[] | undefined,
  tagged: readonly PostRow[] | undefined,
  sort: "posted" | "taken",
): GridPost[] {
  const taggedIn = (tagged ?? []).map((p) => ({ ...p, tagged_in: true }));
  const all: GridPost[] = [...(own ?? []), ...taggedIn].sort(newestPostedFirst);
  return sort === "taken" ? sortByTaken(all) : all;
}
