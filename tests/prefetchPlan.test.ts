import { describe, expect, it } from "vitest";
import { ASKED_MEMORY, LARGE_AHEAD, SMALL_AHEAD, aheadOf, askedOnce, isRemote } from "@/media/prefetchPlan";

/**
 * What Home fetches ahead of the reader (src/media/prefetchPlan.ts): the
 * next few posts' small copies and the next photograph or two, never the
 * feed, never a file already on the phone, and each address once.
 */

type Kind = "photo" | "video";
const row = (i: number, kind: Kind = "photo", path = `u/${i}.jpg`) => ({
  media_type: kind,
  media_path: kind === "video" ? `u/${i}.mp4` : path,
  thumb_path: `u/${i}.jpg`,
});
const urlOf = (bucket: "media" | "thumbnails", path: string | null) =>
  path == null ? null : /^[a-z]+:/i.test(path) ? path : `https://cdn.example/${bucket}/${path}`;

describe("what is fetched ahead of the reader", () => {
  const feed = Array.from({ length: 40 }, (_, i) => row(i));

  it("the small copies of the next eight posts and the photographs of the next two, after the one on screen", () => {
    expect(SMALL_AHEAD).toBe(8);
    expect(LARGE_AHEAD).toBe(2);
    const { small, large } = aheadOf(feed, 5, urlOf);
    expect(small).toEqual(Array.from({ length: 8 }, (_, i) => `https://cdn.example/thumbnails/u/${6 + i}.jpg`));
    expect(large).toEqual(["https://cdn.example/media/u/6.jpg", "https://cdn.example/media/u/7.jpg"]);
  });

  it("nothing behind the reader, and nothing past the next few, however long the feed", () => {
    const { small, large } = aheadOf(feed, 30, urlOf);
    for (const url of [...small, ...large]) {
      const n = Number(url.match(/u\/(\d+)\./)?.[1]);
      expect(n).toBeGreaterThan(30);
      expect(n).toBeLessThanOrEqual(30 + SMALL_AHEAD);
    }
  });

  it("from the top before any card is reported, and less near the end", () => {
    expect(aheadOf(feed, -1, urlOf).small[0]).toBe("https://cdn.example/thumbnails/u/0.jpg");
    expect(aheadOf(feed, 37, urlOf).small).toHaveLength(2);
    expect(aheadOf(feed, 39, urlOf)).toEqual({ small: [], large: [] });
    expect(aheadOf([], 0, urlOf)).toEqual({ small: [], large: [] });
  });

  it("a film's poster, never the film", () => {
    const { small, large } = aheadOf([row(0), row(1, "video"), row(2)], -1, urlOf);
    expect(small).toContain("https://cdn.example/thumbnails/u/1.jpg");
    expect(large).toEqual(["https://cdn.example/media/u/0.jpg"]);
  });

  it("nothing already on the phone: the member's own post drawn from its file, a picture bundled with the demo", () => {
    const own = { media_type: "photo" as const, media_path: "file:///outbox/a.jpg", thumb_path: "file:///outbox/a-thumb.jpg" };
    const bundled = { media_type: "photo" as const, media_path: "demo:1", thumb_path: null };
    expect(aheadOf([own, bundled], -1, (_b, p) => (p === "demo:1" ? null : p))).toEqual({ small: [], large: [] });
    expect(isRemote("https://x/y.jpg")).toBe(true);
    expect(isRemote("file:///y.jpg")).toBe(false);
    expect(isRemote(null)).toBe(false);
  });
});

describe("each address asked for once", () => {
  it("hands back only what has not been asked for, each once", () => {
    const fresh = askedOnce();
    expect(fresh(["a", "b", "a"])).toEqual(["a", "b"]);
    expect(fresh(["b", "c"])).toEqual(["c"]);
    expect(fresh([])).toEqual([]);
  });

  it("remembers only so many, the oldest let go first", () => {
    expect(ASKED_MEMORY).toBeGreaterThanOrEqual(100);
    const fresh = askedOnce(3);
    fresh(["a", "b", "c"]);
    expect(fresh(["d"])).toEqual(["d"]);
    // "a" was the oldest, and has been let go; "c" is still remembered.
    expect(fresh(["a", "c"])).toEqual(["a"]);
  });
});
