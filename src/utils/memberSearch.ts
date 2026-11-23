import type { ProfileRow } from "@/types/db";

/**
 * Finding a member as the name is typed: what is asked for, and in what
 * order the answers stand. Pure, so it is tested (tests/memberSearch.test.ts);
 * src/api/profiles.ts asks the database, the demo asks its own club, and
 * Search draws what comes back.
 *
 * From the first letter, members whose username starts with it. A first
 * letter is read through the username's own index (profiles_username_key)
 * as a range, `username >= "a" and username <= "azzz…"`, and stops at the
 * page, however large the club. A first letter anywhere in a name would
 * read every member to find the page (no index serves the middle of a
 * word), so names and the middles of words join from the second letter.
 *
 * In order: usernames that start with what was typed, then names with a
 * word that starts with it, then the rest that contain it; within each,
 * the people closest to you first (src/utils/searchRank.ts), then A to Z.
 */

/** The most a search brings back: a screen and a half of rows. */
export const SEARCH_LIMIT = 30;
/** Search asks from the first letter. */
export const SEARCH_MIN_LENGTH = 1;
/** Names, and the middles of words, are looked through from the second letter. */
export const NAMES_FROM = 2;
/** How long a pause in typing is before the next letters are asked about. */
export const SEARCH_DEBOUNCE_MS = 200;
/** The longest a username can be (0001's check: ^[a-z0-9_.]{3,24}$). */
export const USERNAME_MAX = 24;

const USERNAME_CHARS = /^[a-z0-9_.]+$/;

/**
 * What was typed, as it is asked about: trimmed, its spaces single, in
 * lower case (usernames are, and names are compared without case). A `*`
 * is dropped: the database reads it as "anything", and no name has one.
 */
export function searchNeedle(q: string): string {
  return q.replace(/\*/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * How long to wait before asking. The first letter is asked about at once,
 * since there is nothing on screen yet to keep; after that, a short pause
 * in the typing, so a quick word is one question rather than five.
 */
export function searchDelay(needle: string): number {
  return needle.length <= 1 ? 0 : SEARCH_DEBOUNCE_MS;
}

/** The username prefix to read, or none when what was typed could not begin a username (a space, an accented letter). */
export function usernamePrefix(needle: string): string | null {
  return USERNAME_CHARS.test(needle) ? needle : null;
}

/**
 * The usernames that start with `prefix`, as a range of the username
 * index: from the prefix itself to the prefix followed by more z's than a
 * username has letters. Usernames hold only a-z, 0-9, "_" and ".", and z
 * sorts after all of them in every collation PostgreSQL may use, so every
 * username that starts with the prefix is inside. In the C collation the
 * range is exactly those usernames; in a language's collation it may hold
 * a few more, and the `like` that goes with it keeps only the ones that
 * start with it. Either way the read is a walk of the index between the
 * two, never the table.
 */
export function usernameRange(prefix: string): { from: string; to: string } {
  return { from: prefix, to: prefix + "z".repeat(USERNAME_MAX) };
}

/** `s` as literal text inside a LIKE pattern: %, _ and \ escaped. */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/**
 * A value inside PostgREST's or=(…), in double quotes so its commas, dots,
 * colons and brackets are read as text, with \ and " escaped as PostgREST
 * reads them there.
 */
export function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/** How well a member matches: 0, their username starts with it; 1, a word of their name does; 2, either contains it. */
export type MatchTier = 0 | 1 | 2;

type Searchable = Pick<ProfileRow, "username" | "full_name">;

/** Where a word of `name` starts with `needle`: at its start, or after a space, a hyphen or an apostrophe. */
function wordStarts(name: string, needle: string): boolean {
  if (name.startsWith(needle)) return true;
  for (const sep of [" ", "-", "'", "’"]) {
    if (name.includes(sep + needle)) return true;
  }
  return false;
}

/**
 * Whether, and how well, `member` matches what was typed (a needle from
 * searchNeedle). One letter matches the start of a username only, as the
 * database is asked it; from the second, a name's words and anything that
 * contains it as well. Null: not a match.
 */
export function matchTier(needle: string, member: Searchable): MatchTier | null {
  if (needle.length < SEARCH_MIN_LENGTH) return null;
  const username = member.username.toLowerCase();
  if (username.startsWith(needle)) return 0;
  if (needle.length < NAMES_FROM) return null;
  const name = (member.full_name ?? "").toLowerCase();
  if (wordStarts(name, needle)) return 1;
  if (username.includes(needle) || name.includes(needle)) return 2;
  return null;
}

/**
 * The answers of a search's reads as one list: each member once, the
 * usernames that start with it first, then the names, then the rest, A to
 * Z by username within each, and no more than `limit`. A row the database
 * matched that this cannot place (a letter its case rules fold and these
 * do not) is kept, last, rather than lost.
 */
export function orderMatches<T extends Searchable & Pick<ProfileRow, "id">>(
  needle: string,
  rows: readonly T[],
  limit = SEARCH_LIMIT,
): T[] {
  const seen = new Set<string>();
  const placed: { row: T; tier: number }[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    placed.push({ row, tier: matchTier(needle, row) ?? 3 });
  }
  placed.sort((a, b) => a.tier - b.tier || (a.row.username < b.row.username ? -1 : a.row.username > b.row.username ? 1 : 0));
  return placed.slice(0, limit).map((p) => p.row);
}

/** Where a search's answer is kept: one entry per needle, so an answer can only ever be filed under the letters it answers. */
export function searchKey(needle: string) {
  return ["search", needle] as const;
}

/**
 * What the results list draws while the member types.
 *
 * The answer to what is in the field, once it has come. Until then, the
 * last answer that came, held rather than blanked, so the list does not
 * flicker between keystrokes; but only its rows that still match what is
 * typed, so nobody is shown under letters that do not find them. Typing
 * on from "ma" to "mar" narrows the list at once, and the answer for
 * "mar" fills it in.
 *
 * An answer is drawn as the answer only for the letters it was asked
 * about (`answered`, the key it was filed under). An answer that comes
 * late, for letters typed before, is never taken for the answer to the
 * letters typed since; at most its rows that still match are held, as
 * any earlier answer's are.
 */
export function shownResults<T extends Searchable>(input: {
  /** What is in the field now, as searchNeedle reads it. */
  typed: string;
  /** The letters the answer in hand was asked about. */
  answered: string;
  /** That answer, or none yet. */
  rows: readonly T[] | undefined;
  /** Whether it is an earlier answer held while the current one comes. */
  held: boolean;
}): readonly T[] {
  const { typed, answered, rows, held } = input;
  if (!rows || typed.length < SEARCH_MIN_LENGTH) return EMPTY;
  if (!held && answered === typed) return rows;
  return rows.filter((r) => matchTier(typed, r) !== null);
}

const EMPTY: readonly never[] = [];

/** Whether "Nobody by that name" is true: the answer for exactly what is typed has come, and it is empty. */
export function nobodyFound(input: { typed: string; answered: string; rows: readonly unknown[] | undefined; held: boolean; fetched: boolean }): boolean {
  const { typed, answered, rows, held, fetched } = input;
  return fetched && !held && answered === typed && typed.length >= SEARCH_MIN_LENGTH && (rows?.length ?? 0) === 0;
}
