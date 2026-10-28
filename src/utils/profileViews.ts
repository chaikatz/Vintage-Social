import { eraOf, sortByTaken } from "./memories";
import type { PostRow } from "@/types/db";

/**
 * The ways a profile reads, in the order the toggle offers them, and where
 * a tap in each of them goes. Your own page and a member's both read
 * these, so the two cannot drift apart.
 */

/** Kept for the gallery's `sort` param: the two grid orders. */
export type GridSort = "posted" | "taken";
/** The six ways a profile reads. */
export type ProfileView = GridSort | "timeline" | "eras" | "map" | "places";

/**
 * The two grids, then the readings by date (the line, then its chapters),
 * then by place (the map, then the towns' names).
 */
export const PROFILE_VIEWS: readonly { view: ProfileView; label: string }[] = [
  { view: "posted", label: "Posted" },
  { view: "taken", label: "Taken" },
  { view: "timeline", label: "Timeline" },
  { view: "eras", label: "Eras" },
  { view: "map", label: "Map" },
  { view: "places", label: "Places" },
];

/**
 * Whether a tap on a photograph opens its author's gallery, to keep
 * scrolling through their work from there, or the post on its own. The
 * two grids and the eras open the gallery; the timeline, the map and the
 * places, which are read a photograph at a time, open the post. One you
 * were tagged in belongs to its author's gallery, not this one, and
 * always opens on its own.
 */
export function opensGallery(view: ProfileView, post: { tagged_in?: boolean }): boolean {
  if (post.tagged_in) return false;
  return view === "posted" || view === "taken" || view === "eras";
}

/**
 * What the gallery holds, in its order: the author's photographs as the
 * grid it was opened from orders them or, opened from an era, that era
 * alone, newest capture first. The era is found again among the eras of
 * the same rows as the one that holds the photograph tapped, so it is the
 * one the profile showed, and `era` is its own title. The title in the
 * address only says an era was opened: an address can change a title on
 * its way (a place written with a `%` in it). If the photograph is in no
 * era now (deleted, or its era come apart), the whole taken order stands
 * in, and `era` is null.
 */
export function galleryRows<T extends Pick<PostRow, "id" | "taken_at" | "created_at" | "location">>(
  rows: T[],
  sort: GridSort | undefined,
  era: string | undefined,
  postId: string | undefined,
): { rows: T[]; era: string | null } {
  const held = era && postId ? eraOf(rows, postId) : null;
  if (held) return { rows: held.posts, era: held.title };
  return { rows: sort === "taken" || era ? sortByTaken(rows) : rows, era: null };
}

/**
 * How far to scroll the toggle's row so the option at `spot` is in view,
 * with `edge` of room after it: nothing when it already is, and never
 * past the end of the row.
 */
export function revealOffset(
  spot: { x: number; width: number },
  viewport: number,
  content: number,
  edge: number,
): number {
  const needed = spot.x + spot.width + edge - viewport;
  return Math.max(0, Math.min(needed, content - viewport));
}
