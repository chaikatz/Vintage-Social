import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  POLL_LIMIT,
  POLL_OVERLAP_MS,
  THREAD_KEEP,
  WHOLE_READ_EVERY_MS,
  markedRead,
  mergeNewer,
  pollFrom,
  readThread,
  readWhole,
} from "@/utils/threadPoll";
import { newestUnreadFrom } from "@/utils/messageText";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

interface Msg {
  id: string;
  created_at: string;
  sender_id: string;
  read_at: string | null;
}

const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();
const msg = (id: string, ms: number, sender_id = "them", read_at: string | null = null): Msg => ({
  id,
  created_at: at(ms),
  sender_id,
  read_at,
});

/**
 * The server's side of one thread, answering the two reads as the API
 * does (src/api/messages.ts): the newest THREAD_KEEP oldest first, or
 * those from a time on, oldest first, at most `limit`. Counts the rows it
 * sends, which the phone then parses.
 */
function server(initial: Msg[]) {
  const rows = [...initial];
  let sent = 0;
  let requests = 0;
  const sorted = () => [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return {
    rows,
    add: (m: Msg) => rows.push(m),
    whole: async () => {
      requests++;
      const out = sorted().slice(-THREAD_KEEP);
      sent += out.length;
      return out.map((m) => ({ ...m }));
    },
    since: async (from: string, limit: number) => {
      requests++;
      const out = sorted()
        .filter((m) => Date.parse(m.created_at) >= Date.parse(from))
        .slice(0, limit);
      sent += out.length;
      return out.map((m) => ({ ...m }));
    },
    get sent() {
      return sent;
    },
    get requests() {
      return requests;
    },
  };
}

describe("an open thread, read again every five seconds", () => {
  it("is read whole as it opens, when told it changed, and every few minutes; otherwise only what is new", () => {
    const held = [msg("a", 0)];
    expect(readWhole({ held: undefined, invalidated: false, lastWholeAt: 0, now: T0 })).toBe(true);
    expect(readWhole({ held: [], invalidated: false, lastWholeAt: T0, now: T0 })).toBe(true);
    // Opened: this screen has not read it whole yet.
    expect(readWhole({ held, invalidated: false, lastWholeAt: 0, now: T0 })).toBe(true);
    expect(readWhole({ held, invalidated: false, lastWholeAt: T0, now: T0 + 5_000 })).toBe(false);
    expect(readWhole({ held, invalidated: true, lastWholeAt: T0, now: T0 + 5_000 })).toBe(true);
    expect(readWhole({ held, invalidated: false, lastWholeAt: T0, now: T0 + WHOLE_READ_EVERY_MS })).toBe(true);
  });

  it("asks from a little before the newest message held, for an insert that lands late", () => {
    expect(pollFrom(undefined)).toBeNull();
    expect(pollFrom([])).toBeNull();
    expect(pollFrom([msg("a", 0), msg("b", 90_000)])).toBe(at(90_000 - POLL_OVERLAP_MS));
    // Postgres's own form of the time reads the same.
    expect(pollFrom([{ id: "x", created_at: "2026-11-01 12:01:30.123456+00" }])).toBe(at(90_123 - POLL_OVERLAP_MS));
  });

  it("adds what is new once each, in order, a newer copy in place of the old, and keeps only the newest", () => {
    const held = [msg("a", 0), msg("b", 1_000)];
    expect(mergeNewer(held, [])).toBe(held);
    // The overlap brings b again, now read; c is new; a late insert lands between.
    const merged = mergeNewer(held, [msg("b", 1_000, "them", at(2_000)), msg("late", 500), msg("c", 3_000)]);
    expect(merged.map((m) => m.id)).toEqual(["a", "late", "b", "c"]);
    expect(merged.find((m) => m.id === "b")?.read_at).toBe(at(2_000));
    const many = Array.from({ length: 5 }, (_, i) => msg(`m${i}`, i * 1_000));
    expect(mergeNewer(many.slice(0, 3), many.slice(3), 4).map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("finds a reply that arrived, and reads the thread whole when a poll finds more than it can bring", async () => {
    const s = server([msg("a", 0), msg("b", 1_000)]);
    const opened = await readThread({ held: undefined, invalidated: false, lastWholeAt: 0, now: T0, whole: s.whole, since: s.since });
    expect(opened.whole).toBe(true);
    s.add(msg("c", 6_000));
    const polled = await readThread({ held: opened.messages, invalidated: false, lastWholeAt: T0, now: T0 + 5_000, whole: s.whole, since: s.since });
    expect(polled.whole).toBe(false);
    expect(polled.messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
    // Back from a long while away with a flood of messages: too many for one poll.
    for (let i = 0; i < POLL_LIMIT + 5; i++) s.add(msg(`f${i}`, 10_000 + i));
    const flooded = await readThread({ held: polled.messages, invalidated: false, lastWholeAt: T0, now: T0 + 10_000, whole: s.whole, since: s.since });
    expect(flooded.whole).toBe(true);
    expect(flooded.messages).toHaveLength(3 + POLL_LIMIT + 5);
  });

  it("keeps the read marks right: a thread marked read asks for no second mark, and a new message asks for one", () => {
    const thread = [msg("a", 0), msg("mine", 500, "me"), msg("b", 1_000)];
    expect(newestUnreadFrom(thread, "me")).toBe("b");
    const marked = markedRead(thread, "me", at(2_000));
    expect(newestUnreadFrom(marked, "me")).toBeNull();
    // My own message is not mine to mark.
    expect(marked.find((m) => m.id === "mine")?.read_at).toBeNull();
    expect(markedRead(marked, "me", at(3_000))).toBe(marked);
    // A poll adds a new message of theirs: it is the one to mark next.
    expect(newestUnreadFrom(mergeNewer(marked, [msg("c", 4_000)]), "me")).toBe("c");
  });

  it("costs a few rows a poll instead of the whole thread (measured)", async () => {
    // A long conversation, a message every twenty seconds, open for five
    // minutes with a reply every thirty.
    const history = Array.from({ length: 1500 }, (_, i) => msg(`h${i}`, -30_000_000 + i * 20_000, i % 2 ? "me" : "them", at(0)));
    const polls = (5 * 60_000) / 5_000;

    const before = server(history);
    for (let p = 0; p < polls; p++) {
      if (p > 0 && p % 6 === 0) before.add(msg(`r${p}`, p * 5_000 - 1));
      await before.whole();
    }

    const after = server(history);
    let held: Msg[] | undefined;
    let lastWholeAt = 0;
    for (let p = 0; p < polls; p++) {
      if (p > 0 && p % 6 === 0) after.add(msg(`r${p}`, p * 5_000 - 1));
      const now = T0 + p * 5_000;
      const r = await readThread({ held, invalidated: false, lastWholeAt, now, whole: after.whole, since: after.since });
      if (r.whole) lastWholeAt = now;
      held = r.messages;
    }
    // The same thread at the end either way.
    expect(held?.map((m) => m.id)).toEqual((await before.whole()).map((m) => m.id));
    console.info("five minutes in an open thread of 1,500 messages, rows sent:", {
      before: before.sent - THREAD_KEEP,
      after: after.sent,
      requests: { before: polls, after: after.requests },
    });
    // Before: the newest thousand, sixty times. After: a whole read as it
    // opens, then each poll the newest message or two again (the overlap)
    // and the reply when there is one.
    expect(before.sent - THREAD_KEEP).toBe(polls * THREAD_KEEP);
    expect(after.sent).toBeLessThan(THREAD_KEEP + polls * 2);
    expect(after.requests).toBe(polls);
  });
});

describe("the thread screen", () => {
  const thread = read("app/messages/[id].tsx");

  it("polls through readThread, whole when react-query says the thread changed", () => {
    expect(thread).toMatch(/const read = await readThread\(\{/);
    expect(thread).toMatch(/invalidated: queryClient\.getQueryState\(key\)\?\.isInvalidated \?\? false,/);
    expect(thread).toMatch(/whole: \(\) => fetchMessages\(id \?\? ""\),/);
    expect(thread).toMatch(/since: \(from, limit\) => fetchMessagesSince\(id \?\? "", from, limit\),/);
    expect(thread).toMatch(/if \(read\.whole\) lastWholeAt\.current = Date\.now\(\);/);
    expect(thread).toMatch(/refetchInterval: focused \? 5000 : false,/);
  });

  it("reads what is new after a send, not the whole thread", () => {
    expect(thread).toMatch(/void queryClient\.refetchQueries\(\{ queryKey: \["messages", id\] \}\);/);
    expect(thread).not.toMatch(/invalidateQueries\(\{ queryKey: \["messages", id\] \}\)/);
  });

  it("marks the thread held read once the mark has landed", () => {
    expect(thread).toMatch(
      /markConversationRead\(id, userId\)\s*\.then\(\(\) => \{[\s\S]*?queryClient\.setQueryData<MessageWithPost\[\]>\(\["messages", id\], \(held\) => \(held \? markedRead\(held, userId, at\) : held\)\);/,
    );
  });

  it("asks the server for a poll along the thread's own index, oldest first and bounded", () => {
    const api = read("src/api/messages.ts");
    expect(api).toMatch(
      /\.eq\("conversation_id", conversationId\)\s*\.gte\("created_at", from\)\s*\.order\("created_at", \{ ascending: true \}\)\s*\.order\("id", \{ ascending: true \}\)\s*\.limit\(limit\);/,
    );
  });
});
