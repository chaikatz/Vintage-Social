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

  it("given what was typed, puts how well each matches first, and closeness within each", () => {
    const results = [
      { id: "stranger", username: "mateo", full_name: null },
      { id: "f", username: "zed", full_name: "Lena Matos" },
      { id: "r", username: "emma", full_name: "Emma Stone" },
      { id: "w", username: "margot", full_name: null },
    ];
    // Usernames that start with it (margot, followed back; mateo), then a name's word (Matos), then the rest (emma, just looked at).
    expect(rankSearch(results, circle, "ma").map((p) => p.id)).toEqual(["w", "stranger", "f", "r"]);
    // One letter is all usernames that start with it, so closeness alone orders them.
    const one = [{ id: "stranger", username: "mo" }, { id: "f", username: "mia" }, { id: "r", username: "max" }];
    expect(rankSearch(one, circle, "m").map((p) => p.id)).toEqual(["r", "f", "stranger"]);
  });
});
