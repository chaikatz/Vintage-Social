import type { PostRow } from "@/types/db";

/**
 * When a photograph was actually taken — the date that matters on VINTAGE.
 *
 * `taken_at` is what the camera recorded; `created_at` is only when the post
 * was made. Everything that sorts, groups or remembers by date reads this
 * one accessor, so the fallback for a file that carried no capture date is
 * decided once, here.
 */
export function takenDate(post: Pick<PostRow, "taken_at" | "created_at">): Date {
  return new Date(post.taken_at ?? post.created_at);
}

/** Newest capture first. Used for the "taken" order of a profile grid. */
export function sortByTaken<T extends Pick<PostRow, "taken_at" | "created_at">>(posts: T[]): T[] {
  return [...posts].sort((a, b) => takenDate(b).getTime() - takenDate(a).getTime());
}

// ---------------------------------------------------------------------------
// On this day
// ---------------------------------------------------------------------------

export interface Memory<T = PostRow> {
  post: T;
  /** Whole years between the capture and today; always at least 1. */
  yearsAgo: number;
  /** The free-text place the author wrote, if any. */
  place: string | null;
}

/**
 * The member's own photographs taken on today's month and day in an
 * earlier year, newest capture first.
 *
 * This is the shape a push notification will read from later — the query
 * is "posts whose taken_at falls on this calendar day in a prior year",
 * which is the same whether it runs on the phone or on a schedule.
 */
export function onThisDay<T extends Pick<PostRow, "taken_at" | "created_at" | "location">>(
  posts: T[],
  today: Date = new Date(),
): Memory<T>[] {
  const month = today.getMonth();
  const day = today.getDate();
  const year = today.getFullYear();
  const out: Memory<T>[] = [];
  for (const post of posts) {
    // Only a real capture date counts. A posting date is when it was
    // shared, which is not a memory of anything.
    if (!post.taken_at) continue;
    const taken = new Date(post.taken_at);
    if (Number.isNaN(taken.getTime())) continue;
    if (taken.getMonth() !== month || taken.getDate() !== day) continue;
    const yearsAgo = year - taken.getFullYear();
    if (yearsAgo < 1) continue;
    out.push({ post, yearsAgo, place: post.location ?? null });
  }
  return out.sort((a, b) => a.yearsAgo - b.yearsAgo);
}

/**
 * "1 year ago today, you were in Los Angeles."
 *
 * The exact sentence a notification would carry, so the strip in the app
 * and a push read the same way.
 */
export function memoryHeadline(memory: Pick<Memory, "yearsAgo" | "place">): string {
  const when = memory.yearsAgo === 1 ? "1 year ago today" : `${memory.yearsAgo} years ago today`;
  return memory.place ? `${when}, you were in ${memory.place}.` : `${when}.`;
}

/** The short form for a strip: "1 YEAR AGO · LOS ANGELES". */
export function memoryLabel(memory: Pick<Memory, "yearsAgo" | "place">): string {
  const when = memory.yearsAgo === 1 ? "1 year ago" : `${memory.yearsAgo} years ago`;
  return memory.place ? `${when} · ${memory.place}` : when;
}

// ---------------------------------------------------------------------------
// Eras
// ---------------------------------------------------------------------------

export interface Era<T = PostRow> {
  /** "St. Barths 2023", "Summer 2021". */
  title: string;
  posts: T[];
  /** Newest capture in the era, for ordering. */
  latest: Date;
}

const SEASONS = ["Winter", "Winter", "Spring", "Spring", "Spring", "Summer", "Summer", "Summer", "Autumn", "Autumn", "Autumn", "Winter"];

function seasonOf(date: Date): string {
  return SEASONS[date.getMonth()];
}

/**
 * Group a member's own photographs into eras: a place and a year when the
 * author named the place, otherwise a season and a year. Purely a way of
 * reading the grid — nothing is stored, so the grouping can change freely.
 *
 * Singletons are dropped. One photograph is a photograph, not an era.
 */
export function groupEras<T extends Pick<PostRow, "taken_at" | "created_at" | "location">>(
  posts: T[],
  minSize = 2,
): Era<T>[] {
  const buckets = new Map<string, Era<T>>();
  for (const post of posts) {
    if (!post.taken_at) continue;
    const taken = takenDate(post);
    if (Number.isNaN(taken.getTime())) continue;
    const place = post.location?.trim();
    const title = place ? `${place} ${taken.getFullYear()}` : `${seasonOf(taken)} ${taken.getFullYear()}`;
    const era = buckets.get(title);
    if (era) {
      era.posts.push(post);
      if (taken > era.latest) era.latest = taken;
    } else {
      buckets.set(title, { title, posts: [post], latest: taken });
    }
  }
  return [...buckets.values()]
    .filter((e) => e.posts.length >= minSize)
    .map((e) => ({ ...e, posts: sortByTaken(e.posts) }))
    .sort((a, b) => b.latest.getTime() - a.latest.getTime());
}

// ---------------------------------------------------------------------------
// Same night
// ---------------------------------------------------------------------------

/** How far either side of a capture "the same night" reaches. */
export const SAME_NIGHT_HOURS = 12;

/** The window around a capture that counts as the same night. */
export function sameNightWindow(iso: string, hours = SAME_NIGHT_HOURS): { from: Date; to: Date } {
  const centre = new Date(iso).getTime();
  return { from: new Date(centre - hours * 3_600_000), to: new Date(centre + hours * 3_600_000) };
}
