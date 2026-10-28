import { describe, expect, it } from "vitest";
import {
  eraOf,
  eraSummary,
  groupEras,
  memoryHeadline,
  memoryLabel,
  onThisDay,
  sameNightWindow,
  sortByTaken,
} from "@/utils/memories";

const post = (id: string, taken: string | null, location: string | null = null, created = "2026-09-01T12:00:00") => ({
  id,
  taken_at: taken,
  created_at: created,
  location,
});

describe("on this day", () => {
  const today = new Date(2026, 7, 14, 10, 0, 0); // 14 August 2026

  it("finds the member's own photographs from this calendar day in earlier years", () => {
    const posts = [
      post("a", "2019-08-14T18:32:10", "Los Angeles"),
      post("b", "2024-08-14T09:00:00", null),
      post("c", "2026-08-14T09:00:00", "Today"), // this year — not a memory
      post("d", "2019-08-15T00:00:00", "Off by one"),
      post("e", null, "No capture date"),
    ];
    const memories = onThisDay(posts, today);
    expect(memories.map((m) => m.post.id)).toEqual(["b", "a"]);
    expect(memories[1]).toMatchObject({ yearsAgo: 7, place: "Los Angeles" });
    expect(memories[0]).toMatchObject({ yearsAgo: 2, place: null });
  });

  it("ignores the posting date entirely", () => {
    // Posted on this day last year, but taken in March: not a memory.
    expect(onThisDay([post("x", "2025-03-01T12:00:00", null, "2025-08-14T12:00:00")], today)).toEqual([]);
  });

  it("reads like the notification it will become", () => {
    expect(memoryHeadline({ yearsAgo: 1, place: "Los Angeles" })).toBe("1 year ago today, you were in Los Angeles.");
    expect(memoryHeadline({ yearsAgo: 3, place: "St. Barths" })).toBe("3 years ago today, you were in St. Barths.");
    expect(memoryHeadline({ yearsAgo: 2, place: null })).toBe("2 years ago today.");
    expect(memoryLabel({ yearsAgo: 1, place: "Lisbon" })).toBe("1 year ago · Lisbon");
    expect(memoryLabel({ yearsAgo: 4, place: null })).toBe("4 years ago");
  });
});

describe("taken order", () => {
  it("sorts by capture date, falling back to the posting date", () => {
    const posts = [
      post("posted-first", null, null, "2026-01-01T00:00:00"),
      post("old-film", "2019-06-01T00:00:00", null, "2026-02-01T00:00:00"),
      post("recent", "2026-03-01T00:00:00", null, "2026-03-02T00:00:00"),
    ];
    expect(sortByTaken(posts).map((p) => p.id)).toEqual(["recent", "posted-first", "old-film"]);
  });
});

describe("eras", () => {
  it("groups by place and year, then season and year", () => {
    const eras = groupEras([
      post("1", "2023-04-02T12:00:00", "St. Barths"),
      post("2", "2023-04-05T12:00:00", "St. Barths"),
      post("3", "2021-07-10T12:00:00", null),
      post("4", "2021-08-20T12:00:00", null),
      post("5", "2020-12-25T12:00:00", "Home"), // alone — not an era
      post("6", null, "Undated"),
    ]);
    expect(eras.map((e) => e.title)).toEqual(["St. Barths 2023", "Summer 2021"]);
    expect(eras[0].posts.map((p) => p.id)).toEqual(["2", "1"]);
  });

  it("keeps the same place in different years apart", () => {
    const eras = groupEras([
      post("a", "2022-06-01T12:00:00", "Kyoto"),
      post("b", "2022-06-02T12:00:00", "Kyoto"),
      post("c", "2024-06-01T12:00:00", "Kyoto"),
      post("d", "2024-06-02T12:00:00", "Kyoto"),
    ]);
    expect(eras.map((e) => e.title)).toEqual(["Kyoto 2024", "Kyoto 2022"]);
  });
});

describe("what the eras leave out", () => {
  const posts = [
    post("1", "2023-04-02T12:00:00", "St. Barths"),
    post("2", "2023-04-05T12:00:00", "St. Barths"),
    post("3", "2021-07-10T12:00:00", null),
    post("4", "2021-08-20T12:00:00", null),
    post("5", "2020-12-25T12:00:00", "Home"), // alone in its place and year
    post("6", null, "Undated"),
    post("7", "not a date", "Unreadable"),
    post("8", "2021-07-30T12:00:00", "Lisbon"), // a place written once does not fall back to its season
  ];

  it("are exactly groupEras's eras", () => {
    expect(eraSummary(posts).eras).toEqual(groupEras(posts));
  });

  it("count every photograph once: in one era, undated, or apart", () => {
    const summary = eraSummary(posts);
    expect(summary.undated).toBe(2);
    expect(summary.apart).toBe(2);
    const gathered = summary.eras.flatMap((e) => e.posts.map((p) => p.id));
    expect(new Set(gathered).size).toBe(gathered.length);
    expect(gathered.length + summary.undated + summary.apart).toBe(posts.length);
    // The dated ones not gathered are the ones counted apart.
    const dated = posts.filter((p) => p.taken_at && !Number.isNaN(new Date(p.taken_at).getTime()));
    expect(dated.filter((p) => !gathered.includes(p.id)).map((p) => p.id)).toEqual(["5", "8"]);
  });

  it("hold for any grid", () => {
    const places = ["Kyoto", "Lisbon", null, null, "Milan"];
    const many = Array.from({ length: 60 }, (_, i) =>
      post(
        `p${i}`,
        i % 7 === 0 ? null : `20${20 + (i % 4)}-${String((i % 12) + 1).padStart(2, "0")}-1${i % 9}T12:00:00`,
        places[i % places.length],
      ),
    );
    const summary = eraSummary(many);
    const gathered = summary.eras.reduce((n, e) => n + e.posts.length, 0);
    expect(gathered + summary.undated + summary.apart).toBe(many.length);
    expect(summary.apart).toBeGreaterThanOrEqual(0);
  });

  it("are nothing for an empty grid", () => {
    expect(eraSummary([])).toEqual({ eras: [], undated: 0, apart: 0 });
  });
});

describe("the era a photograph is in", () => {
  const posts = [
    post("a", "2023-04-02T12:00:00", "St. Barths"),
    post("b", "2023-04-05T12:00:00", "St. Barths"),
    post("c", "2023-04-03T12:00:00", "St. Barths"),
    post("d", "2021-07-10T12:00:00", null),
    post("e", "2024-03-01T12:00:00", "Kyoto"),
    post("f", "2024-03-02T12:00:00", "Kyoto"),
  ];

  it("is the era groupEras made, newest capture first, whichever of its photographs asks", () => {
    for (const id of ["a", "b", "c"]) {
      expect(eraOf(posts, id)?.title).toBe("St. Barths 2023");
      expect(eraOf(posts, id)?.posts.map((p) => p.id)).toEqual(["b", "c", "a"]);
    }
    expect(eraOf(posts, "a")).toEqual(groupEras(posts).find((e) => e.title === "St. Barths 2023"));
    expect(eraOf(posts, "f")?.title).toBe("Kyoto 2024");
  });

  it("is null for a photograph in no era, or no longer among the rows", () => {
    expect(eraOf(posts, "d")).toBeNull(); // one photograph is not an era
    expect(eraOf(posts, "gone")).toBeNull();
  });
});

describe("same night", () => {
  it("reaches twelve hours either side of the capture", () => {
    const { from, to } = sameNightWindow("2019-08-14T22:00:00");
    expect(from.getTime()).toBe(new Date("2019-08-14T10:00:00").getTime());
    expect(to.getTime()).toBe(new Date("2019-08-15T10:00:00").getTime());
  });
});
