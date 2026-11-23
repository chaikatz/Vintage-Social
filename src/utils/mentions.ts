/**
 * @names in what members write: captions and comments.
 *
 * A name written after an @ is a link to that member's page, wherever the
 * words are drawn, and while a member is writing one, the members it
 * could be are offered under the field. Nothing is stored about it and
 * nobody is told: the words are kept exactly as they were typed, and the
 * link is made each time they are drawn.
 *
 * What counts as a name follows the rules every username is held to
 * (src/utils/validation.ts): three to twenty-four letters, digits, dots
 * and underscores, never starting or ending with a dot. A name is matched
 * whatever its case, since usernames are kept in lowercase. An @ inside a
 * word is not a name: `ansel@example.com` is an address, and `café@noon`
 * is not anyone.
 */
import { validateUsername } from "./validation";

/** A character a username can hold, as typed (any case). */
const HANDLE_CHAR = /[A-Za-z0-9_.]/;
/**
 * A character that, written just before an @, makes the @ part of a word,
 * an address or another name rather than the start of one: a letter or a
 * digit in any script, a mark on one, an underscore, a dot, another @.
 */
const JOINS_BEFORE = /[\p{L}\p{N}\p{M}_.@]/u;
/**
 * A character that, written just after the name, means the name has not
 * ended: a letter, digit or mark the name's own characters do not cover
 * (`@josé` is not `@jos`), or another @ (`@ansel@example.com`).
 */
const JOINS_AFTER = /[\p{L}\p{N}\p{M}@]/u;

/** The longest a username can be (src/utils/validation.ts). */
export const MENTION_MAX = 24;

/** How many members are offered while a name is being written. */
export const MENTION_SUGGESTIONS = 5;

export type MentionPart =
  | { kind: "text"; text: string }
  /** `text` as it was written, the @ with it; `username` in the lowercase usernames are kept in. */
  | { kind: "mention"; text: string; username: string };

/**
 * The words, in order, as plain runs and @names. Joined back together
 * they are exactly the words given. Words with no name in them come back
 * as one plain run.
 */
export function parseMentions(text: string): MentionPart[] {
  const parts: MentionPart[] = [];
  if (!text) return parts;
  let plainFrom = 0;
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at < 0) break;
    const found = mentionAt(text, at);
    if (!found) {
      i = at + 1;
      continue;
    }
    if (at > plainFrom) parts.push({ kind: "text", text: text.slice(plainFrom, at) });
    parts.push({ kind: "mention", text: text.slice(at, found.end), username: found.username });
    plainFrom = found.end;
    i = found.end;
  }
  if (plainFrom < text.length) parts.push({ kind: "text", text: text.slice(plainFrom) });
  return parts;
}

/** The members named in these words, each once, in the order first named. */
export function mentionedUsernames(text: string): string[] {
  const out: string[] = [];
  for (const part of parseMentions(text)) {
    if (part.kind === "mention" && !out.includes(part.username)) out.push(part.username);
  }
  return out;
}

/** The whole character that ends just before `i`, an emoji's two halves together. */
function charBefore(text: string, i: number): string {
  if (i <= 0) return "";
  const low = text.charCodeAt(i - 1);
  if (low >= 0xdc00 && low <= 0xdfff && i >= 2) {
    const high = text.charCodeAt(i - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(i - 2, i);
  }
  return text[i - 1];
}

/** The whole character that starts at `i`. */
function charAt(text: string, i: number): string {
  const point = text.codePointAt(i);
  return point === undefined ? "" : String.fromCodePoint(point);
}

/** Whether an @ at `at` stands at the start of a word, not inside one. */
function startsWord(text: string, at: number): boolean {
  return !JOINS_BEFORE.test(charBefore(text, at));
}

/** The name an @ at `at` starts, and where it ends; null when it starts none. */
function mentionAt(text: string, at: number): { end: number; username: string } | null {
  if (!startsWord(text, at)) return null;
  let stop = at + 1;
  while (stop < text.length && HANDLE_CHAR.test(text[stop])) stop++;
  // The name runs on into a letter its characters do not cover (`@josé`),
  // or into another @ (`@ansel@example.com`): not a name at all.
  if (stop < text.length && JOINS_AFTER.test(charAt(text, stop))) return null;
  // A full stop after a name is the sentence's, not the name's: no name ends with a dot.
  let end = stop;
  while (end > at + 1 && text[end - 1] === ".") end--;
  const username = text.slice(at + 1, end).toLowerCase();
  if (!username || validateUsername(username) !== null) return null;
  return { end, username };
}

/** A name being written: where its @ is, where the name ends, and what has been typed of it up to the caret. */
export interface ActiveMention {
  /** The @. */
  start: number;
  /** Just past the name, the caret's side of it and any of it after the caret. */
  end: number;
  /** What is typed between the @ and the caret: what the members offered are matched on. */
  query: string;
}

/**
 * The name being written at the caret, if one is: an @ that starts a word
 * (not one inside an address), followed by nothing but a username's
 * characters up to the caret. A bare @ counts, with nothing typed yet.
 */
export function activeMention(text: string, caret: number): ActiveMention | null {
  const c = Math.max(0, Math.min(caret, text.length));
  let i = c;
  while (i > 0 && HANDLE_CHAR.test(text[i - 1])) i--;
  if (i === 0 || text[i - 1] !== "@") return null;
  const start = i - 1;
  if (!startsWord(text, start)) return null;
  const query = text.slice(i, c);
  if (query.length > MENTION_MAX || query.startsWith(".")) return null;
  let end = c;
  while (end < text.length && HANDLE_CHAR.test(text[end])) end++;
  return { start, end, query };
}

/**
 * The words with the name being written replaced by the member chosen,
 * `@username ` and a space after it, and where the caret goes: just past
 * that space. A space already after the name is used rather than doubled.
 * Null when the words would then be longer than the field takes.
 */
export function insertMention(
  text: string,
  mention: Pick<ActiveMention, "start" | "end">,
  username: string,
  max: number,
): { text: string; caret: number } | null {
  const before = text.slice(0, mention.start);
  let after = text.slice(mention.end);
  if (after.startsWith(" ")) after = after.slice(1);
  const name = `@${username.toLowerCase()} `;
  const next = before + name + after;
  if (next.length > max) return null;
  return { text: next, caret: before.length + name.length };
}

/**
 * The words with `insert` put in at the caret, and the caret just past it.
 * Null when they would then be longer than the field takes: nothing is
 * cut to make room, and never half of an emoji.
 */
export function insertAtCaret(
  text: string,
  caret: number,
  insert: string,
  max: number,
): { text: string; caret: number } | null {
  const c = Math.max(0, Math.min(caret, text.length));
  if (text.length + insert.length > max) return null;
  return { text: text.slice(0, c) + insert + text.slice(c), caret: c + insert.length };
}

/** A member who can be offered for a name: what a row of members draws. */
export interface MentionCandidate {
  id: string;
  username: string;
  full_name?: string | null;
  avatar_url?: string | null;
}

/**
 * How well a member answers what is typed, best first; -1 for not at all.
 * A username that starts with it, then a name with a word that does, then
 * a username or a name that holds it anywhere (as Search finds them).
 */
function closeness(member: MentionCandidate, q: string): number {
  if (!q) return 0;
  const username = member.username.toLowerCase();
  if (username.startsWith(q)) return 0;
  const name = (member.full_name ?? "").toLowerCase();
  if (name.split(/\s+/).some((word) => word.startsWith(q))) return 1;
  if (username.includes(q) || name.includes(q)) return 2;
  return -1;
}

/**
 * The members offered for a name being written: those the writer follows
 * first, then anyone a search found, never the writer, each once, at most
 * `limit`. Within each, the closest to what is typed first, and otherwise
 * in the order they came (the newest follow first; Search's own order).
 * With nothing typed yet, the members the writer follows.
 */
export function rankMentionSuggestions(
  query: string,
  followed: readonly MentionCandidate[],
  found: readonly MentionCandidate[],
  myId: string,
  limit: number = MENTION_SUGGESTIONS,
): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  const out: MentionCandidate[] = [];
  const seen = new Set<string>([myId]);
  for (const group of [followed, found]) {
    const ranked = group
      .map((member, order) => ({ member, order, score: closeness(member, q) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score || a.order - b.order);
    for (const { member } of ranked) {
      if (out.length >= limit) return out;
      if (seen.has(member.id)) continue;
      seen.add(member.id);
      out.push(member);
    }
  }
  return out;
}
