import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" }, Linking: { openSettings: async () => undefined } }));
vi.mock("expo-media-library", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
// The bundled photographs are images Metro resolves; here only their names matter.
vi.mock("@/demo/photoAssets", () => ({
  PHOTOS: new Proxy({}, { has: (_t, key) => typeof key === "string" && !key.startsWith("http"), get: () => 1 }),
}));

import { demoSourceAt } from "@/darkroom/demoSource";
import { inBackground } from "@/darkroom/discovery";
import type { LibrarySource, Page, PageRequest, Print, TimeRange } from "@/darkroom/types";
import { dayDoorFace, dayRange, DOOR_COVERS, DOOR_YEARS, readDayDoor } from "@/post/dayDoor";

/**
 * The Post tab's On this day door: how many photographs of today's date
 * in earlier years the library holds, which years, and three to fan on
 * the door — read in bounded questions, two at a time, stopped when the
 * tab is left — and the face the door shows, which never reads a failure
 * as none.
 */

const NOW = new Date(2026, 10, 25, 10, 0);

describe("reading the door", () => {
  it("finds the demo library's six anniversaries, from fourteen years ago to last year, and three of them to fan", async () => {
    const read = await readDayDoor(demoSourceAt(NOW.getTime()), NOW);
    expect(read.total).toBe(6);
    expect(read.firstYear).toBe(NOW.getFullYear() - 14);
    expect(read.lastYear).toBe(NOW.getFullYear() - 1);
    expect(read.covers).toHaveLength(DOOR_COVERS);
    // The newest years', newest first.
    expect(read.covers.map((p) => new Date(p.takenAt).getFullYear())).toEqual([2025, 2023, 2021]);
    for (const p of read.covers) {
      expect(new Date(p.takenAt).getMonth()).toBe(NOW.getMonth());
      expect(new Date(p.takenAt).getDate()).toBe(NOW.getDate());
    }
  });

  it("reads the 29th of February as the 28th in a common year", () => {
    const leap = dayRange(2025, 1, 29);
    expect(new Date(leap.from)).toEqual(new Date(2025, 1, 28));
    expect(new Date(leap.to)).toEqual(new Date(2025, 2, 1));
    const day = dayRange(2024, 1, 29);
    expect(new Date(day.from)).toEqual(new Date(2024, 1, 29));
  });

  it("finds the demo's anniversaries on the 29th of February too", async () => {
    const leap = new Date(2028, 1, 29, 10);
    const read = await readDayDoor(demoSourceAt(leap.getTime()), leap);
    expect(read.total).toBe(6);
  });

  /** A library that writes down how many questions are out at once, and how many were asked. */
  function counting(opts: { oldest: number; perYear: (year: number) => number; failAt?: number }) {
    const log = { asked: 0, inFlight: 0, most: 0, kinds: [] as string[] };
    const settle = <T,>(value: T) =>
      new Promise<T>((resolve, reject) => {
        log.asked += 1;
        log.inFlight += 1;
        log.most = Math.max(log.most, log.inFlight);
        const n = log.asked;
        setTimeout(() => {
          log.inFlight -= 1;
          if (opts.failAt === n) reject(new Error("Photos would not answer."));
          else resolve(value);
        }, 1);
      });
    const source: LibrarySource = {
      count: (range: TimeRange) => {
        log.kinds.push("count");
        return settle(opts.perYear(new Date(range.from).getFullYear()));
      },
      page: (req: PageRequest) => {
        log.kinds.push("page");
        const year = new Date(req.range.from).getFullYear();
        const prints: Print[] = Array.from({ length: Math.min(req.first, opts.perYear(year)) }, (_, i) => ({
          id: `${year}-${i}`,
          uri: `ph://${year}-${i}`,
          width: 3,
          height: 2,
          takenAt: req.range.from + i,
          subtypes: i === 0 ? ["screenshot"] : [],
        }));
        return settle<Page>({ prints, hasNextPage: false });
      },
      oldest: () => {
        log.kinds.push("oldest");
        return settle(opts.oldest);
      },
    };
    return { source, log };
  }

  it("asks at most once, thirty times and three times more, never more than two at once", async () => {
    const { source, log } = counting({ oldest: new Date(1950, 0, 1).getTime(), perYear: (y) => (y % 2 === 0 ? 2 : 0) });
    const read = await readDayDoor(inBackground(source), NOW);
    expect(log.kinds.filter((k) => k === "oldest")).toHaveLength(1);
    expect(log.kinds.filter((k) => k === "count")).toHaveLength(DOOR_YEARS);
    expect(log.kinds.filter((k) => k === "page")).toHaveLength(DOOR_COVERS);
    expect(log.asked).toBeLessThanOrEqual(1 + 30 + 3);
    expect(log.most).toBeLessThanOrEqual(2);
    // Thirty years back from last year, the even ones.
    expect(read.total).toBe(2 * 15);
    expect(read.lastYear).toBe(2024);
    expect(read.firstYear).toBe(1996);
    // A cover is the first that is not a screenshot.
    expect(read.covers.map((p) => p.id)).toEqual(["2024-1", "2022-1", "2020-1"]);
  });

  it("looks back only as far as the oldest photograph", async () => {
    const { source, log } = counting({ oldest: new Date(2022, 5, 1).getTime(), perYear: () => 1 });
    const read = await readDayDoor(source, NOW);
    expect(log.kinds.filter((k) => k === "count")).toHaveLength(4);
    expect(read).toMatchObject({ total: 4, firstYear: 2022, lastYear: 2025 });
  });

  it("reads an empty library as none, without asking for a single count", async () => {
    const { source, log } = counting({ oldest: null as unknown as number, perYear: () => 0 });
    expect(await readDayDoor(source, NOW)).toEqual({ total: 0, firstYear: null, lastYear: null, covers: [] });
    expect(log.asked).toBe(1);
  });

  it("stops asking when the tab is left, and says so rather than answering none", async () => {
    const { source, log } = counting({ oldest: new Date(1950, 0, 1).getTime(), perYear: () => 1 });
    const stop = new AbortController();
    const reading = readDayDoor(source, NOW, stop.signal);
    await new Promise((r) => setTimeout(r, 4));
    stop.abort();
    await expect(reading).rejects.toThrow();
    const asked = log.asked;
    await new Promise((r) => setTimeout(r, 20));
    expect(log.asked).toBe(asked);
    expect(asked).toBeLessThan(1 + 30);
  });

  it("fails as a whole when Photos fails, and stops asking", async () => {
    const { source, log } = counting({ oldest: new Date(1950, 0, 1).getTime(), perYear: () => 1, failAt: 4 });
    await expect(readDayDoor(source, NOW)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(log.asked).toBeLessThan(8);
  });
});

describe("the door's face", () => {
  const today = new Date(2026, 10, 25);
  const memory = { id: "m1", headline: "3 years ago today, you were in Lisbon.", source: "https://cdn.test/t.jpg", filter: null };
  const cover = (year: number): Print => ({ id: `c${year}`, uri: `ph://${year}`, width: 3, height: 2, takenAt: new Date(year, 10, 25).getTime(), subtypes: [] });

  it("is the library's count and its years when it has any, the photographs fanned oldest first", () => {
    const face = dayDoorFace({ library: { total: 6, firstYear: 2012, lastYear: 2025, covers: [cover(2025), cover(2023), cover(2021)] }, memory, today });
    expect(face).toMatchObject({ kind: "fan", line: "6 photographs", sub: "2012 – 2025", spoken: "On this day. 6 photographs, 2012 to 2025." });
    expect(face.covers.map((c) => c.id)).toEqual(["c2021", "c2023", "c2025"]);
  });

  it("says one photograph and one year as one", () => {
    const face = dayDoorFace({ library: { total: 1, firstYear: 2019, lastYear: 2019, covers: [cover(2019)] }, memory: null, today });
    expect(face).toMatchObject({ kind: "fan", line: "1 photograph", sub: "2019", spoken: "On this day. 1 photograph, 2019." });
  });

  it("counts in thousands as the room does", () => {
    const face = dayDoorFace({ library: { total: 1204, firstYear: 2001, lastYear: 2025, covers: [] }, memory: null, today });
    expect(face.line).toBe("1,204 photographs");
  });

  it("is the member's own post from this date when the library has none to count", () => {
    for (const library of [null, "failed" as const, { total: 0, firstYear: null, lastYear: null, covers: [] }]) {
      const face = dayDoorFace({ library, memory, today });
      expect(face).toMatchObject({ kind: "post", line: memory.headline, sub: null, spoken: `On this day. ${memory.headline}` });
    }
  });

  it("is the leaf of a calendar otherwise: while it reads, where it may not read, and when the reading failed", () => {
    for (const library of [null, "failed" as const, { total: 0, firstYear: null, lastYear: null, covers: [] }]) {
      const face = dayDoorFace({ library, memory: null, today });
      expect(face).toMatchObject({ kind: "leaf", line: "Every year, on this date.", sub: null, leafMonth: "NOV", leafDay: 25 });
      expect(face.spoken).toBe("On this day. Every year, on this date.");
      // A failure never reads as none.
      expect(face.line).not.toMatch(/0 photographs/);
    }
  });
});
