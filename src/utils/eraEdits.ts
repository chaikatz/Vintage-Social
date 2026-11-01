import { groupEras, takenDate, sortByTaken, type Era } from "./memories";
import type { PostRow } from "@/types/db";

/**
 * A member's own arrangement of their eras: the names they gave them, and
 * the photographs they moved from one era into another.
 *
 * Eras are still read automatically (groupEras): a place and a year, or a
 * season and a year. The member's changes are laid over that reading, and
 * both are keyed by what it makes: a name by the era's automatic title,
 * which is unique, and a move by the photograph's id and the automatic
 * title of the era it went into. So a change whose photograph has been
 * deleted, or whose era has gone, is simply not applied, and a stale edit
 * never breaks Eras. Everything else that reads groupEras reads it as it
 * always has.
 *
 * A year, and a season, depend on where they are read: a photograph taken
 * late on New Year's Eve in Lisbon is already in the new year in Tokyo,
 * and still in the old one in New York. So an arrangement keeps the time
 * zone its keys were read in (the member's own, when they first arranged
 * their eras), and wherever it is laid over their photographs, they are
 * read in that zone: on the member's phone wherever they travel, and on
 * every reader's. Where nothing has been arranged, eras are read on the
 * phone's own calendar, as before.
 *
 * Kept on the server, one row per member (migration 0022), so every
 * reader of their Eras sees the same names.
 */

/** What a member has changed. Never mutated: every change below makes a new one. */
export interface EraEdits {
  /** An era's automatic title, its key ("Lisbon 2023"), to the member's name for it. */
  titles: Record<string, string>;
  /** A photograph's id to the key of the era it was moved into. */
  moves: Record<string, string>;
  /**
   * The time zone the keys were read in ("Europe/Lisbon"): the member's,
   * when they first arranged their eras, and kept from then on. Not a
   * change of theirs, so sameEdits leaves it out. Unset, eras are read on
   * the phone's own calendar.
   */
  zone?: string;
}

export const NO_EDITS: EraEdits = { titles: {}, moves: {} };

/** The longest name an era takes. The database holds it to the same (0022). */
export const ERA_TITLE_MAX = 60;

/**
 * The most of a member's photographs one read brings back. fetchUserPosts
 * asks for all of them, and PostgREST stops at its max_rows, which
 * Supabase sets to 1000 and this project leaves as it is
 * (supabase/config.toml), without saying that it has. A list this long
 * may not be all of them, so nothing is let go on its account (pruned).
 */
export const ROWS_PER_READ = 1000;

/** A time zone as the database keeps one (0022): an IANA name and nothing else. */
const ZONE = /^[A-Za-z0-9_+/-]{1,64}$/;

/** Control characters (Unicode's Cc, U+0000 to U+001F and U+007F to U+009F): a line break, a tab, a NUL. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export interface EditedEra<T = PostRow> extends Era<T> {
  /** The automatic title: what the member's changes refer to, and the name it goes back to. */
  key: string;
  /** `title` is the member's own name for it. */
  renamed: boolean;
}

export interface EditedEraSummary<T = PostRow> {
  eras: EditedEra<T>[];
  /** Photographs with no capture date, or one that cannot be read: no era can be told for them. */
  undated: number;
  /** Dated photographs in no era: alone in their place, or season, and year, and not moved into one. */
  apart: number;
}

type Gatherable = Pick<PostRow, "id" | "taken_at" | "created_at" | "location">;

function dated(post: Pick<PostRow, "taken_at" | "created_at">): boolean {
  return Boolean(post.taken_at) && !Number.isNaN(takenDate(post).getTime());
}

/**
 * The phone's own time zone, as an arrangement keeps it, or undefined
 * where the phone cannot say, or names one it cannot read eras in.
 */
export function deviceZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone !== "string" || !ZONE.test(zone)) return undefined;
    // Throws for a zone this phone cannot read eras in, which is no use to anyone else's either.
    void new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/**
 * A name as it is kept: one line, its spaces closed up, no control
 * characters (a line break is a space; the database would refuse a NUL),
 * at most ERA_TITLE_MAX characters (counted as a person counts them, so
 * an emoji is one and never cut in half). Empty when nothing is left.
 */
export function cleanEraTitle(title: string): string {
  const line = title.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return Array.from(line).slice(0, ERA_TITLE_MAX).join("").trim();
}

/**
 * The eras as the member arranged them, in the shape groupEras gives,
 * each with its key.
 *
 * Starts from every place, or season, and year the photographs fall in,
 * read in the arrangement's zone, including those with one photograph. A
 * move is made when the photograph is among the rows and has a capture
 * date, and the era it names is one of those; any other is left aside.
 * An era is shown when two or more photographs fall in it of themselves,
 * or when the member moved one into it, so an era the member built does
 * not come apart because one of its own photographs was deleted. An era a
 * move empties goes; one left with a single photograph stays, as that is
 * how the member left it, and its last photograph should not vanish from
 * the page because its neighbours moved. Within an era photographs run
 * newest capture first, and the eras by their newest capture, as they
 * always have. An era shows the member's name for it if they gave one.
 */
export function editEras<T extends Gatherable>(posts: T[], edits: EraEdits = NO_EDITS): EditedEra<T>[] {
  const buckets = groupEras(posts, 1, edits.zone);
  const held = new Map<string, T[]>(buckets.map((bucket) => [bucket.title, [...bucket.posts]]));
  const home = new Map<string, string>();
  for (const bucket of buckets) for (const post of bucket.posts) home.set(post.id, bucket.title);
  const byId = new Map(posts.map((post) => [post.id, post]));
  // The eras a move was made into.
  const joined = new Set<string>();

  for (const [id, key] of Object.entries(edits.moves)) {
    const post = byId.get(id);
    const into = held.get(key);
    if (!post || !into || !dated(post)) continue;
    const from = home.get(id);
    if (from === key) continue;
    if (from !== undefined) held.set(from, held.get(from)!.filter((p) => p.id !== id));
    into.push(post);
    joined.add(key);
  }

  const out: EditedEra<T>[] = [];
  for (const bucket of buckets) {
    const gathered = held.get(bucket.title)!;
    if (gathered.length === 0) continue;
    if (bucket.posts.length < 2 && !joined.has(bucket.title)) continue;
    const latest = new Date(Math.max(...gathered.map((p) => takenDate(p).getTime())));
    const own = typeof edits.titles[bucket.title] === "string" ? cleanEraTitle(edits.titles[bucket.title]) : "";
    const renamed = own !== "" && own !== bucket.title;
    out.push({ key: bucket.title, title: renamed ? own : bucket.title, renamed, posts: sortByTaken(gathered), latest });
  }
  return out.sort((a, b) => b.latest.getTime() - a.latest.getTime());
}

/**
 * The member's eras, and an honest count of what they leave out, as
 * eraSummary counts it for the automatic ones: every photograph is in
 * exactly one era or counted once, as undated or as apart.
 */
export function editedEraSummary<T extends Gatherable>(posts: T[], edits: EraEdits = NO_EDITS): EditedEraSummary<T> {
  const eras = editEras(posts, edits);
  const undated = posts.filter((p) => !dated(p)).length;
  const gathered = eras.reduce((n, e) => n + e.posts.length, 0);
  return { eras, undated, apart: posts.length - undated - gathered };
}

/** The era a photograph is in as the member arranged them, or null when it is in none or is no longer among the rows. */
export function editedEraOf<T extends Gatherable>(posts: T[], id: string, edits: EraEdits = NO_EDITS): EditedEra<T> | null {
  return editEras(posts, edits).find((e) => e.posts.some((p) => p.id === id)) ?? null;
}

/** An era a photograph can be moved into: its key, its name now, and the era itself, or null when moves have emptied it. */
export interface MoveChoice<T = PostRow> {
  key: string;
  title: string;
  era: EditedEra<T> | null;
  /** The photograph is in this one now. */
  here: boolean;
}

/**
 * Where a photograph can go: every era the page shows, in its order, then
 * any of the automatic ones (two or more photographs of their own) that
 * moves have emptied, so a photograph can always be taken back where it
 * came from. moveToEra takes exactly these.
 */
export function moveChoices<T extends Gatherable>(posts: T[], edits: EraEdits, id: string): MoveChoice<T>[] {
  const eras = editEras(posts, edits);
  const shown = new Set(eras.map((e) => e.key));
  const choices: MoveChoice<T>[] = eras.map((era) => ({
    key: era.key,
    title: era.title,
    era,
    here: era.posts.some((p) => p.id === id),
  }));
  for (const era of groupEras(posts, 2, edits.zone)) {
    if (shown.has(era.title)) continue;
    const own = typeof edits.titles[era.title] === "string" ? cleanEraTitle(edits.titles[era.title]) : "";
    choices.push({ key: era.title, title: own || era.title, era: null, here: false });
  }
  return choices;
}

/**
 * The arrangement without what no longer applies to any photograph: the
 * names of eras none of the member's photographs falls in now, and the
 * moves of photographs since deleted, or into such an era. Done with each
 * change saved, so the row, which everyone who may see the member's
 * photographs may read, keeps nothing of what they deleted. Only when
 * `posts` is known to be all of them: what is missing from a list that
 * may have been cut short (ROWS_PER_READ) is not known to be gone. An era
 * left with one photograph keeps its name for when it has more.
 */
function pruned(edits: EraEdits, posts: Gatherable[]): EraEdits {
  if (posts.length >= ROWS_PER_READ) return edits;
  const keys = new Set(groupEras(posts, 1, edits.zone).map((bucket) => bucket.title));
  const ids = new Set(posts.map((p) => p.id));
  const titles: Record<string, string> = {};
  for (const [key, name] of Object.entries(edits.titles)) if (keys.has(key)) titles[key] = name;
  const moves: Record<string, string> = {};
  for (const [id, key] of Object.entries(edits.moves)) if (ids.has(id) && keys.has(key)) moves[id] = key;
  return { ...edits, titles, moves };
}

/**
 * The member's name for an era, or, given nothing (or only spaces, or the
 * automatic name itself), its automatic name back. Given the member's
 * photographs, what no longer applies is let go on the way (pruned).
 */
export function renameEra(edits: EraEdits, key: string, title: string | null, posts?: Gatherable[]): EraEdits {
  const name = title == null ? "" : cleanEraTitle(title);
  const titles = { ...edits.titles };
  if (!name || name === key) delete titles[key];
  else titles[key] = name;
  if (titles[key] === edits.titles[key]) return edits;
  const next = { ...edits, titles };
  return posts ? pruned(next, posts) : next;
}

/**
 * A photograph moved into the era of `key`. Moved back into the era the
 * automatic reading put it in, it is no longer a move at all. Only into
 * an era moveChoices offers it, and only a photograph among the rows with
 * a capture date (no era can be told for one without); otherwise nothing
 * changes. What no longer applies is let go on the way (pruned), so the
 * row does not keep the deleted.
 */
export function moveToEra(edits: EraEdits, posts: Gatherable[], id: string, key: string): EraEdits {
  const post = posts.find((p) => p.id === id);
  if (!post || !dated(post)) return edits;
  if (!moveChoices(posts, edits, id).some((choice) => choice.key === key)) return edits;
  const home = groupEras(posts, 1, edits.zone).find((bucket) => bucket.posts.some((p) => p.id === id))?.title;
  const moves = { ...edits.moves };
  if (key === home) delete moves[id];
  else moves[id] = key;
  if (moves[id] === edits.moves[id]) return edits;
  return pruned({ ...edits, moves }, posts);
}

/** Whether two arrangements say the same. The zone they are read in is not something the member said. */
export function sameEdits(a: EraEdits, b: EraEdits): boolean {
  const same = (x: Record<string, string>, y: Record<string, string>) => {
    const keys = Object.keys(x);
    return keys.length === Object.keys(y).length && keys.every((k) => y[k] === x[k]);
  };
  return same(a.titles, b.titles) && same(a.moves, b.moves);
}

/**
 * An arrangement as read from the server, kept to what it should hold:
 * two maps of words, and the zone they were read in. Anything else in a
 * row (it never should be) is left out rather than trusted, and a name is
 * cleaned as it would have been when it was given.
 */
export function readEdits(row: { titles?: unknown; moves?: unknown; time_zone?: unknown } | null | undefined): EraEdits {
  const words = (value: unknown, clean: (s: string) => string) => {
    const out: Record<string, string> = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return out;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v !== "string") continue;
      const kept = clean(v);
      if (kept) out[k] = kept;
    }
    return out;
  };
  const edits: EraEdits = { titles: words(row?.titles, cleanEraTitle), moves: words(row?.moves, (s) => s) };
  const zone = row?.time_zone;
  if (typeof zone === "string" && ZONE.test(zone)) edits.zone = zone;
  return edits;
}
