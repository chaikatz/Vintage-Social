import { describe, expect, it } from "vitest";
import { closeness, rankSearch } from "@/utils/searchRank";

const circle = {
  recentIds: new Set(["r"]),
  followingIds: new Set(["f", "both"]),
  followerIds: new Set(["w", "both"]),
};

describe("who comes first in member search", () => {
  it("puts the people you just looked at first, then who you follow, then who follows you", () => {
    const results = [{ id: "stranger" }, { id: "w" }, { id: "f" }, { id: "r" }];
    expect(rankSearch(results, circle).map((p) => p.id)).toEqual(["r", "f", "w", "stranger"]);
  });

  it("counts both directions of a friendship, and keeps the search's order among equals", () => {
    expect(closeness("both", circle)).toBe(3);
    const results = [{ id: "a" }, { id: "b" }, { id: "both" }, { id: "c" }];
    expect(rankSearch(results, circle).map((p) => p.id)).toEqual(["both", "a", "b", "c"]);
  });
});
