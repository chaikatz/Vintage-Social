import { describe, expect, it } from "vitest";
import {
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

describe("same night", () => {
  it("reaches twelve hours either side of the capture", () => {
    const { from, to } = sameNightWindow("2019-08-14T22:00:00");
    expect(from.getTime()).toBe(new Date("2019-08-14T10:00:00").getTime());
    expect(to.getTime()).toBe(new Date("2019-08-15T10:00:00").getTime());
  });
});
