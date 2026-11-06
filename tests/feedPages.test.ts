import { readFileSync } from "node:fs";
import path from "node:path";
import { InfiniteQueryObserver, QueryClient, focusManager, onlineManager, type InfiniteData } from "@tanstack/query-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryRead } from "@/utils/retry";
import { LATE_WAIT_MS, NEAR_TOP, firstPageOnly, refreshFromFirstPage, refreshOnReturn } from "@/media/feedPages";
import { placeConfirmedPost } from "@/uploads/feedCache";

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
    expect(result?.isError).toBe(false);
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
    expect(result?.isError).toBe(true);
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
    // And the hearts and comment previews of the cards on screen with it:
    // their groups keep their keys, so nothing else reads them again.
    expect(home).toMatch(
      /const refreshFromTop = useCallback\(\(\) => \{\s*if \(!onlineManager\.isOnline\(\)\) return Promise\.resolve\(null\);\s*void rereadActions\(\);\s*return refreshFromFirstPage\(queryClient, \["feed", userId\], feedRefetch\);\s*\}, \[queryClient, userId, feedRefetch, rereadActions\]\);/,
    );
    expect(home).toMatch(/commentsFor, rereadActions \} =\s*usePostActions\(userId, actionIds\);/);
    // Defined after usePostActions gives it, before anything uses it.
    expect(home.indexOf("const refreshFromTop")).toBeGreaterThan(home.indexOf("usePostActions(userId, actionIds)"));
    expect(home.indexOf("const refreshFromTop")).toBeLessThan(home.indexOf("useRef(refreshFromTop)"));
    expect(code("src/media/feedPages.ts")).toMatch(
      /const trimmed = firstPageOnly\(before\);\s*const query = [^\n]*;\s*if \(trimmed === before\) \{\s*if \(query\) clearLateWaits\(client, query\);\s*return refetch\(\);\s*\}\s*client\.setQueryData\(key, trimmed\);/,
    );
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

describe("the notes on how the feed pages", () => {
  const raw = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

  it("say it pages by cursor, as it does, never by offset", () => {
    // The feed pages after the last post held (src/api/posts.ts, 0025).
    for (const file of ["src/media/feedPages.ts", "src/uploads/feedCache.ts"]) {
      expect(raw(file), file).not.toMatch(/by offset/);
    }
    expect(raw("src/uploads/feedCache.ts")).toMatch(
      /Each page starts after the last post of the\s+\* one before \(a cursor, src\/api\/posts\.ts\), so the prepended row moves no\s+\* page/,
    );
  });
});

/**
 * With no signal. The app's own query options (src/lib/queryClient.ts):
 * a read is tried once whatever the phone says, and its further tries
 * wait for the signal, neither landing nor failing until it returns. A
 * refresh made then used to cut the feed to its first page, and the
 * pages came back only with the signal and a scroll.
 */
describe("a refresh of the feed with no signal", () => {
  function offlineFeed(net: { down: boolean }) {
    const calls: number[] = [];
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          networkMode: "offlineFirst",
          retry: retryRead,
          retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 5000),
        },
      },
    });
    // Mounted, as QueryClientProvider mounts the app's: told when the signal returns.
    client.mount();
    const observer = new InfiniteQueryObserver<string[], Error, InfiniteData<string[], number>, string[], number>(client, {
      queryKey: ["feed", "me"],
      queryFn: async ({ pageParam }) => {
        calls.push(pageParam);
        if (net.down) throw new TypeError("Network request failed");
        const from = pageParam * PAGE;
        return Array.from({ length: PAGE }, (_, i) => `post-${from + i}`);
      },
      initialPageParam: 0,
      getNextPageParam: (_last, pages) => pages.length,
    });
    const stop = observer.subscribe(() => undefined);
    const unsubscribe = () => {
      stop();
      client.unmount();
    };
    return { client, observer, calls, unsubscribe };
  }

  async function settled<T>(p: Promise<T>, ms: number): Promise<{ done: boolean; value?: T }> {
    const out: { done: boolean; value?: T } = { done: false };
    void p.then((value) => {
      out.done = true;
      out.value = value;
    });
    for (let t = 0; t < ms && !out.done; t += 100) await vi.advanceTimersByTimeAsync(100);
    return out;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  it("asks nothing and lets nothing go while the phone says it has no signal", async () => {
    const net = { down: false };
    const { client, observer, calls, unsubscribe } = offlineFeed(net);
    try {
      await scrollDown(observer, 5);
      const before = client.getQueryData(["feed", "me"]);
      const updatedAt = client.getQueryState(["feed", "me"])?.dataUpdatedAt;
      net.down = true;
      onlineManager.setOnline(false);
      calls.length = 0;
      const out = await settled(refreshFromFirstPage(client, ["feed", "me"], () => observer.refetch()), 10_000);
      expect(out.done).toBe(true);
      expect(calls).toEqual([]);
      expect(observer.getCurrentResult().data?.pages).toHaveLength(5);
      expect(client.getQueryData(["feed", "me"])).toBe(before);
      expect(client.getQueryState(["feed", "me"])?.dataUpdatedAt).toBe(updatedAt);
    } finally {
      unsubscribe();
    }
  });

  it("puts every page back, as old as it was, when the signal goes once the read is out", async () => {
    const net = { down: false };
    const { client, observer, calls, unsubscribe } = offlineFeed(net);
    try {
      await scrollDown(observer, 5);
      const before = client.getQueryData<InfiniteData<string[], number>>(["feed", "me"]);
      const updatedAt = client.getQueryState(["feed", "me"])?.dataUpdatedAt;
      // The phone still says it has a signal as the read goes out; it has none.
      net.down = true;
      calls.length = 0;
      const refresh = refreshFromFirstPage(client, ["feed", "me"], () => observer.refetch());
      await vi.advanceTimersByTimeAsync(10);
      expect(observer.getCurrentResult().data?.pages).toHaveLength(1);
      onlineManager.setOnline(false);
      const out = await settled(refresh, 10_000);
      expect(out.done).toBe(true);
      expect(calls).toEqual([0]);
      const now = observer.getCurrentResult();
      expect(now.data).toEqual(before);
      expect(now.data?.pages).toHaveLength(5);
      expect(now.fetchStatus).toBe("idle");
      expect(now.isError).toBe(false);
      // Still as stale as it was, so the signal's return refreshes a reader at the top (Home).
      expect(client.getQueryState(["feed", "me"])?.dataUpdatedAt).toBe(updatedAt);
      // Nothing waits to undo it when the signal returns.
      net.down = false;
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(observer.getCurrentResult().data?.pages).toHaveLength(5);
      expect(calls).toEqual([0]);
      // And the reader scrolls on from where the pages end.
      await observer.fetchNextPage();
      expect(calls).toEqual([0, 5]);
    } finally {
      unsubscribe();
    }
  });

  it("puts every page back when the reader scrolled on while the read was out, and the signal went", async () => {
    const net = { down: false };
    const { client, observer, calls, unsubscribe } = offlineFeed(net);
    try {
      await scrollDown(observer, 5);
      const before = client.getQueryData<InfiniteData<string[], number>>(["feed", "me"]);
      net.down = true;
      calls.length = 0;
      const refresh = refreshFromFirstPage(client, ["feed", "me"], () => observer.refetch());
      await vi.advanceTimersByTimeAsync(10);
      // The end of the one page left is reached: the next is asked for,
      // which calls the refresh off between its tries.
      const more = observer.fetchNextPage();
      await vi.advanceTimersByTimeAsync(10);
      onlineManager.setOnline(false);
      const out = await settled(Promise.all([refresh, more]), 10_000);
      expect(out.done).toBe(true);
      expect(calls).toEqual([0, 1]);
      expect(observer.getCurrentResult().data).toEqual(before);
      // Nothing is out, and nothing says it waits: react-query's late
      // "paused" for the next page's read, called off between its tries,
      // is set right (it stayed until the next read).
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.getQueryCache().find({ queryKey: ["feed", "me"], exact: true })?.promise).toBeUndefined();
      expect(observer.getCurrentResult().isFetching).toBe(false);
      expect(observer.getCurrentResult().fetchStatus).toBe("idle");
      const asked = calls.length;
      net.down = false;
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls).toHaveLength(asked);
      expect(observer.getCurrentResult().data).toEqual(before);
      await observer.fetchNextPage();
      expect(calls.at(-1)).toBe(5);
      expect(observer.getCurrentResult().data?.pages).toHaveLength(6);
      expect(observer.getCurrentResult().fetchStatus).toBe("idle");
    } finally {
      unsubscribe();
    }
  });

  it("puts every page back, and leaves nothing 'waiting', when it called off a next page that was between its tries", async () => {
    // The next page out and waiting between its tries when the reader
    // pulls: the refresh calls it off, and that read's late "paused" comes
    // while the refresh's own read is between its tries too.
    const net = { down: false };
    const { client, observer, calls, unsubscribe } = offlineFeed(net);
    try {
      await scrollDown(observer, 5);
      const before = client.getQueryData<InfiniteData<string[], number>>(["feed", "me"]);
      const updatedAt = client.getQueryState(["feed", "me"])?.dataUpdatedAt;
      net.down = true;
      calls.length = 0;
      void observer.fetchNextPage();
      await vi.advanceTimersByTimeAsync(10);
      const refresh = refreshFromFirstPage(client, ["feed", "me"], () => observer.refetch());
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toEqual([5, 0]);
      onlineManager.setOnline(false);
      const out = await settled(refresh, 10_000);
      expect(out.done).toBe(true);
      await vi.advanceTimersByTimeAsync(10_000);
      const now = observer.getCurrentResult();
      expect(now.data).toEqual(before);
      expect(now.fetchStatus).toBe("idle");
      expect(client.getQueryState(["feed", "me"])?.dataUpdatedAt).toBe(updatedAt);
      // With the signal back, nothing was left waiting to undo it.
      net.down = false;
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls).toEqual([5, 0]);
      expect(observer.getCurrentResult().data).toEqual(before);
    } finally {
      unsubscribe();
    }
  });

  it("sets right only a 'waiting' said with no read out, and only for a while after it called a read off", async () => {
    const net = { down: false };
    const { client, observer, unsubscribe } = offlineFeed(net);
    try {
      await scrollDown(observer, 5);
      net.down = true;
      const refresh = refreshFromFirstPage(client, ["feed", "me"], () => observer.refetch());
      await vi.advanceTimersByTimeAsync(10);
      onlineManager.setOnline(false);
      expect((await settled(refresh, 10_000)).done).toBe(true);
      // A read asked for afterwards, still offline, waits for the signal: that one is out, and left to say so.
      const more = observer.fetchNextPage();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(observer.getCurrentResult().fetchStatus).toBe("paused");
      net.down = false;
      onlineManager.setOnline(true);
      expect((await settled(more, 10_000)).done).toBe(true);
      expect(observer.getCurrentResult().fetchStatus).toBe("idle");
      // Long after, nothing of the refresh still listens: a read called off
      // between its tries by someone else then says it waits, late, as
      // react-query has it.
      await vi.advanceTimersByTimeAsync(LATE_WAIT_MS);
      net.down = true;
      void observer.fetchNextPage();
      await vi.advanceTimersByTimeAsync(10);
      void client.cancelQueries({ queryKey: ["feed", "me"], exact: true });
      onlineManager.setOnline(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.getQueryCache().find({ queryKey: ["feed", "me"], exact: true })?.promise).toBeUndefined();
      expect(observer.getCurrentResult().fetchStatus).toBe("paused");
    } finally {
      unsubscribe();
    }
  });

  it("leaves nothing 'waiting' when its own read lands before the next page it called off says, late, that it waits", async () => {
    // A next page between its tries when the reader pulls; the refresh
    // calls it off and lands at once; the member leaves the app before
    // the called-off read's wait is over, and comes back.
    const net = { down: false };
    const { client, observer, calls, unsubscribe } = offlineFeed(net);
    try {
      await scrollDown(observer, 5);
      net.down = true;
      calls.length = 0;
      void observer.fetchNextPage();
      await vi.advanceTimersByTimeAsync(10);
      net.down = false;
      const out = await settled(refreshFromFirstPage(client, ["feed", "me"], () => observer.refetch()), 10_000);
      expect(out.done).toBe(true);
      expect(out.value?.isError).toBe(false);
      expect(calls).toEqual([5, 0]);
      expect(observer.getCurrentResult().data?.pages).toHaveLength(1);
      focusManager.setFocused(false);
      await vi.advanceTimersByTimeAsync(2_000);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.getQueryCache().find({ queryKey: ["feed", "me"], exact: true })?.promise).toBeUndefined();
      expect(observer.getCurrentResult().fetchStatus).toBe("idle");
      // So a post confirmed now hands over at once, not at the next read.
      const placed = await settled(placeConfirmedPost(client as never, "me", { id: "new-post" } as never), 10_000);
      expect(placed).toEqual({ done: true, value: true });
    } finally {
      focusManager.setFocused(undefined);
      unsubscribe();
    }
  });

  it("leaves nothing 'waiting' when the next page called it off between its tries and landed, and the signal then went", async () => {
    const net = { down: false };
    const { client, observer, calls, unsubscribe } = offlineFeed(net);
    try {
      await scrollDown(observer, 5);
      net.down = true;
      calls.length = 0;
      const refresh = refreshFromFirstPage(client, ["feed", "me"], () => observer.refetch());
      await vi.advanceTimersByTimeAsync(10);
      net.down = false;
      expect((await settled(observer.fetchNextPage(), 10_000)).done).toBe(true);
      expect((await settled(refresh, 10_000)).done).toBe(true);
      expect(calls).toEqual([0, 1]);
      expect(observer.getCurrentResult().fetchStatus).toBe("idle");
      onlineManager.setOnline(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.getQueryCache().find({ queryKey: ["feed", "me"], exact: true })?.promise).toBeUndefined();
      expect(observer.getCurrentResult().fetchStatus).toBe("idle");
    } finally {
      unsubscribe();
    }
  });

  it("leaves nothing 'waiting' after refreshing a feed of one page, which calls a read off between its tries too", async () => {
    const net = { down: false };
    const { client, observer, calls, unsubscribe } = offlineFeed(net);
    try {
      await scrollDown(observer, 1);
      net.down = true;
      calls.length = 0;
      void observer.fetchNextPage();
      await vi.advanceTimersByTimeAsync(10);
      net.down = false;
      const out = await settled(refreshFromFirstPage(client, ["feed", "me"], () => observer.refetch()), 10_000);
      expect(out.done).toBe(true);
      expect(calls).toEqual([1, 0]);
      onlineManager.setOnline(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.getQueryCache().find({ queryKey: ["feed", "me"], exact: true })?.promise).toBeUndefined();
      expect(observer.getCurrentResult().fetchStatus).toBe("idle");
    } finally {
      unsubscribe();
    }
  });

  it("refreshes from the newest page as before while there is a signal", async () => {
    const net = { down: false };
    const { client, observer, calls, unsubscribe } = offlineFeed(net);
    try {
      await scrollDown(observer, 5);
      calls.length = 0;
      const out = await settled(refreshFromFirstPage(client, ["feed", "me"], () => observer.refetch()), 10_000);
      expect(out.done).toBe(true);
      expect(out.value?.isError).toBe(false);
      expect(calls).toEqual([0]);
      expect(observer.getCurrentResult().data?.pages).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });
});
