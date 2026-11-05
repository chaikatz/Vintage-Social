import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
// The push function's own logic, which runs on Deno; it imports nothing.
import {
  chunk,
  eachChunk,
  memoryDays,
  pickMemories,
  sendToExpo,
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
    expect(result).toEqual({ sent: 250, failed: 0, dead: [] });
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
    expect(result).toEqual({ sent: 1, failed: 2, dead: ["gone"] });
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
    expect(result).toEqual({ sent: 100, failed: 100, dead: [] });
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
    expect(result).toEqual({ sent: 100, failed: 100, dead: [] });
  });

  it("never throws, whatever comes back", async () => {
    const result = await sendToExpo([note("a")], { fetch: async () => new Response("not json", { status: 200 }) });
    expect(result).toEqual({ sent: 0, failed: 1, dead: [] });
    const offline = await sendToExpo([note("a")], { fetch: async () => { throw new Error("offline"); } });
    expect(offline).toEqual({ sent: 0, failed: 1, dead: [] });
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

  it("reads a photograph's followers a page at a time, up to a bound", () => {
    expect(source).toMatch(/\.order\("follower_id", \{ ascending: true \}\)\s*\.range\(from, from \+ ROWS_PER_READ - 1\)/);
    expect(source).toMatch(/from < MAX_FOLLOWERS_TOLD/);
  });

  it("asks whether a like was just pushed without counting them all", () => {
    expect(source).not.toMatch(/count: "exact"/);
    expect(source).toMatch(/\.gte\("pushed_at", since\)\s*\.limit\(1\)/);
  });

  it("reads On This Day by day windows, never every dated photograph", () => {
    expect(source).not.toMatch(/limit\(5000\)/);
    expect(source).toMatch(/memoryDays\(today, /);
    expect(source).toMatch(/\.gte\("taken_at", d\.start\)\s*\.lt\("taken_at", d\.end\)/);
    expect(source).toMatch(/pickMemories\(found\.flat\(\), today\)/);
  });
});
