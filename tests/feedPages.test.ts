import { readFileSync } from "node:fs";
import path from "node:path";
import { InfiniteQueryObserver, QueryClient, type InfiniteData } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";
import { NEAR_TOP, firstPageOnly, refreshFromFirstPage, refreshOnReturn } from "@/media/feedPages";

/**
 * Refreshing Home reads its newest page once, not every page loaded again
 * one after another. Measured on React Query itself: the same infinite
 * query Home uses, with a page function that counts its calls.
 */

const PAGE = 12;

function feedQuery(total: number, net = { down: false }) {
  const calls: number[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  const observer = new InfiniteQueryObserver<string[], Error, InfiniteData<string[], number>, string[], number>(client, {
    queryKey: ["feed", "me"],
    queryFn: async ({ pageParam }) => {
      calls.push(pageParam);
      if (net.down) throw new Error("Network request failed");
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

  it("reads the newest page once through the helper Home calls, and keeps it", async () => {
    const { client, observer, calls, unsubscribe } = feedQuery(1000);
    await scrollDown(observer, 20);
    calls.length = 0;
    const result = await refreshFromFirstPage(client, ["feed", "me"], () => observer.refetch());
    expect(result.isError).toBe(false);
    expect(calls).toEqual([0]);
    expect(observer.getCurrentResult().data?.pages).toHaveLength(1);
    unsubscribe();
  });

  it("puts every page back, as old as it was, when the newest cannot be read", async () => {
    const net = { down: false };
    const { client, observer, calls, unsubscribe } = feedQuery(1000, net);
    await scrollDown(observer, 20);
    const before = client.getQueryData<InfiniteData<string[], number>>(["feed", "me"]);
    const updatedAt = client.getQueryState(["feed", "me"])?.dataUpdatedAt;
    net.down = true;
    calls.length = 0;
    const result = await refreshFromFirstPage(client, ["feed", "me"], () => observer.refetch());
    expect(result.isError).toBe(true);
    expect(calls).toEqual([0]);
    const after = observer.getCurrentResult();
    expect(after.data).toEqual(before);
    expect(after.data?.pages).toHaveLength(20);
    // Still as stale as it was, so a return to the app asks again.
    expect(client.getQueryState(["feed", "me"])?.dataUpdatedAt).toBe(updatedAt);
    // And the reader scrolls on from where the pages end.
    net.down = false;
    await observer.fetchNextPage();
    expect(calls).toEqual([0, 20]);
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
  });

  it("asks again for a feed that never loaded (opened offline), as the query itself would have", () => {
    expect(refreshOnReturn({ ...base, seenIndex: -1, updatedAt: 0, now: 5_000_000 })).toBe(true);
    expect(refreshOnReturn({ ...base, seenIndex: 9, updatedAt: 0, now: 5_000_000 })).toBe(true);
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
    expect(home).toMatch(/const refreshFromTop = useCallback\(\s*\(\) => refreshFromFirstPage\(queryClient, \["feed", userId\], feedRefetch\),/);
    expect(code("src/media/feedPages.ts")).toMatch(/const trimmed = firstPageOnly\(before\);\s*if \(trimmed === before\) return refetch\(\);\s*client\.setQueryData\(key, trimmed\);/);
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
