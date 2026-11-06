import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
// The push function's own logic, which runs on Deno; it imports nothing.
import {
  checkReceipts,
  chunk,
  eachChunk,
  eachPageByKey,
  goneTokens,
  memoryDays,
  pickMemories,
  sendToExpo,
  withDeadline,
  type Message,
  type MemoryPost,
} from "../supabase/functions/push/logic";

/**
 * The push edge function, as the club grows: notices go to Expo a hundred
 * a request and never wait forever on it, devices Expo says are gone are
 * forgotten, every list of ids is read in pieces a URL can carry, a new
 * photograph's followers are read a page at a time, and On This Day reads
 * today's date in each earlier year rather than every dated photograph in
 * the club. The function is not deployed from here; these test the code
 * the owner deploys.
 */

const note = (to: string): Message => ({ to, body: "x", data: {}, sound: null });

describe("sending to Expo", () => {
  it("a hundred notices a request, the rest in further requests", async () => {
    const bodies: number[] = [];
    const result = await sendToExpo(Array.from({ length: 250 }, (_, i) => note(`t${i}`)), {
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init.body)) as Message[];
        bodies.push(body.length);
        return new Response(JSON.stringify({ data: body.map(() => ({ status: "ok" })) }), { status: 200 });
      },
    });
    expect(bodies.sort((a, b) => b - a)).toEqual([100, 100, 50]);
    expect(result).toEqual({ sent: 250, failed: 0, dead: [], tickets: [] });
  });

  it("names the devices that are gone, and only those", async () => {
    const result = await sendToExpo([note("alive"), note("gone"), note("busy")], {
      fetch: async () =>
        new Response(JSON.stringify({ data: [
          { status: "ok" },
          { status: "error", details: { error: "DeviceNotRegistered" } },
          { status: "error", details: { error: "MessageRateExceeded" } },
        ] }), { status: 200 }),
    });
    expect(result).toEqual({ sent: 1, failed: 2, dead: ["gone"], tickets: [] });
  });

  it("gives up on a request that hangs, and still sends the rest", async () => {
    let call = 0;
    const result = await sendToExpo(Array.from({ length: 200 }, (_, i) => note(`t${i}`)), {
      timeoutMs: 20,
      atOnce: 1,
      fetch: (_url, init) => {
        call++;
        if (call === 1) {
          // Never answers; only the deadline ends it.
          return new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          });
        }
        const body = JSON.parse(String(init.body)) as Message[];
        return Promise.resolve(new Response(JSON.stringify({ data: body.map(() => ({ status: "ok" })) }), { status: 200 }));
      },
    });
    expect(result).toEqual({ sent: 100, failed: 100, dead: [], tickets: [] });
  });

  it("tries once more when Expo is too busy, and counts it failed if it still is", async () => {
    const statuses = [503, 200, 429, 429];
    let call = 0;
    const result = await sendToExpo(Array.from({ length: 200 }, (_, i) => note(`t${i}`)), {
      atOnce: 1,
      retryAfterMs: 1,
      fetch: async (_url, init) => {
        const status = statuses[call++];
        const body = JSON.parse(String(init.body)) as Message[];
        return new Response(JSON.stringify({ data: body.map(() => ({ status: "ok" })) }), { status });
      },
    });
    expect(call).toBe(4);
    expect(result).toEqual({ sent: 100, failed: 100, dead: [], tickets: [] });
  });

  it("never throws, whatever comes back", async () => {
    const result = await sendToExpo([note("a")], { fetch: async () => new Response("not json", { status: 200 }) });
    expect(result).toEqual({ sent: 0, failed: 1, dead: [], tickets: [] });
    const offline = await sendToExpo([note("a")], { fetch: async () => { throw new Error("offline"); } });
    expect(offline).toEqual({ sent: 0, failed: 1, dead: [], tickets: [] });
  });
});

describe("receipts: which devices turned out to be gone", () => {
  it("keeps the ticket of every notice Expo took, with the token it was for", async () => {
    const result = await sendToExpo([note("alive"), note("gone"), note("later")], {
      fetch: async () =>
        new Response(JSON.stringify({ data: [
          { status: "ok", id: "ticket-1" },
          { status: "error", details: { error: "DeviceNotRegistered" } },
          { status: "ok", id: "ticket-3" },
        ] }), { status: 200 }),
    });
    expect(result.tickets).toEqual([{ id: "ticket-1", token: "alive" }, { id: "ticket-3", token: "later" }]);
    expect(result.dead).toEqual(["gone"]);
  });

  it("asks for receipts three hundred at a time and names the tickets whose device is gone", async () => {
    const asked: number[] = [];
    const ids = Array.from({ length: 700 }, (_, i) => `t${i}`);
    const result = await checkReceipts(ids, {
      fetch: async (url, init) => {
        expect(url).toBe("https://exp.host/--/api/v2/push/getReceipts");
        const body = JSON.parse(String(init.body)) as { ids: string[] };
        asked.push(body.ids.length);
        const data: Record<string, unknown> = {};
        for (const id of body.ids) {
          const n = Number(id.slice(1));
          // Expo has no receipt yet for some; a few devices are gone; one other error.
          if (n % 10 === 9) continue;
          data[id] = n % 50 === 0
            ? { status: "error", details: { error: "DeviceNotRegistered" } }
            : n === 7 ? { status: "error", details: { error: "MessageRateExceeded" } } : { status: "ok" };
        }
        return new Response(JSON.stringify({ data }), { status: 200 });
      },
    });
    expect(asked.sort((a, b) => b - a)).toEqual([300, 300, 100]);
    expect(result.dead.sort()).toEqual(ids.filter((_, n) => n % 50 === 0).sort());
    expect(result.answered.length).toBe(700 - 70);
  });

  it("never throws, and a receipt it could not read keeps its token", async () => {
    expect(await checkReceipts(["a"], { fetch: async () => { throw new Error("offline"); } })).toEqual({ answered: [], dead: [] });
    expect(await checkReceipts(["a"], { fetch: async () => new Response("<html>", { status: 200 }) })).toEqual({ answered: [], dead: [] });
    expect(await checkReceipts(["a"], { fetch: async () => new Response("busy", { status: 503 }) })).toEqual({ answered: [], dead: [] });
    const hung = await checkReceipts(["a"], {
      timeoutMs: 20,
      fetch: (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    });
    expect(hung).toEqual({ answered: [], dead: [] });
  });

  it("names each gone token with when its last undeliverable notice was sent, for a row not filed again since", () => {
    const tickets = [
      { id: "a1", token: "A", created_at: "2026-11-05T09:00:00.5+00:00" },
      { id: "a2", token: "A", created_at: "2026-11-05T21:30:00.123456+00:00" },
      { id: "a3", token: "A", created_at: "2026-11-05T12:00:00+00:00" },
      { id: "b1", token: "B", created_at: "2026-11-05T10:00:00+00:00" },
      { id: "c1", token: "C", created_at: "2026-11-05T11:00:00+00:00" },
    ];
    // C's notice reached its device; A's three and B's one did not.
    const gone = goneTokens(tickets, ["a3", "a1", "b1", "a2", "unknown"]);
    expect([...gone]).toEqual([
      ["A", "2026-11-05T21:30:00.123456+00:00"],
      ["B", "2026-11-05T10:00:00+00:00"],
    ]);
    expect(goneTokens(tickets, []).size).toBe(0);
  });
});

describe("the database, with a deadline", () => {
  const hangs = (_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));

  it("gives up on a request that hangs", async () => {
    const started = Date.now();
    await expect(withDeadline(hangs, 20)("https://db.example/rest/v1/follows")).rejects.toThrow("aborted");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("lets one that answers in time through, and still honours the caller's own signal", async () => {
    const ok = await withDeadline(async () => new Response("[]", { status: 200 }), 1000)("https://db.example/x", {});
    expect(await ok.text()).toBe("[]");
    const caller = new AbortController();
    const pending = withDeadline(hangs, 60_000)("https://db.example/x", { signal: caller.signal });
    caller.abort();
    await expect(pending).rejects.toThrow("aborted");
  });

  it("is what the function's database client fetches with", () => {
    const source = readFileSync(path.join(import.meta.dirname, "..", "supabase", "functions", "push", "index.ts"), "utf8");
    expect(source).toMatch(/global: \{ fetch: withDeadline\(\(url, init\) => fetch\(url, init\), DB_TIMEOUT_MS\) \}/);
  });
});

describe("long lists, by key", () => {
  // 2,350 followers, read the way PostgREST would answer "the next n after k".
  const all = Array.from({ length: 2350 }, (_, i) => `f${String(i).padStart(5, "0")}`);
  const reader = (asked: { after: string | null; size: number }[]) => async (after: string | null, size: number) => {
    asked.push({ after, size });
    return all.filter((k) => after === null || k > after).slice(0, size);
  };

  it("reads every key once, in pages that start after the last key, never by offset", async () => {
    const asked: { after: string | null; size: number }[] = [];
    const seen: string[] = [];
    const out = await eachPageByKey(reader(asked), async (keys) => void seen.push(...keys), { size: 1000, max: 50_000 });
    expect(seen).toEqual(all);
    expect(asked).toEqual([
      { after: null, size: 1000 },
      { after: all[999], size: 1000 },
      { after: all[1999], size: 1000 },
    ]);
    expect(out).toEqual({ read: 2350, complete: true });
  });

  it("stops at the bound, and says the list may go on", async () => {
    const seen: string[] = [];
    const out = await eachPageByKey(reader([]), async (keys) => void seen.push(...keys), { size: 1000, max: 1500 });
    expect(seen).toEqual(all.slice(0, 1500));
    expect(out).toEqual({ read: 1500, complete: false });
  });

  it("stops at a page that could not be read", async () => {
    let call = 0;
    const out = await eachPageByKey(
      async (after: string | null, size: number) => (++call === 2 ? null : all.filter((k) => after === null || k > after).slice(0, size)),
      async () => undefined,
      { size: 1000, max: 50_000 },
    );
    expect(out).toEqual({ read: 1000, complete: false });
  });

  it("hands an exact multiple of the page over without an empty page", async () => {
    const pages: number[] = [];
    await eachPageByKey(async (after: string | null, size: number) => all.slice(0, 2000).filter((k) => after === null || k > after).slice(0, size),
      async (keys) => void pages.push(keys.length), { size: 1000, max: 50_000 });
    expect(pages).toEqual([1000, 1000]);
  });
});

describe("lists of ids, in pieces", () => {
  it("chunks without repeats and works a few at a time, in order", async () => {
    expect(chunk(["a", "b", "a", "c"], 2)).toEqual([["a", "b"], ["c"]]);
    let open = 0;
    let most = 0;
    const out = await eachChunk(chunk(Array.from({ length: 1000 }, (_, i) => i), 100), 4, async (c) => {
      open++;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 1));
      open--;
      return c.length;
    });
    expect(out).toEqual(Array(10).fill(100));
    expect(most).toBe(4);
  });
});

describe("On This Day", () => {
  it("asks for today's date in every earlier year, newest first", () => {
    const days = memoryDays(new Date("2026-11-05T15:00:00Z"), 2021);
    expect(days.map((d) => d.year)).toEqual([2025, 2024, 2023, 2022, 2021]);
    expect(days[0]).toEqual({ year: 2025, start: "2025-11-05T00:00:00.000Z", end: "2025-11-06T00:00:00.000Z" });
  });

  it("asks for 29 February only in leap years, as the old comparison found it", () => {
    const days = memoryDays(new Date("2028-02-29T15:00:00Z"), 2015);
    expect(days.map((d) => d.year)).toEqual([2024, 2020, 2016]);
  });

  it("never asks about this year, nor further back than two centuries", () => {
    expect(memoryDays(new Date("2026-11-05T15:00:00Z"), 2026)).toEqual([]);
    expect(memoryDays(new Date("2026-11-05T15:00:00Z"), 1).length).toBe(200);
  });

  it("picks, per member, the photograph furthest back: the same choice the old reading made", () => {
    const today = new Date("2026-11-05T15:00:00Z");
    // Many dated photographs over many years, in no order.
    const rows: MemoryPost[] = [];
    let seed = 7;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let i = 0; i < 5000; i++) {
      const year = 2000 + Math.floor(rand() * 27);
      const onTheDay = rand() < 0.2;
      const date = onTheDay ? new Date(Date.UTC(year, 10, 5, Math.floor(rand() * 24))) : new Date(Date.UTC(year, Math.floor(rand() * 12), 1 + Math.floor(rand() * 28)));
      rows.push({ id: `p${i}`, author_id: `m${i % 60}`, taken_at: date.toISOString(), location: rand() < 0.5 ? " Lisbon " : null });
    }
    // The old reading: every row, filtered to today's month and day.
    const old = new Map<string, { id: string; yearsAgo: number; place: string | null }>();
    for (const p of rows) {
      const d = new Date(p.taken_at);
      if (d.getUTCMonth() + 1 !== 11 || d.getUTCDate() !== 5) continue;
      const yearsAgo = 2026 - d.getUTCFullYear();
      if (yearsAgo < 1) continue;
      const prev = old.get(p.author_id);
      if (!prev || yearsAgo > prev.yearsAgo) old.set(p.author_id, { id: p.id, yearsAgo, place: p.location?.trim() || null });
    }
    // The new reading only ever sees the rows inside the day windows.
    const windows = memoryDays(today, 2000);
    const inWindows = rows.filter((p) => windows.some((w) => p.taken_at >= w.start && p.taken_at < w.end));
    expect(pickMemories(inWindows, today)).toEqual(old);
    expect(old.size).toBeGreaterThan(30);
  });
});

describe("the function, read from its source", () => {
  const source = readFileSync(path.join(import.meta.dirname, "..", "supabase", "functions", "push", "index.ts"), "utf8")
    .replace(/\/\/.*$/gm, "");

  it("sends through the tested helper and forgets dead devices", () => {
    expect(source).toMatch(/sendToExpo\(messages, \{ fetch: /);
    expect(source).toMatch(/for \(const tokens of chunk\(dead, IDS_PER_READ\)\) \{\s*await admin\.from\("push_tokens"\)\.delete\(\)\.in\("token", tokens\);/);
    expect(source).not.toMatch(/invalid_at: new Date/);
  });

  it("reads preferences and tokens a hundred members at a time", () => {
    expect(source.match(/chunk\(userIds, IDS_PER_READ\)/g)?.length).toBe(2);
    expect(source).not.toMatch(/\.in\("user_id", userIds\)/);
  });

  it("reads a photograph's followers a page at a time, by key, up to a bound", () => {
    const post = source.slice(source.indexOf("async function handlePost"), source.indexOf("async function handleMemories"));
    expect(post).toMatch(/eachPageByKey<string>\(/);
    expect(post).toMatch(/if \(after !== null\) query = query\.gt\("follower_id", after\);/);
    expect(post).toMatch(/query\.order\("follower_id", \{ ascending: true \}\)\.limit\(size\)/);
    expect(post).toMatch(/\{ size: ROWS_PER_READ, max: MAX_FOLLOWERS_TOLD \}/);
    // No offsets: an offset page re-reads and sorts every follower before it.
    expect(post).not.toMatch(/\.range\(/);
  });

  it("asks whether a like was just pushed without counting them all, or reading every Activity row", () => {
    expect(source).not.toMatch(/count: "exact"/);
    expect(source).toMatch(/\.eq\("recipient_id", recipient\)\s*\.gte\("created_at", madeSince\)/);
    expect(source).toMatch(/\.gte\("pushed_at", since\)\s*\.limit\(1\)/);
  });

  it("keeps each ticket, and once a day reads the receipts and forgets the devices that are gone", () => {
    expect(source).toMatch(/await admin\.from\("push_tickets"\)\.insert\(tickets\.slice\(i, i \+ TICKETS_PER_WRITE\)\)/);
    const daily = source.slice(source.indexOf("async function handleMemories"), source.indexOf("async function sendMemories"));
    expect(daily).toMatch(/await sendMemories\(today\)/);
    expect(daily).toMatch(/await settleReceipts\(\)\.catch\(/);
    const settle = source.slice(source.indexOf("async function settleReceipts"), source.indexOf("async function send("));
    expect(settle).toMatch(/checkReceipts\(tickets\.map\(\(t\) => t\.id\)/);
    // A gone device's row goes only if it was not filed again after the
    // notice: a stale receipt never takes the row a new member on the
    // phone has just claimed (0036).
    expect(settle).toMatch(/\.select\("id, token, created_at"\)/);
    expect(settle).toMatch(/goneTokens\(tickets, dead\)/);
    expect(settle).toMatch(/\.from\("push_tokens"\)\s*\.delete\(\)\s*\.eq\("token", token\)\s*\.lt\("updated_at", sentAt\)/);
    expect(settle).not.toMatch(/\.from\("push_tokens"\)\.delete\(\)\.in\("token"/);
    expect(settle).toMatch(/await admin\.from\("push_tickets"\)\.delete\(\)\.lt\("created_at", before\)/);
    expect(settle).toMatch(/\{ size: ROWS_PER_READ, max: MAX_RECEIPTS_A_RUN \}/);
  });

  it("reads On This Day by day windows, never every dated photograph", () => {
    expect(source).not.toMatch(/limit\(5000\)/);
    expect(source).toMatch(/memoryDays\(today, /);
    expect(source).toMatch(/\.gte\("taken_at", d\.start\)\s*\.lt\("taken_at", d\.end\)/);
    expect(source).toMatch(/pickMemories\(found\.flat\(\), today\)/);
  });
});
