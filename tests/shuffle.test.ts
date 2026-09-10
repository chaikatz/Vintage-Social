import { describe, expect, it } from "vitest";
import { dealExplore, seededShuffle, spreadAuthors } from "@/utils/shuffle";

const posts = (n: number, authors = 4) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, author_id: `a${i % authors}` }));

describe("explore's deal", () => {
  it("is a permutation — nothing repeated, nothing dropped", () => {
    const input = posts(60);
    const out = seededShuffle(input, 12345);
    expect(out).toHaveLength(60);
    expect(new Set(out.map((p) => p.id)).size).toBe(60);
    expect(out.map((p) => p.id).sort()).toEqual(input.map((p) => p.id).sort());
  });

  it("gives one order per seed, so a re-render keeps its rows", () => {
    const input = posts(30);
    expect(seededShuffle(input, 7)).toEqual(seededShuffle(input, 7));
  });

  it("gives a different order for a different seed", () => {
    const input = posts(30);
    const a = seededShuffle(input, 1).map((p) => p.id);
    const b = seededShuffle(input, 2).map((p) => p.id);
    expect(a).not.toEqual(b);
  });

  it("leaves the input untouched", () => {
    const input = posts(10);
    const before = input.map((p) => p.id);
    seededShuffle(input, 3);
    expect(input.map((p) => p.id)).toEqual(before);
  });

  it("keeps one member's photographs from landing side by side where it can", () => {
    const run = [
      { id: "1", author_id: "x" },
      { id: "2", author_id: "x" },
      { id: "3", author_id: "y" },
      { id: "4", author_id: "x" },
      { id: "5", author_id: "y" },
    ];
    const out = spreadAuthors(run);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].author_id).not.toBe(out[i - 1].author_id);
    }
    expect(out.map((p) => p.id).sort()).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("gives up gracefully when one member dominates", () => {
    const run = [
      { id: "1", author_id: "x" },
      { id: "2", author_id: "x" },
      { id: "3", author_id: "x" },
      { id: "4", author_id: "y" },
    ];
    const out = spreadAuthors(run);
    expect(out).toHaveLength(4);
    expect(new Set(out.map((p) => p.id)).size).toBe(4);
  });

  it("deals a full grid with no duplicates", () => {
    const out = dealExplore(posts(60, 12), 99);
    expect(new Set(out.map((p) => p.id)).size).toBe(60);
  });
});
