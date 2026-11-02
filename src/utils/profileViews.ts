import { sortByTaken } from "./memories";
import { NO_EDITS, editEras, editedEraOf, type EditedEra, type EraEdits } from "./eraEdits";
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
 * the same rows, as the author arranged them (`edits`), as the one that
 * holds the photograph tapped, so it is the one the profile showed, and
 * `era` is the name it shows: the author's own, if they gave it one. The
 * era's key in the address (its automatic title, which a rename does not
 * change) is second best: an address can change it on its way (a place
 * written with a `%` in it), so it is looked for only once the photograph
 * tapped has left the rows (deleted while the gallery was open), and the
 * rest of its era stays. If neither finds an era (it has come apart), the
 * whole taken order stands in, and `era` is null.
 *
 * Once found, the gallery keeps to that era by its key (`pinned`, from
 * galleryEra when it opened): the photograph tapped can be moved to
 * another era from the gallery's own "…", and the gallery stays with the
 * era it was opened on, without it. Only if that era is gone is it found
 * again as above.
 */
export function galleryRows<T extends Pick<PostRow, "id" | "taken_at" | "created_at" | "location">>(
  rows: T[],
  sort: GridSort | undefined,
  era: string | undefined,
  postId: string | undefined,
  edits: EraEdits = NO_EDITS,
  pinned: string | null = null,
): { rows: T[]; era: string | null } {
  const held = galleryEra(rows, era, postId, edits, pinned);
  if (held) return { rows: held.posts, era: held.title };
  return { rows: sort === "taken" || era ? sortByTaken(rows) : rows, era: null };
}

/** The era a gallery opened from an era holds, as galleryRows finds it, or null when it holds none. */
export function galleryEra<T extends Pick<PostRow, "id" | "taken_at" | "created_at" | "location">>(
  rows: T[],
  era: string | undefined,
  postId: string | undefined,
  edits: EraEdits = NO_EDITS,
  pinned: string | null = null,
): EditedEra<T> | null {
  if (!era) return null;
  if (pinned != null) {
    const kept = editEras(rows, edits).find((e) => e.key === pinned);
    if (kept) return kept;
  }
  const tapped = postId !== undefined && rows.some((p) => p.id === postId);
  return tapped ? editedEraOf(rows, postId, edits) : named(editEras(rows, edits), era);
}

/** An era by its key or, from an address older than keys, by the name it showed. */
function named<E extends { key: string; title: string }>(eras: E[], era: string): E | null {
  return eras.find((e) => e.key === era) ?? eras.find((e) => e.title === era) ?? null;
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
