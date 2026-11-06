import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { idsAround } from "@/media/cardWindow";
import { IDS_PER_REQUEST } from "@/api/batch";
import { CHUNK_SIZE, stableChunks, type ChunkBook } from "@/utils/stableChunks";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

/** The feed's page, and the cards Home keeps from its first draw (app/(tabs)/index.tsx). */
const PAGE = 12;
const HOME_FIRST_DRAW = 4;

interface Reads {
  /** Requests for likes and for comment previews together. */
  requests: number;
  /** Post ids asked about, likes and previews together. */
  idsAsked: number;
  /** How many times the most-read post was read. */
  mostReadsOfOnePost: number;
}

/**
 * The reader goes down Home card by card through `pages` pages, the next
 * page arriving four cards before the end of what is loaded, as the
 * list's end-reached threshold has it. At each card Home asks for the
 * likes and comment previews of `idsAround` the card on screen.
 * `strategy` turns each ask into the requests it makes.
 */
function scroll(pages: number, strategy: (ids: readonly string[]) => (readonly string[])[]): Reads {
  const all = Array.from({ length: pages * PAGE }, (_, i) => `p${String(i).padStart(4, "0")}`);
  let loaded = PAGE;
  const asked = new Map<string, number>();
  let requests = 0;
  let idsAsked = 0;
  for (let seen = 0; seen < all.length; seen++) {
    if (seen >= loaded - 4 && loaded < all.length) loaded += PAGE;
    const ids = idsAround(all.slice(0, loaded), seen, { keepFirst: HOME_FIRST_DRAW });
    for (const group of strategy(ids)) {
      // One read for likes and one for previews, each a hundred ids a request.
      requests += 2 * Math.ceil(group.length / IDS_PER_REQUEST);
      idsAsked += 2 * group.length;
      for (const id of group) asked.set(id, (asked.get(id) ?? 0) + 1);
    }
  }
  return { requests, idsAsked, mostReadsOfOnePost: Math.max(...asked.values()) };
}

/** Before: one key for every id asked about, joined; a new key reads them all again. */
function oneKey(): (ids: readonly string[]) => (readonly string[])[] {
  const cached = new Set<string>();
  return (ids) => {
    const key = ids.join(",");
    if (cached.has(key)) return [];
    cached.add(key);
    return [ids];
  };
}

/** After: a key per group that keeps its members; only a group not yet read is read. */
function groups(): (ids: readonly string[]) => (readonly string[])[] {
  const book: ChunkBook = new Map();
  const cached = new Set<readonly string[]>();
  return (ids) =>
    stableChunks(ids, book).filter((group) => {
      if (cached.has(group)) return false;
      cached.add(group);
      return true;
    });
}

describe("likes and comment previews over a long scroll of Home", () => {
  it("read each post once, not again with every new stretch of the feed", () => {
    const before = scroll(10, oneKey());
    const after = scroll(10, groups());
    // Shown when the suite runs with --reporter=verbose; the numbers are in the commit message.
    console.info("10 pages of Home, likes + previews:", { before, after });
    // Every post of the ten pages is read once for its likes and once for its previews.
    expect(after.idsAsked).toBe(2 * 10 * PAGE);
    expect(after.mostReadsOfOnePost).toBe(1);
    expect(after.requests).toBeLessThan(before.requests);
    expect(after.idsAsked).toBeLessThan(before.idsAsked / 2);
  });

  it("keep each post in the group it was first read in, as the window moves both ways", () => {
    const book: ChunkBook = new Map();
    const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `p${from + i}`);
    const first = stableChunks(ids(0, 12), book);
    expect(first).toHaveLength(1);
    // The next page: its own group; the first is the same array, so the same key.
    const second = stableChunks(ids(0, 24), book);
    expect(second).toHaveLength(2);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toEqual(ids(12, 24));
    // The window moves on past the first page; back again, nothing is new.
    const moved = stableChunks(ids(12, 36), book);
    expect(moved[0]).toBe(second[1]);
    const back = stableChunks(ids(0, 24), book);
    expect(back[0]).toBe(first[0]);
    expect(back[1]).toBe(second[1]);
  });

  it("put ids new at the same time in one request's worth, and repeats once", () => {
    const book: ChunkBook = new Map();
    const many = Array.from({ length: 250 }, (_, i) => `q${i}`);
    const made = stableChunks([...many, "q0", "q1"], book);
    expect(made.map((g) => g.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 50]);
    expect(CHUNK_SIZE).toBe(IDS_PER_REQUEST);
    expect(stableChunks([], book)).toEqual([]);
  });

  it("start the book afresh rather than let it grow without end", () => {
    const book: ChunkBook = new Map();
    stableChunks(["a", "b"], book, { remember: 3 });
    expect(book.size).toBe(2);
    const again = stableChunks(["c", "d"], book, { remember: 3 });
    expect(book.size).toBe(2);
    expect(again).toEqual([["c", "d"]]);
  });

  it("are read so by every screen that shows a post's card", () => {
    const actions = read("src/hooks/usePostActions.ts");
    expect(actions).toMatch(/const chunks = useMemo\(\(\) => stableChunks\(postIds, book\.current\), \[postIds\]\);/);
    expect(actions).toMatch(/queryKey: \["my-likes", userId, ids\.join\(","\)\]/);
    expect(actions).toMatch(/queryFn: \(\) => fetchMyLikes\(userId, \[\.\.\.ids\]\)/);
    expect(actions).toMatch(/queryKey: \["comment-previews", ids\.join\(","\)\]/);
    expect(actions).toMatch(/queryFn: \(\) => fetchCommentPreviews\(\[\.\.\.ids\], INLINE_COMMENTS\)/);
    // No read keyed on every id at once.
    expect(actions).not.toMatch(/postIds\.join\(/);
  });
});
