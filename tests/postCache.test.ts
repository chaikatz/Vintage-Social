import { describe, expect, it } from "vitest";
import { rewriteValue } from "@/utils/postCache";

const post = (id: string, caption: string) => ({ id, media_path: `u/${id}.jpg`, caption });

describe("rewriting one post wherever it is cached", () => {
  const change = (p: { id: string; caption?: string }) => ({ ...p, caption: "new words" });

  it("changes the one row and leaves the others untouched", () => {
    const list = [post("a", "x"), post("b", "y")];
    const out = rewriteValue(list, "b", change) as typeof list;
    expect(out[1].caption).toBe("new words");
    expect(out[0]).toBe(list[0]);
  });

  it("reaches into infinite-query pages", () => {
    const feed = { pages: [[post("a", "x")], [post("b", "y")]], pageParams: [0, 1] };
    const out = rewriteValue(feed, "b", change) as typeof feed;
    expect(out.pages[1][0].caption).toBe("new words");
    expect(out.pageParams).toBe(feed.pageParams);
  });

  it("changes a single cached post", () => {
    expect((rewriteValue(post("a", "x"), "a", change) as { caption: string }).caption).toBe("new words");
  });

  it("returns the very same value when nothing matched, so nothing re-renders", () => {
    const list = [post("a", "x")];
    expect(rewriteValue(list, "zzz", change)).toBe(list);
    expect(rewriteValue(undefined, "a", change)).toBeUndefined();
  });

  it("does not mistake a profile or a comment for a post", () => {
    const profile = { id: "a", username: "ann" };
    expect(rewriteValue(profile, "a", change)).toBe(profile);
  });
});
