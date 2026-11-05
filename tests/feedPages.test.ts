import { readFileSync } from "node:fs";
import path from "node:path";
import { InfiniteQueryObserver, QueryClient, type InfiniteData } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";
import { NEAR_TOP, firstPageOnly, refreshOnReturn } from "@/media/feedPages";

/**
 * Refreshing Home reads its newest page once, not every page loaded again
 * one after another. Measured on React Query itself: the same infinite
 * query Home uses, with a page function that counts its calls.
 */

const PAGE = 12;

function feedQuery(total: number) {
  const calls: number[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  const observer = new InfiniteQueryObserver<string[], Error, InfiniteData<string[], number>, string[], number>(client, {
    queryKey: ["feed", "me"],
    queryFn: async ({ pageParam }) => {
      calls.push(pageParam);
      const from = pageParam * PAGE;
      return Array.from({ length: Math.max(0, Math.min(PAGE, total - from)) }, (_, i) => `post-${from + i}`);
    },
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < PAGE ? undefined : pages.length),
  });
  const unsubscribe = observer.subscribe(() => undefined);
  return { client, observer, calls, unsubscribe };
}

async function scrollDown(observer: InfiniteQueryObserver<string[], Error, InfiniteData<string[], number>, string[], number>, pages: number) {
  await observer.refetch();
  for (let i = 1; i < pages; i++) await observer.fetchNextPage();
}

describe("a refresh of the feed", () => {
  it("read every page loaded again, one after another, when left to the query", async () => {
    const { observer, calls, unsubscribe } = feedQuery(1000);
    await scrollDown(observer, 20);
    calls.length = 0;
    await observer.refetch();
    expect(calls).toEqual(Array.from({ length: 20 }, (_, i) => i));
    unsubscribe();
  });

  it("reads the newest page once when the pages below it are let go first", async () => {
    const { client, observer, calls, unsubscribe } = feedQuery(1000);
    await scrollDown(observer, 20);
    calls.length = 0;
    client.setQueryData<InfiniteData<string[], number>>(["feed", "me"], (d) => firstPageOnly(d));
    const result = await observer.refetch();
    expect(calls).toEqual([0]);
    expect(result.data?.pages).toHaveLength(1);
    // Scrolling on reads the next page by its place: no page twice, none skipped.
    await observer.fetchNextPage();
    await observer.fetchNextPage();
    expect(calls).toEqual([0, 1, 2]);
    const ids = observer.getCurrentResult().data?.pages.flat() ?? [];
    expect(ids).toHaveLength(36);
    expect(new Set(ids).size).toBe(36);
    expect(ids[35]).toBe("post-35");
    unsubscribe();
  });

  it("leaves a feed of one page, or none, as it is", () => {
    expect(firstPageOnly(undefined)).toBeUndefined();
    const one = { pages: [["a"]], pageParams: [0] };
    expect(firstPageOnly(one)).toBe(one);
    expect(firstPageOnly({ pages: [["a"], ["b"]], pageParams: [0, 1] })).toEqual({ pages: [["a"]], pageParams: [0] });
  });
});

describe("coming back to the app", () => {
  const base = { updatedAt: 1_000_000, staleMs: 30_000 };

  it("refreshes a stale feed for a reader at its top", () => {
    expect(NEAR_TOP).toBe(2);
    for (const seenIndex of [-1, 0, 1, 2]) {
      expect(refreshOnReturn({ ...base, seenIndex, now: base.updatedAt + 30_000 })).toBe(true);
    }
  });

  it("leaves a reader further down where they are, and a fresh feed alone", () => {
    expect(refreshOnReturn({ ...base, seenIndex: 3, now: base.updatedAt + 600_000 })).toBe(false);
    expect(refreshOnReturn({ ...base, seenIndex: 0, now: base.updatedAt + 29_999 })).toBe(false);
    expect(refreshOnReturn({ ...base, seenIndex: 0, updatedAt: 0, now: 5_000_000 })).toBe(false);
  });
});

/** The source without its comments. */
function code(file: string): string {
  return readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Home", () => {
  const home = code("app/(tabs)/index.tsx");

  it("refreshes from its newest page when pulled and when Home is tapped again", () => {
    expect(home).toMatch(/queryClient\.setQueryData<InfiniteData<PostWithAuthor\[\], number>>\(\["feed", userId\], \(d\) => firstPageOnly\(d\)\);\s*return feedRefetch\(\);/);
    expect(home).toMatch(/onRefresh=\{\(\) => void refreshFromTop\(\)\}/);
    expect(home).toMatch(/refetchRef\.current = refreshFromTop;/);
    expect(home).not.toMatch(/onRefresh=\{\(\) => feed\.refetch\(\)\}/);
  });

  it("does not let the query read every page again on return or reconnection, and decides itself", () => {
    expect(home).toMatch(/refetchOnWindowFocus: false,/);
    expect(home).toMatch(/refetchOnReconnect: false,/);
    expect(home).toMatch(/focusManager\.subscribe\(/);
    expect(home).toMatch(/onlineManager\.subscribe\(/);
    expect(home).toMatch(/const stale = refreshOnReturn\(\{/);
  });
});
