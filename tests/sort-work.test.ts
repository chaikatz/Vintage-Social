import { afterEach, describe, expect, it, vi } from "vitest";
import { byTimeDescending, sortByTaken, takenDate } from "@/utils/memories";
import { buildTimeline } from "@/utils/timeline";
import { editEras } from "@/utils/eraEdits";
import { groupByPlace } from "@/utils/placeGroups";

/** A grid of `n` in no particular order, some with no capture date and some taken at the same moment. */
function grid(n: number) {
  let seed = 11;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = Date.UTC(2015, 0, 1) + Math.floor(r() * 10 * 365) * 86_400_000;
    out.push({
      id: `p${i}`,
      taken_at: i % 9 === 0 ? null : new Date(i % 5 === 0 ? Date.UTC(2020, 5, 1) : t).toISOString(),
      created_at: new Date(t + 3_600_000).toISOString(),
      location: i % 3 === 0 ? "Lisbon" : null,
    });
  }
  return out;
}

/** How many Dates `run` makes. */
function datesMade(run: () => unknown): number {
  const RealDate = globalThis.Date;
  let made = 0;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) {
      made++;
      return Reflect.construct(target, args);
    },
  }) as DateConstructor;
  try {
    run();
  } finally {
    globalThis.Date = RealDate;
  }
  return made;
}

afterEach(() => {
  expect(globalThis.Date.name).toBe("Date");
});

describe("sorting by when the shutter fired", () => {
  it("orders exactly as before: newest capture first, those taken together in the order they came", () => {
    const posts = grid(500);
    const before = [...posts].sort((a, b) => takenDate(b).getTime() - takenDate(a).getTime());
    expect(sortByTaken(posts).map((p) => p.id)).toEqual(before.map((p) => p.id));
    // And leaves what it was given as it was.
    expect(posts[0].id).toBe("p0");
  });

  it("reads each photograph's date once, however long the grid", () => {
    const posts = grid(2000);
    // Reading two dates per comparison made some forty thousand here.
    expect(datesMade(() => sortByTaken(posts))).toBe(2000);
    expect(datesMade(() => buildTimeline(posts))).toBeLessThanOrEqual(2 * 2000);
  });

  it("keeps the eras' own order the same way", () => {
    const posts = grid(800);
    const eras = editEras(posts);
    for (const era of eras) {
      const times = era.posts.map((p) => takenDate(p).getTime());
      for (let i = 1; i < times.length; i++) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
    // Every era sorted with one read per photograph, not two per comparison:
    // about 4.5 a photograph in all here, where it was 5.3.
    expect(datesMade(() => editEras(posts))).toBeLessThan(5 * posts.length);
  });

  it("puts equal times in the order given", () => {
    const items = ["a", "b", "c", "d"];
    expect(byTimeDescending(items, (x) => (x === "c" ? 2 : 1))).toEqual(["c", "a", "b", "d"]);
  });
});

describe("the places view's order", () => {
  it("compares the server's timestamps as they are, not through the locale, and orders as before", () => {
    const posts = grid(600).map((p) => ({ ...p, location: ["Lisbon", "Paris", "Kyoto"][Number(p.id.slice(1)) % 3] }));
    const collate = vi.spyOn(String.prototype, "localeCompare");
    const groups = groupByPlace(posts, () => null);
    const onDates = collate.mock.contexts.filter((s) => /^\d{4}-\d\d-\d\dT/.test(String(s)));
    collate.mockRestore();
    // Every comparison of a sort used to collate two timestamps.
    expect(onDates).toHaveLength(0);
    for (const g of groups) {
      const when = g.posts.map((p) => p.taken_at ?? p.created_at);
      const before = [...when].sort((a, b) => b.localeCompare(a));
      expect(when).toEqual(before);
    }
  });
});
