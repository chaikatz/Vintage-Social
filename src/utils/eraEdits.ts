import { groupEras, takenDate, type Era } from "./memories";
import type { PostRow } from "@/types/db";

/**
 * A member's own arrangement of their eras: the names they gave them, the
 * photographs they moved from one era into another, and the eras they
 * made themselves.
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
 * An era the member makes has a key of its own instead: "~" and ten
 * letters and digits (MADE_ERA), which no automatic title can be, as
 * every one ends in a space and a year. Its name is kept under that key
 * like any other, and its photographs are the ones moved into it. It is
 * there while one of them is: an era of nothing is no era, and its name
 * is let go with its last photograph (pruned). A build of the app from
 * before eras could be made reads such a key as an era that is not there:
 * it skips the moves into it, so its readers see those photographs in
 * their automatic eras, and the name is never shown.
 *
 * Any of the member's photographs can be moved, one with no capture date
 * too. It sits in its era by when it was posted (placedAt), and leaves
 * the era's months, and its place among the others, to the photographs
 * that say when they were taken. Only an era none of whose photographs
 * says that is read from when they were posted.
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
 * reader of their Eras sees the same names. The row's checks hold an era
 * the member made as they hold any other: its key is a word like any
 * other, and its name is 1 to 60 characters like any other.
 */

/** What a member has changed. Never mutated: every change below makes a new one. */
export interface EraEdits {
  /**
   * An era's key to the member's name for it: an automatic title
   * ("Lisbon 2023"), or the key of an era the member made, whose only
   * name it is.
   */
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

/**
 * The key of an era the member made: "~" and ten lowercase letters and
 * digits. An automatic title always ends in a space and a year, so the
 * two can never be the same.
 */
export const MADE_ERA = /^~[0-9a-z]{10}$/;

/** Whether `key` is an era the member made, rather than an automatic title. */
export function isMadeEra(key: string): boolean {
  return MADE_ERA.test(key);
}

/**
 * What the move sheet offers to begin a new era with (moveChoices, given
 * `newEra`). Never the key of an era, so nothing is ever moved into it.
 */
export const NEW_ERA = "~new";
export const NEW_ERA_TITLE = "New era…";

/** The first of addChoices's groups: the photographs in no era. */
export const NOT_IN_AN_ERA = "Not in an era";

/** A time zone as the database keeps one (0022): an IANA name and nothing else. */
const ZONE = /^[A-Za-z0-9_+/-]{1,64}$/;

/** Control characters (Unicode's Cc, U+0000 to U+001F and U+007F to U+009F): a line break, a tab, a NUL. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export interface EditedEra<T = PostRow> extends Era<T> {
  /**
   * What the member's changes refer to: the automatic title, which is the
   * name it goes back to, or the key of an era the member made.
   */
  key: string;
  /**
   * `title` is the member's own name in place of the automatic one, which
   * "Use the automatic name" gives back. Never so for an era they made.
   */
  renamed: boolean;
  /**
   * An era the member made: its name is the only one it has, so there is
   * no automatic name to give back, and it goes with its last photograph.
   */
  made: boolean;
}

export interface EditedEraSummary<T = PostRow> {
  eras: EditedEra<T>[];
  /** Photographs in no era with no capture date, or one that cannot be read. */
  undated: number;
  /** Dated photographs in no era: alone in their place, or season, and year, and not moved into one. */
  apart: number;
}

type Gatherable = Pick<PostRow, "id" | "taken_at" | "created_at" | "location">;
type Timed = Pick<PostRow, "taken_at" | "created_at">;

/** Whether a photograph says when it was taken: a capture date that can be read. Automatic eras are read from these alone. */
export function dated(post: Timed): boolean {
  return Boolean(post.taken_at) && !Number.isNaN(takenDate(post).getTime());
}

/**
 * When a photograph sits among the others in an era, in milliseconds:
 * when it was taken, or, with no capture date to read, when it was
 * posted. The database always says that; were it ever unreadable, the
 * photograph sits last.
 */
export function placedAt(post: Timed): number {
  const taken = takenDate(post).getTime();
  if (!Number.isNaN(taken)) return taken;
  const posted = new Date(post.created_at).getTime();
  return Number.isNaN(posted) ? 0 : posted;
}

/** Newest first, by placedAt; those placed alike keep their order. */
function newestFirst<T extends Timed>(posts: T[]): T[] {
  return [...posts].sort((a, b) => placedAt(b) - placedAt(a));
}

/**
 * The newest moment of an era, by which the eras are ordered: its newest
 * capture, or, where none of its photographs says when it was taken, the
 * newest of when they were posted.
 */
function latestOf(posts: Timed[]): Date {
  const taken = posts.filter(dated);
  return new Date((taken.length > 0 ? taken : posts).reduce((most, p) => Math.max(most, placedAt(p)), -Infinity));
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

// ---------------------------------------------------------------------------
// A new era's key
// ---------------------------------------------------------------------------

const KEY_LETTERS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** How many random bytes a new era's key is drawn from: ten letters' worth, and some to spare. */
export const ERA_KEY_BYTES = 16;

/**
 * A new era's key from random bytes (newEraKey draws them from the
 * phone's secure source): a letter or digit for each byte under 252,
 * which 36 divides, so every one of them is as likely as the next. Null
 * in the rare case too few are.
 */
export function eraKeyFrom(bytes: ArrayLike<number>): string | null {
  let key = "~";
  for (let i = 0; i < bytes.length && key.length < 11; i++) {
    const byte = bytes[i];
    if (Number.isInteger(byte) && byte >= 0 && byte < 252) key += KEY_LETTERS[byte % 36];
  }
  return MADE_ERA.test(key) ? key : null;
}

// ---------------------------------------------------------------------------
// Laying the member's changes over the automatic reading
// ---------------------------------------------------------------------------

/** The member's name for the era of `key`, cleaned, or empty where they gave none. */
function nameOf(edits: EraEdits, key: string): string {
  const own = edits.titles[key];
  return typeof own === "string" ? cleanEraTitle(own) : "";
}

/**
 * Where every arrangement starts: the automatic eras, read in the
 * arrangement's zone, one photograph or more; and the eras the member
 * made, by key, each with its name (one without a name is not one).
 */
function reading<T extends Gatherable>(posts: T[], edits: EraEdits) {
  const automatic = groupEras(posts, 1, edits.zone);
  const made = new Map<string, string>();
  for (const key of Object.keys(edits.titles).sort()) {
    const name = isMadeEra(key) ? nameOf(edits, key) : "";
    if (name) made.set(key, name);
  }
  return { automatic, made };
}

/** The member's changes laid over the photographs: the eras the page shows, and where each photograph is. */
interface Laid<T> {
  /** Every automatic era, one photograph or more, as groupEras orders them. */
  automatic: Era<T>[];
  /** The eras shown, in the page's order. */
  eras: EditedEra<T>[];
  /** A photograph in an era, by id, to that era's key. One in none is not here. */
  where: Map<string, string>;
  /** A photograph a move took into an era, by id, to that era's key. */
  moved: Map<string, string>;
  /** A dated photograph, by id, to the automatic era it falls in. */
  home: Map<string, string>;
}

/**
 * A move is made when its photograph is among the rows, and the era it
 * names is an automatic one (of one photograph or more) or one the member
 * made and named; any other is left aside. An automatic era is shown when
 * two or more photographs fall in it of themselves, or when the member
 * moved one into it, so an era the member built does not come apart
 * because one of its own photographs was deleted. An era a move empties
 * goes; one left with a single photograph stays, as that is how the
 * member left it. An era the member made is shown while it holds a
 * photograph.
 */
function lay<T extends Gatherable>(posts: T[], edits: EraEdits): Laid<T> {
  const { automatic, made } = reading(posts, edits);
  const home = new Map<string, string>();
  for (const era of automatic) for (const post of era.posts) home.set(post.id, era.title);
  const byId = new Map(posts.map((post) => [post.id, post]));

  const held = new Map<string, T[]>();
  const moved = new Map<string, string>();
  for (const era of automatic) held.set(era.title, []);
  for (const key of made.keys()) held.set(key, []);
  for (const [id, key] of Object.entries(edits.moves)) {
    if (byId.has(id) && held.has(key) && home.get(id) !== key) moved.set(id, key);
  }
  // Each era's own, but those moved out of it, then those moved into it.
  for (const era of automatic) held.set(era.title, era.posts.filter((p) => !moved.has(p.id)));
  for (const [id, key] of moved) held.get(key)!.push(byId.get(id)!);
  const joined = new Set(moved.values());

  const eras: EditedEra<T>[] = [];
  for (const era of automatic) {
    const gathered = held.get(era.title)!;
    if (gathered.length === 0) continue;
    if (era.posts.length < 2 && !joined.has(era.title)) continue;
    const own = nameOf(edits, era.title);
    const renamed = own !== "" && own !== era.title;
    eras.push({
      key: era.title,
      title: renamed ? own : era.title,
      renamed,
      made: false,
      posts: newestFirst(gathered),
      latest: latestOf(gathered),
    });
  }
  for (const [key, name] of made) {
    const gathered = held.get(key)!;
    if (gathered.length === 0) continue;
    eras.push({ key, title: name, renamed: false, made: true, posts: newestFirst(gathered), latest: latestOf(gathered) });
  }
  eras.sort((a, b) => b.latest.getTime() - a.latest.getTime());

  const where = new Map<string, string>();
  for (const era of eras) for (const post of era.posts) where.set(post.id, era.key);
  return { automatic, eras, where, moved, home };
}

/**
 * The eras as the member arranged them, in the shape groupEras gives,
 * each with its key.
 *
 * Within an era photographs run newest first (placedAt), and the eras by
 * their newest capture, as they always have. An era shows the member's
 * name for it if they gave one.
 */
export function editEras<T extends Gatherable>(posts: T[], edits: EraEdits = NO_EDITS): EditedEra<T>[] {
  return lay(posts, edits).eras;
}

/**
 * The member's eras, and an honest count of what they leave out, as
 * eraSummary counts it for the automatic ones: every photograph is in
 * exactly one era or counted once, as undated or as apart.
 */
export function editedEraSummary<T extends Gatherable>(posts: T[], edits: EraEdits = NO_EDITS): EditedEraSummary<T> {
  const { eras, where } = lay(posts, edits);
  const out = posts.filter((p) => !where.has(p.id));
  const undated = out.filter((p) => !dated(p)).length;
  return { eras, undated, apart: out.length - undated };
}

/** The era a photograph is in as the member arranged them, or null when it is in none or is no longer among the rows. */
export function editedEraOf<T extends Gatherable>(posts: T[], id: string, edits: EraEdits = NO_EDITS): EditedEra<T> | null {
  return editEras(posts, edits).find((e) => e.posts.some((p) => p.id === id)) ?? null;
}

// ---------------------------------------------------------------------------
// Where a photograph can go
// ---------------------------------------------------------------------------

/** An era a photograph can be moved into: its key, its name now, and the era itself, or null when moves have emptied it. */
export interface MoveChoice<T = PostRow> {
  key: string;
  title: string;
  era: EditedEra<T> | null;
  /** The photograph is in this one now. */
  here: boolean;
  /** An era the member made, or, with `newEra`, would make: its name is the only one it has. */
  made: boolean;
  /**
   * Not an era but the offer to begin one ("New era…"): the sheet asks for
   * its name and makes it with the photograph (createEra). Never moved into.
   */
  newEra: boolean;
}

/**
 * Every era a photograph can go into: those the page shows, in its order,
 * then any of the automatic ones (two or more photographs of their own)
 * that moves have emptied, so a photograph can always be taken back
 * where it came from.
 */
function destinations<T extends Gatherable>(laid: Laid<T>, edits: EraEdits): Omit<MoveChoice<T>, "here" | "newEra">[] {
  const out: Omit<MoveChoice<T>, "here" | "newEra">[] = laid.eras.map((era) => ({ key: era.key, title: era.title, era, made: era.made }));
  const shown = new Set(out.map((d) => d.key));
  for (const era of laid.automatic) {
    if (era.posts.length < 2 || shown.has(era.title)) continue;
    out.push({ key: era.title, title: nameOf(edits, era.title) || era.title, era: null, made: false });
  }
  return out;
}

/**
 * Where a photograph can go, the one it is in marked: every era the page
 * shows, then any automatic one moves have emptied (destinations). Any of
 * the member's photographs, in an era or in none, dated or not.
 * moveToEra and addToEra take exactly these. Given `newEra`, the offer of
 * a new era comes last.
 */
export function moveChoices<T extends Gatherable>(
  posts: T[],
  edits: EraEdits,
  id: string,
  offer: { newEra?: boolean } = {},
): MoveChoice<T>[] {
  const laid = lay(posts, edits);
  const now = laid.where.get(id);
  const choices: MoveChoice<T>[] = destinations(laid, edits).map((d) => ({ ...d, here: d.key === now, newEra: false }));
  if (offer.newEra) choices.push({ key: NEW_ERA, title: NEW_ERA_TITLE, era: null, here: false, made: true, newEra: true });
  return choices;
}

/** Photographs the member can add to an era, gathered by where they are now. */
export interface AddGroup<T = PostRow> {
  /** The era they are in now, by key; null for those in none. */
  key: string | null;
  /** NOT_IN_AN_ERA, or the era's name as the page shows it. */
  title: string;
  /** The era they are in now; null for those in none. */
  era: EditedEra<T> | null;
  /** Newest first. */
  posts: T[];
}

/**
 * What ADD offers for the era of `eraKey`: every one of the member's
 * photographs not in it, gathered by where they are now. Those in no era
 * come first (NOT_IN_AN_ERA), then each era in the page's order, by the
 * name it shows; newest first throughout. A group with nothing in it is
 * left out. Null for `eraKey` is for an era yet to be made, and offers
 * them all. Nothing for an era that cannot take a photograph.
 */
export function addChoices<T extends Gatherable>(posts: T[], edits: EraEdits, eraKey: string | null): AddGroup<T>[] {
  const laid = lay(posts, edits);
  if (eraKey !== null && !destinations(laid, edits).some((d) => d.key === eraKey)) return [];
  const groups: AddGroup<T>[] = [];
  const none = newestFirst(posts.filter((p) => !laid.where.has(p.id)));
  if (none.length > 0) groups.push({ key: null, title: NOT_IN_AN_ERA, era: null, posts: none });
  for (const era of laid.eras) {
    if (era.key !== eraKey) groups.push({ key: era.key, title: era.title, era, posts: era.posts });
  }
  return groups;
}

/**
 * Where a photograph would go were it taken out of the era a move put it
 * in (takeOut): back to the era the automatic reading puts it in, as the
 * page would then show it, or null for none. Null altogether when no move
 * put it where it is, so there is nothing to take it out of.
 */
export function takeOutChoice<T extends Gatherable>(posts: T[], edits: EraEdits, id: string): { back: EditedEra<T> | null } | null {
  const after = takeOut(edits, posts, id);
  if (after === edits) return null;
  return { back: editedEraOf(posts, id, after) };
}

// ---------------------------------------------------------------------------
// Changes, as the member makes them
// ---------------------------------------------------------------------------

/**
 * The arrangement without what no longer applies to any photograph: the
 * names of eras none of the member's photographs falls in now, and of
 * eras they made that no photograph is moved into now, and the moves of
 * photographs since deleted, or into such an era. Done with each change
 * saved, so the row, which everyone who may see the member's photographs
 * may read, keeps nothing of what they deleted. Only when `posts` is
 * known to be all of them: what is missing from a list that may have
 * been cut short (ROWS_PER_READ) is not known to be gone. An automatic
 * era left with one photograph keeps its name for when it has more.
 *
 * A build from before eras could be made lets go of an era the member
 * made, as of any name whose era it cannot find, when it saves a change.
 */
function pruned(edits: EraEdits, posts: Gatherable[]): EraEdits {
  if (posts.length >= ROWS_PER_READ) return edits;
  const { automatic, made } = reading(posts, edits);
  const ids = new Set(posts.map((p) => p.id));
  const keys = new Set(automatic.map((era) => era.title));
  for (const [id, key] of Object.entries(edits.moves)) if (ids.has(id) && made.has(key)) keys.add(key);
  const titles: Record<string, string> = {};
  for (const [key, name] of Object.entries(edits.titles)) if (keys.has(key)) titles[key] = name;
  const moves: Record<string, string> = {};
  for (const [id, key] of Object.entries(edits.moves)) if (ids.has(id) && keys.has(key)) moves[id] = key;
  return { ...edits, titles, moves };
}

/**
 * The member's name for an era, or, given nothing (or only spaces, or the
 * automatic name itself), its automatic name back. An era the member made
 * has no other name, so it keeps the one it has when given nothing, and
 * only one that is there is renamed. Given the member's photographs, what
 * no longer applies is let go on the way (pruned).
 */
export function renameEra(edits: EraEdits, key: string, title: string | null, posts?: Gatherable[]): EraEdits {
  const name = title == null ? "" : cleanEraTitle(title);
  const titles = { ...edits.titles };
  if (isMadeEra(key)) {
    if (!name || typeof edits.titles[key] !== "string") return edits;
    titles[key] = name;
  } else if (!name || name === key) delete titles[key];
  else titles[key] = name;
  if (titles[key] === edits.titles[key]) return edits;
  const next = { ...edits, titles };
  return posts ? pruned(next, posts) : next;
}

/**
 * The photographs of `photoIds` added to the era of `key`, one change for
 * them all, wherever each was: in no era, in another, dated or not. One
 * moved back into the era the automatic reading put it in is no longer a
 * move at all. Only into an era moveChoices offers, and only photographs
 * among the rows; one already there is left as it is, and when nothing
 * moves the arrangement itself comes back. What no longer applies is let
 * go on the way (pruned), so the row does not keep the deleted.
 */
export function addToEra(edits: EraEdits, posts: Gatherable[], key: string, photoIds: readonly string[]): EraEdits {
  const laid = lay(posts, edits);
  if (!destinations(laid, edits).some((d) => d.key === key)) return edits;
  const ids = new Set(posts.map((p) => p.id));
  const moves = { ...edits.moves };
  let changed = false;
  for (const id of photoIds) {
    if (!ids.has(id) || laid.where.get(id) === key) continue;
    if (laid.home.get(id) === key) delete moves[id];
    else moves[id] = key;
    changed ||= moves[id] !== edits.moves[id];
  }
  return changed ? pruned({ ...edits, moves }, posts) : edits;
}

/** A photograph moved into the era of `key`: addToEra, for one. */
export function moveToEra(edits: EraEdits, posts: Gatherable[], id: string, key: string): EraEdits {
  return addToEra(edits, posts, key, [id]);
}

/**
 * A new era of the member's own, named `name` (cleaned, as any name is),
 * holding the photographs of `photoIds` that are among the rows, from
 * wherever they were. Its key is drawn fresh (makeId, the phone's secure
 * random source unless one is given) and never one already in use.
 * Nothing is made without a name, or without a photograph to hold: the
 * arrangement comes back as it was, and no key.
 */
export function createEra(
  edits: EraEdits,
  posts: Gatherable[],
  name: string,
  photoIds: readonly string[],
  makeId?: () => string,
): { edits: EraEdits; key: string | null } {
  const title = cleanEraTitle(name);
  const ids = new Set(posts.map((p) => p.id));
  const taking = [...new Set(photoIds)].filter((id) => ids.has(id));
  if (!title || taking.length === 0) return { edits, key: null };
  // Required only once an era is made, so nothing that only reads eras (node's tests among them) loads the phone's random source.
  const key = (makeId ?? (require("./newEraKey") as typeof import("./newEraKey")).newEraKey)();
  const taken = typeof edits.titles[key] === "string" || Object.values(edits.moves).includes(key);
  if (!isMadeEra(key) || taken) return { edits, key: null };
  const moves = { ...edits.moves };
  for (const id of taking) moves[id] = key;
  return { edits: pruned({ ...edits, titles: { ...edits.titles, [key]: title }, moves }, posts), key };
}

/**
 * A photograph taken out of the era a move put it in: the move is gone,
 * and it is back where the automatic reading puts it, which may be no
 * era. Taken out of an era the member made, that era goes with its last
 * photograph. One no move put where it is has nothing to be taken out
 * of, and the arrangement comes back as it was.
 */
export function takeOut(edits: EraEdits, posts: Gatherable[], id: string): EraEdits {
  if (!lay(posts, edits).moved.has(id)) return edits;
  const moves = { ...edits.moves };
  delete moves[id];
  return pruned({ ...edits, moves }, posts);
}

/**
 * An era the member made, gone: its name, and every move into it, so its
 * photographs are back where the automatic reading puts them. Only an era
 * the member made: an automatic one is how their photographs fall, not
 * something to delete. Nothing to delete, and the arrangement comes back
 * as it was.
 */
export function deleteEra(edits: EraEdits, posts: Gatherable[], key: string): EraEdits {
  if (!isMadeEra(key)) return edits;
  const moves = Object.fromEntries(Object.entries(edits.moves).filter(([, into]) => into !== key));
  const titles = { ...edits.titles };
  delete titles[key];
  if (Object.keys(titles).length === Object.keys(edits.titles).length && Object.keys(moves).length === Object.keys(edits.moves).length) {
    return edits;
  }
  return pruned({ ...edits, titles, moves }, posts);
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
 * two maps of words, and the zone they were read in. Any key is kept, an
 * era the member made among them. Anything else in a row (it never should
 * be) is left out rather than trusted, and a name is cleaned as it would
 * have been when it was given.
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
