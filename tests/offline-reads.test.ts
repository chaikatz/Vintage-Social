import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { QueryClient, QueryObserver, focusManager, onlineManager, type QueryObserverResult } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { retryRead } from "@/utils/retry";

/** The phone says whether it has a signal. */
const signal = (connected: boolean) => netinfo.listeners.forEach((l) => l({ isConnected: connected }));
const noSignal = () => new TypeError("Network request failed");

/** A screen's read, on screen, with the last thing it drew. */
function onScreen(client: QueryClient, key: string, queryFn: () => Promise<string[]>) {
  const watch = new QueryObserver(client, { queryKey: [key], queryFn });
  let last: QueryObserverResult<string[]> = watch.getCurrentResult();
  const stop = watch.subscribe((r) => {
    last = r;
  });
  return { now: () => last, stop, refetch: () => watch.refetch() };
}

beforeEach(() => {
  vi.useFakeTimers();
  queryClient.mount();
});
afterEach(() => {
  signal(true);
  focusManager.setFocused(undefined);
  queryClient.unmount();
  queryClient.clear();
  vi.useRealTimers();
});

describe("a screen opened with no signal", () => {
  it("says it could not load, and fills in by itself when the signal comes back", async () => {
    expect(netinfo.listeners.length).toBeGreaterThan(0);
    signal(false);
    expect(onlineManager.isOnline()).toBe(false);

    let online = false;
    const queryFn = vi.fn(async () => {
      if (!online) throw noSignal();
      return ["a photograph"];
    });
    const feed = onScreen(queryClient, "feed-opened-offline", queryFn);
    // Tried once, then its next try waits for the signal.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(queryFn).toHaveBeenCalledTimes(1);
    // Failed, and said so: Home draws "Couldn't load your feed" (feed.isError),
    // not "A quiet start" (neither loading nor failed).
    expect(feed.now().isError).toBe(true);
    expect(feed.now().isLoading).toBe(false);
    // Not taken for an answer: a screen that waits for one before saying it
    // is empty (your profile's grid) goes on waiting.
    expect(feed.now().isFetched).toBe(false);

    // Nothing more is tried while there is no signal.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(queryFn).toHaveBeenCalledTimes(1);

    // The signal comes back: read again without anyone pulling to refresh.
    online = true;
    signal(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(feed.now().isError).toBe(false);
    expect(feed.now().data).toEqual(["a photograph"]);
    feed.stop();
  });

  it("before, react-query's own mode left it waiting: neither loading nor failed, so the screen drew its empty state", async () => {
    const before = new QueryClient({ defaultOptions: { queries: { retry: retryRead } } });
    before.mount();
    signal(false);
    const queryFn = vi.fn(async () => ["a photograph"]);
    const feed = onScreen(before, "feed-before", queryFn);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(queryFn).not.toHaveBeenCalled();
    expect(feed.now().isPaused).toBe(true);
    expect(feed.now().isLoading).toBe(false);
    expect(feed.now().isError).toBe(false);
    feed.stop();
    before.unmount();
  });

  it("still reads what is on the phone itself, which needs no signal", async () => {
    signal(false);
    const library = vi.fn(async () => ["IMG_0001"]);
    const page = onScreen(queryClient, "library-on-this-day", library);
    await vi.advanceTimersByTimeAsync(0);
    expect(library).toHaveBeenCalledTimes(1);
    expect(page.now().data).toEqual(["IMG_0001"]);
    expect(page.now().isError).toBe(false);
    page.stop();
  });
});

describe("a screen that has something on it", () => {
  it("keeps it when a refresh fails with no signal, and refreshes once the signal is back", async () => {
    let online = true;
    let round = 0;
    const queryFn = vi.fn(async () => {
      if (!online) throw noSignal();
      round += 1;
      return [`round ${round}`];
    });
    const feed = onScreen(queryClient, "feed-loaded", queryFn);
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.now().data).toEqual(["round 1"]);

    online = false;
    signal(false);
    void feed.refetch();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(feed.now().data).toEqual(["round 1"]);
    expect(feed.now().isError).toBe(false);

    online = true;
    signal(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.now().data).toEqual(["round 2"]);
    feed.stop();
  });
});

describe("a read that fails with a signal", () => {
  it("is still tried again, briefly spaced, as before", async () => {
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
  });

  it("is not marked failed while it only waits for the app to come back to the front", async () => {
    signal(true);
    focusManager.setFocused(false);
    const queryFn = vi.fn(async () => {
      throw noSignal();
    });
    const feed = onScreen(queryClient, "feed-in-background", queryFn);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(feed.now().isPaused).toBe(true);
    expect(feed.now().isError).toBe(false);
    feed.stop();
  });
});
