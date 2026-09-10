import { describe, expect, it } from "vitest";
import { startAt } from "@/utils/gallery";

const posts = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

describe("which photograph a gallery opens on", () => {
  it("puts the tapped post first, by id, and the rest in order after it", () => {
    expect(startAt(posts, "c").map((p) => p.id)).toEqual(["c", "d", "e", "a", "b"]);
  });

  it("is the same list when the tapped post is already first", () => {
    expect(startAt(posts, "a")).toBe(posts);
  });

  it("leaves the order alone when nothing was tapped or the id is gone", () => {
    expect(startAt(posts, undefined)).toBe(posts);
    expect(startAt(posts, "zzz")).toBe(posts);
  });

  it("never loses or repeats a photograph", () => {
    const out = startAt(posts, "e");
    expect(out.map((p) => p.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(out[0].id).toBe("e");
  });
});
