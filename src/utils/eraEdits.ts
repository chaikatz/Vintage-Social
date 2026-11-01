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
 * deleted, or whose era has come apart, is simply not applied, and a
 * stale edit never breaks Eras. groupEras itself is untouched, and so is
 * everything else that reads it.
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
}

export const NO_EDITS: EraEdits = { titles: {}, moves: {} };

/** The longest name an era takes. The database holds it to the same (0022). */
export const ERA_TITLE_MAX = 60;

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
 * A name as it is kept: one line, its spaces closed up, at most
 * ERA_TITLE_MAX characters (counted as a person counts them, so an emoji
 * is one and never cut in half). Empty when nothing is left.
 */
export function cleanEraTitle(title: string): string {
  const line = title.replace(/\s+/g, " ").trim();
  return Array.from(line).slice(0, ERA_TITLE_MAX).join("").trim();
}

/**
 * The eras as the member arranged them, in the shape groupEras gives,
 * each with its key.
 *
 * Starts from the automatic eras. A move is made when the photograph is
 * among the rows and has a capture date, and the era it names is one of
 * the automatic ones; any other is left aside. An era a move empties
 * goes; one left with a single photograph stays, as that is how the
 * member left it, and its last photograph should not vanish from the
 * page because its neighbours moved. Within an era photographs run
 * newest capture first, and the eras by their newest capture, as they
 * always have. An era shows the member's name for it if they gave one.
 */
export function editEras<T extends Gatherable>(posts: T[], edits: EraEdits = NO_EDITS): EditedEra<T>[] {
  const automatic = groupEras(posts);
  const held = new Map<string, T[]>(automatic.map((era) => [era.title, [...era.posts]]));
  const home = new Map<string, string>();
  for (const era of automatic) for (const post of era.posts) home.set(post.id, era.title);
  const byId = new Map(posts.map((post) => [post.id, post]));

  for (const [id, key] of Object.entries(edits.moves)) {
    const post = byId.get(id);
    const into = held.get(key);
    if (!post || !into || !dated(post)) continue;
    const from = home.get(id);
    if (from === key) continue;
    if (from !== undefined) held.set(from, held.get(from)!.filter((p) => p.id !== id));
    into.push(post);
  }

  const out: EditedEra<T>[] = [];
  for (const era of automatic) {
    const gathered = held.get(era.title)!;
    if (gathered.length === 0) continue;
    const latest = new Date(Math.max(...gathered.map((p) => takenDate(p).getTime())));
    const own = typeof edits.titles[era.title] === "string" ? cleanEraTitle(edits.titles[era.title]) : "";
    const renamed = own !== "" && own !== era.title;
    out.push({ key: era.title, title: renamed ? own : era.title, renamed, posts: sortByTaken(gathered), latest });
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
 * Where a photograph can go: every era the automatic reading makes, in the
 * order the page shows them, then any that moves have emptied, so a
 * photograph can always be taken back where it came from.
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
  for (const era of groupEras(posts)) {
    if (shown.has(era.title)) continue;
    const own = typeof edits.titles[era.title] === "string" ? cleanEraTitle(edits.titles[era.title]) : "";
    choices.push({ key: era.title, title: own || era.title, era: null, here: false });
  }
  return choices;
}

/**
 * The member's name for an era, or, given nothing (or only spaces, or the
 * automatic name itself), its automatic name back.
 */
export function renameEra(edits: EraEdits, key: string, title: string | null): EraEdits {
  const name = title == null ? "" : cleanEraTitle(title);
  const titles = { ...edits.titles };
  if (!name || name === key) delete titles[key];
  else titles[key] = name;
  return { titles, moves: edits.moves };
}

/**
 * A photograph moved into the era of `key`. Moved back into the era the
 * automatic reading put it in, it is no longer a move at all. An era the
 * reading does not make is no place to move it, and nothing changes. The
 * moves of photographs that are no longer among the rows are let go on
 * the way, so the row does not keep the deleted.
 */
export function moveToEra(edits: EraEdits, posts: Gatherable[], id: string, key: string): EraEdits {
  const automatic = groupEras(posts);
  if (!automatic.some((era) => era.title === key) || !posts.some((p) => p.id === id)) return edits;
  const ids = new Set(posts.map((p) => p.id));
  const moves: Record<string, string> = {};
  for (const [moved, into] of Object.entries(edits.moves)) if (ids.has(moved)) moves[moved] = into;
  const home = automatic.find((era) => era.posts.some((p) => p.id === id))?.title;
  if (key === home) delete moves[id];
  else moves[id] = key;
  return { titles: edits.titles, moves };
}

/** Whether two arrangements say the same. */
export function sameEdits(a: EraEdits, b: EraEdits): boolean {
  const same = (x: Record<string, string>, y: Record<string, string>) => {
    const keys = Object.keys(x);
    return keys.length === Object.keys(y).length && keys.every((k) => y[k] === x[k]);
  };
  return same(a.titles, b.titles) && same(a.moves, b.moves);
}

/**
 * An arrangement as read from the server, kept to what it should hold:
 * two maps of words. Anything else in a row (it never should be) is left
 * out rather than trusted, and a name is cleaned as it would have been
 * when it was given.
 */
export function readEdits(row: { titles?: unknown; moves?: unknown } | null | undefined): EraEdits {
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
  return { titles: words(row?.titles, cleanEraTitle), moves: words(row?.moves, (s) => s) };
}
