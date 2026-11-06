import type { MessageWithPost } from "@/types/db";
import { ROWS_PER_READ } from "@/utils/eraEdits";

/**
 * Reading an open thread again while it is on screen.
 *
 * The thread is read every few seconds while it is the screen in view, so
 * a reply shows up on its own. Each of those reads used to bring the whole
 * thread back, up to its newest thousand messages, to be parsed on the
 * JavaScript thread and compared with what was already there: a long
 * conversation cost a thousand rows every five seconds to learn that
 * nothing had changed. Now a poll asks only for what is new since the
 * newest message held, and adds it to the thread.
 *
 * "New since" looks fifteen seconds further back than the newest message
 * held: a message's time is set as its insert begins, and an insert still
 * at work when the newest was read (a slow trigger, the other member
 * sending at the same moment) lands with an earlier time than one already
 * seen. Those come in with the overlap, far longer than any insert takes,
 * and anything already held is replaced by its newer copy, by id.
 *
 * The whole thread (bounded: its newest ROWS_PER_READ) is still read when
 * it opens, when something says it changed (a photograph in it deleted, a
 * member blocked, a read that failed: react-query marks the read
 * invalidated), when a poll finds more than it can bring at once, and
 * every few minutes, so a photograph that has since gone, or a mark,
 * catches up as it did when every read was whole.
 */

/** How far before the newest message held a poll looks. */
export const POLL_OVERLAP_MS = 15_000;

/** The most one poll brings; finding that many, the thread is read whole. */
export const POLL_LIMIT = 100;

/** The longest a thread goes between whole reads while it is open. */
export const WHOLE_READ_EVERY_MS = 5 * 60_000;

/** The messages a thread holds: its newest, as many as a whole read brings. */
export const THREAD_KEEP = ROWS_PER_READ;

type Message = Pick<MessageWithPost, "id" | "created_at">;

/** Whether the next read of the thread is whole, or only what is new. */
export function readWhole({
  held,
  invalidated,
  lastWholeAt,
  now,
}: {
  held: readonly Message[] | undefined;
  invalidated: boolean;
  lastWholeAt: number;
  now: number;
}): boolean {
  if (!held || held.length === 0 || invalidated) return true;
  return !(now - lastWholeAt < WHOLE_READ_EVERY_MS);
}

/** The time a poll reads from: the newest message held, less the overlap. Null with nothing held. */
export function pollFrom(held: readonly Message[] | undefined): string | null {
  const newest = held?.[held.length - 1];
  if (!newest) return null;
  const at = Date.parse(newest.created_at);
  if (!Number.isFinite(at)) return null;
  return new Date(at - POLL_OVERLAP_MS).toISOString();
}

function byTime(a: Message, b: Message): number {
  const d = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (d !== 0 && Number.isFinite(d)) return d;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The thread with `newer` added, oldest first: each message once, a newer
 * copy in place of the one held, and only the newest `keep`. The thread as
 * it was when there is nothing to add.
 */
export function mergeNewer<T extends Message>(held: readonly T[], newer: readonly T[], keep = THREAD_KEEP): T[] {
  if (newer.length === 0) return held as T[];
  const byId = new Map<string, T>();
  for (const m of held) byId.set(m.id, m);
  for (const m of newer) byId.set(m.id, m);
  const merged = [...byId.values()].sort(byTime);
  return merged.length > keep ? merged.slice(merged.length - keep) : merged;
}

/**
 * One read of an open thread: whole, or what is new since the newest held,
 * as `readWhole` decides. `whole` reads the thread's newest messages,
 * oldest first; `since` reads those from a time on, oldest first, at most
 * POLL_LIMIT.
 */
export async function readThread<T extends Message>({
  held,
  invalidated,
  lastWholeAt,
  now,
  whole,
  since,
}: {
  held: readonly T[] | undefined;
  invalidated: boolean;
  lastWholeAt: number;
  now: number;
  whole: () => Promise<T[]>;
  since: (from: string, limit: number) => Promise<T[]>;
}): Promise<{ messages: T[]; whole: boolean }> {
  const from = pollFrom(held);
  if (!held || !from || readWhole({ held, invalidated, lastWholeAt, now })) {
    return { messages: await whole(), whole: true };
  }
  const newer = await since(from, POLL_LIMIT);
  // More than one poll can bring: there may be more still. Read it whole.
  if (newer.length >= POLL_LIMIT) return { messages: await whole(), whole: true };
  return { messages: mergeNewer(held, newer), whole: false };
}

/** The other member's messages unread in the thread held: what a mark sent now is for. */
export function unreadIds(
  messages: readonly Pick<MessageWithPost, "id" | "sender_id" | "read_at">[] | undefined,
  readerId: string,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const m of messages ?? []) if (m.sender_id !== readerId && !m.read_at) out.add(m.id);
  return out;
}

/**
 * The thread with the other member's unread messages marked read at `at`,
 * once the mark has landed: those in `marked`, the ones unread when the
 * mark was sent (`unreadIds`). A message a poll added while the mark was
 * on its way may have come in after the server marked the thread, and is
 * left unread here, so the thread asks for a mark of its own for it.
 */
export function markedRead<T extends Pick<MessageWithPost, "id" | "sender_id" | "read_at">>(
  messages: readonly T[],
  readerId: string,
  at: string,
  marked: ReadonlySet<string>,
): T[] {
  let changed = false;
  const out = messages.map((m) => {
    if (m.sender_id === readerId || m.read_at || !marked.has(m.id)) return m;
    changed = true;
    return { ...m, read_at: at };
  });
  return changed ? out : (messages as T[]);
}
