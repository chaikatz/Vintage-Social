import type { PostRow } from "@/types/db";
import { sortByTaken, takenDate } from "./memories";

/**
 * A profile read as a timeline: one line down the page, and every
 * photograph branching off it at the point in time it was taken.
 *
 * The order is the date the shutter fired, newest at the top — the same
 * order the "Taken" grid uses, so the two views agree. Between two
 * photographs far apart in time the line is marked with how long passed,
 * so a gap reads as a gap rather than as two neighbours; and a new year
 * gets its number on the line, the way a family album has a year written
 * at the top of a page.
 *
 * Pure: it only decides what the rows are and which side each one hangs
 * from. The component draws them.
 */

export type TimelineSide = "left" | "right";

export type TimelineRow<T = PostRow> =
  | { kind: "year"; key: string; year: number }
  | { kind: "gap"; key: string; label: string }
  | { kind: "post"; key: string; post: T; side: TimelineSide; date: Date };

/** A gap shorter than this is just the line continuing. */
export const GAP_MIN_DAYS = 45;

const DAY_MS = 86_400_000;

/** "3 weeks", "7 months", "2 years" — the length of a silence on the line. */
export function gapLabel(days: number): string {
  if (days < 60) {
    const weeks = Math.max(1, Math.round(days / 7));
    return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }
  if (days < 365) {
    const months = Math.max(2, Math.round(days / 30.4));
    return `${months} months`;
  }
  const years = days / 365.25;
  const rounded = years < 3 ? Math.round(years * 2) / 2 : Math.round(years);
  const shown = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${shown} ${rounded === 1 ? "year" : "years"}`;
}

export function buildTimeline<T extends Pick<PostRow, "id" | "taken_at" | "created_at">>(
  posts: T[],
): TimelineRow<T>[] {
  const ordered = sortByTaken(posts);
  const rows: TimelineRow<T>[] = [];
  let lastYear: number | null = null;
  let lastDate: Date | null = null;
  let side: TimelineSide = "left";

  for (const post of ordered) {
    const date = takenDate(post);
    const year = date.getFullYear();
    if (lastDate) {
      const days = (lastDate.getTime() - date.getTime()) / DAY_MS;
      if (days >= GAP_MIN_DAYS) {
        rows.push({ kind: "gap", key: `gap-${post.id}`, label: gapLabel(days) });
      }
    }
    if (year !== lastYear) {
      rows.push({ kind: "year", key: `year-${year}-${post.id}`, year });
      lastYear = year;
    }
    rows.push({ kind: "post", key: post.id, post, side, date });
    side = side === "left" ? "right" : "left";
    lastDate = date;
  }
  return rows;
}
