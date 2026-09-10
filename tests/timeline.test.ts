import { describe, expect, it } from "vitest";
import { buildTimeline, gapLabel } from "@/utils/timeline";

const post = (id: string, taken: string | null, created = "2026-09-01T12:00:00Z") => ({
  id,
  taken_at: taken,
  created_at: created,
});

describe("the profile timeline", () => {
  it("orders by the day the shutter fired, newest first, not by upload", () => {
    const rows = buildTimeline([
      post("posted-first", "2019-08-14T10:00:00Z", "2026-09-03T00:00:00Z"),
      post("posted-second", "2023-06-02T10:00:00Z", "2026-09-02T00:00:00Z"),
      post("posted-third", "2021-01-20T10:00:00Z", "2026-09-01T00:00:00Z"),
    ]);
    const ids = rows.filter((r) => r.kind === "post").map((r) => (r.kind === "post" ? r.post.id : ""));
    expect(ids).toEqual(["posted-second", "posted-third", "posted-first"]);
  });

  it("alternates sides down the line", () => {
    const rows = buildTimeline([
      post("a", "2024-03-01T10:00:00Z"),
      post("b", "2024-03-02T10:00:00Z"),
      post("c", "2024-03-03T10:00:00Z"),
    ]);
    const sides = rows.flatMap((r) => (r.kind === "post" ? [r.side] : []));
    expect(sides).toEqual(["left", "right", "left"]);
  });

  it("writes the year on the line as it changes, before the first photograph of it", () => {
    const rows = buildTimeline([post("a", "2024-03-01T10:00:00Z"), post("b", "2022-11-05T10:00:00Z")]);
    expect(rows.map((r) => r.kind)).toEqual(["year", "post", "gap", "year", "post"]);
    expect(rows[0]).toMatchObject({ kind: "year", year: 2024 });
    expect(rows[3]).toMatchObject({ kind: "year", year: 2022 });
  });

  it("marks a long silence and leaves a short one alone", () => {
    const rows = buildTimeline([
      post("a", "2024-08-01T10:00:00Z"),
      post("b", "2024-07-20T10:00:00Z"), // twelve days: the line just continues
      post("c", "2024-01-10T10:00:00Z"), // six months: said out loud
    ]);
    const gaps = rows.filter((r) => r.kind === "gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ label: "6 months" });
  });

  it("falls back to the posting date for a photograph with no capture date", () => {
    const rows = buildTimeline([post("a", null, "2020-05-05T10:00:00Z"), post("b", "2021-05-05T10:00:00Z")]);
    const ids = rows.flatMap((r) => (r.kind === "post" ? [r.post.id] : []));
    expect(ids).toEqual(["b", "a"]);
  });

  it("keeps every key unique so the list never warns", () => {
    const rows = buildTimeline([
      post("a", "2024-08-01T10:00:00Z"),
      post("b", "2023-08-01T10:00:00Z"),
      post("c", "2022-08-01T10:00:00Z"),
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("says a gap the way a person would", () => {
    expect(gapLabel(50)).toBe("7 weeks");
    expect(gapLabel(200)).toBe("7 months");
    expect(gapLabel(365)).toBe("1 year");
    expect(gapLabel(548)).toBe("1.5 years");
    expect(gapLabel(1500)).toBe("4 years");
  });
});
