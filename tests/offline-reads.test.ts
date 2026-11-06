import { afterEach, describe, expect, it, vi } from "vitest";

/** The phone's network listener the query client installs, caught as NetInfo would call it. */
const netinfo = vi.hoisted(() => ({ listeners: [] as ((state: { isConnected: boolean | null }) => void)[] }));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: {
    addEventListener: (listener: (state: { isConnected: boolean | null }) => void) => {
      netinfo.listeners.push(listener);
      return () => undefined;
    },
  },
}));

import { QueryClient, QueryObserver, onlineManager, type QueryObserverResult } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { retryRead } from "@/utils/retry";

/** The phone says whether it has a signal. */
const signal = (connected: boolean) => netinfo.listeners.forEach((l) => l({ isConnected: connected }));
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const noSignal = () => new TypeError("Network request failed");

/** A screen's read, on screen, with the last thing it drew. */
function onScreen(client: QueryClient, key: string, queryFn: () => Promise<string[]>) {
  const watch = new QueryObserver(client, { queryKey: [key], queryFn });
  let last: QueryObserverResult<string[]> = watch.getCurrentResult();
  const stop = watch.subscribe((r) => {
    last = r;
  });
  return { now: () => last, stop };
}

afterEach(() => {
  signal(true);
  vi.useRealTimers();
});

describe("a screen opened with no signal", () => {
  it("says it could not load, at once, and fills in by itself when the signal comes back", async () => {
    expect(netinfo.listeners.length).toBeGreaterThan(0);
    queryClient.mount();
    signal(false);
    expect(onlineManager.isOnline()).toBe(false);

    let online = false;
    const queryFn = vi.fn(async () => {
      if (!online) throw noSignal();
      return ["a photograph"];
    });
    const feed = onScreen(queryClient, "feed-opened-offline", queryFn);
    await settle();

    // Tried, failed, and said so: Home draws "Couldn't load your feed"
    // (feed.isError), not "A quiet start" (neither loading nor failed).
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(feed.now().isPaused).toBe(false);
    expect(feed.now().fetchStatus).toBe("idle");
    expect(feed.now().isError).toBe(true);

    // The signal comes back: read again without anyone pulling to refresh.
    online = true;
    signal(true);
    await settle();
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(feed.now().isError).toBe(false);
    expect(feed.now().data).toEqual(["a photograph"]);

    feed.stop();
    queryClient.unmount();
  });

  it("before, react-query's own mode left it waiting: neither loading nor failed, so the screen drew its empty state", async () => {
    const before = new QueryClient({ defaultOptions: { queries: { retry: retryRead } } });
    before.mount();
    signal(false);
    const queryFn = vi.fn(async () => ["a photograph"]);
    const feed = onScreen(before, "feed-before", queryFn);
    await settle();
    expect(queryFn).not.toHaveBeenCalled();
    expect(feed.now().isPaused).toBe(true);
    expect(feed.now().isLoading).toBe(false);
    expect(feed.now().isError).toBe(false);
    feed.stop();
    before.unmount();
  });
});

describe("a read that fails with a signal", () => {
  it("is still tried again, briefly spaced, as before", async () => {
    vi.useFakeTimers();
    queryClient.mount();
    signal(true);
    let failures = 2;
    const queryFn = vi.fn(async () => {
      if (failures-- > 0) throw noSignal();
      return ["a photograph"];
    });
    const feed = onScreen(queryClient, "feed-dropped", queryFn);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(queryFn).toHaveBeenCalledTimes(3);
    expect(feed.now().isError).toBe(false);
    expect(feed.now().data).toEqual(["a photograph"]);
    feed.stop();
    queryClient.unmount();
  });

  it("is not tried again while the phone says there is no signal", () => {
    const retry = queryClient.getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    signal(true);
    expect(retry(0, noSignal())).toBe(true);
    signal(false);
    expect(retry(0, noSignal())).toBe(false);
    signal(true);
  });
});
