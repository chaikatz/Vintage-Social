import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, type InfiniteData } from "@tanstack/query-core";
import type { PostWithAuthor } from "@/types/db";

/**
 * Home's new posts, run (src/hooks/useNewPosts.ts): the hook on a small
 * stand-in for React's hooks (one component, drawn again on every change
 * of its state, effects cleaned up when their inputs change), with the
 * feed in React Query's own cache, the app's focus and signal as
 * react-query hears them, and the two reads (the newest few posts, the
 * newest page) counted.
 */

const harness = vi.hoisted(() => {
  type Effect = { deps: unknown[] | undefined; cleanup?: void | (() => void) };
  const slots: unknown[] = [];
  const effects: Effect[] = [];
  let index = 0;
  let effectIndex = 0;
  let pending: (() => void)[] = [];
  let rerender: (() => void) | null = null;
  const changed = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const react = {
    useState<T>(initial: T | (() => T)) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? (initial as () => T)() : initial;
      const set = (next: T | ((prev: T) => T)) => {
        const value = typeof next === "function" ? (next as (prev: T) => T)(slots[i] as T) : next;
        if (Object.is(value, slots[i])) return;
        slots[i] = value;
        rerender?.();
      };
      return [slots[i] as T, set] as const;
    },
    useRef<T>(initial: T) {
      const i = index++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i] as { current: T };
    },
    useCallback<T>(fn: T, deps: unknown[]) {
      const i = index++;
      const last = slots[i] as { fn: T; deps: unknown[] } | undefined;
      if (!last || changed(last.deps, deps)) slots[i] = { fn, deps };
      return (slots[i] as { fn: T }).fn;
    },
    useMemo<T>(fn: () => T, deps: unknown[]) {
      const i = index++;
      const last = slots[i] as { value: T; deps: unknown[] } | undefined;
      if (!last || changed(last.deps, deps)) slots[i] = { value: fn(), deps };
      return (slots[i] as { value: T }).value;
    },
    useEffect(fn: () => void | (() => void), deps?: unknown[]) {
      const i = effectIndex++;
      const last = effects[i];
      if (!last || changed(last.deps, deps)) {
        pending.push(() => {
          if (last?.cleanup) last.cleanup();
          effects[i] = { deps, cleanup: fn() };
        });
      }
    },
  };
  return {
    react,
    mount<T>(hook: () => T) {
      let result!: T;
      let rendering = false;
      let again = false;
      const run = () => {
        if (rendering) {
          again = true;
          return;
        }
        rendering = true;
        do {
          again = false;
          index = 0;
          effectIndex = 0;
          pending = [];
          result = hook();
        } while (again);
        rendering = false;
        for (const e of pending) e();
      };
      rerender = run;
      run();
      return {
        get current() {
          return result;
        },
        render: run,
        unmount() {
          for (const e of effects) if (e?.cleanup) e.cleanup();
          rerender = null;
        },
      };
    },
    reset() {
      slots.length = 0;
      effects.length = 0;
      rerender = null;
    },
  };
});
vi.mock("react", () => harness.react);

/** The app in front, and the signal, as react-query's managers tell of a change. */
const rq = vi.hoisted(() => {
  const manager = () => {
    const listeners = new Set<(v: boolean) => void>();
    let value = true;
    return {
      get value() {
        return value;
      },
      subscribe(listener: (v: boolean) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      set(next: boolean) {
        if (next === value) return;
        value = next;
        for (const l of [...listeners]) l(next);
      },
      reset() {
        listeners.clear();
        value = true;
      },
    };
  };
  const state = { client: null as unknown, focus: manager(), online: manager() };
  return state;
});
vi.mock("@tanstack/react-query", () => ({
  focusManager: { isFocused: () => rq.focus.value, subscribe: (l: (v: boolean) => void) => rq.focus.subscribe(l) },
  onlineManager: { isOnline: () => rq.online.value, subscribe: (l: (v: boolean) => void) => rq.online.subscribe(l) },
  useQueryClient: () => rq.client,
}));

/** The server, as the two reads see it. */
const api = vi.hoisted(() => ({
  head: [] as { id: string; created_at: string; author_id: string }[],
  page: [] as unknown[],
  heads: 0,
  pages: 0,
}));
vi.mock("@/api/posts", () => ({
  FEED_PAGE_SIZE: 12,
  fetchFeedHead: async () => {
    api.heads++;
    return api.head;
  },
  fetchFeedPage: async () => {
    api.pages++;
    return api.page;
  },
}));
const prefetched = vi.hoisted(() => [] as { id: string }[][]);
vi.mock("@/media/prefetch", () => ({ prefetchNewPosts: (posts: { id: string }[]) => prefetched.push(posts) }));

import { NEW_POSTS_SETTLE_MS, useNewPosts } from "@/hooks/useNewPosts";
import { NEW_POSTS_EVERY_MS } from "@/media/newPosts";
import { emitHomeAgain } from "@/utils/homeRefresh";

const ME = "me";
function post(n: number, author = "friend"): PostWithAuthor {
  const id = `p${String(n).padStart(4, "0")}`;
  return {
    id,
    author_id: author,
    media_type: "photo",
    media_path: `${author}/${id}.jpg`,
    thumb_path: `${author}/${id}.jpg`,
    width: 1,
    height: 1,
    duration_seconds: null,
    filter_id: "none",
    filter_baked: true,
    show_date_stamp: false,
    caption: "",
    taken_at: null,
    location: null,
    lat: null,
    lng: null,
    place_id: null,
    like_count: 0,
    comment_count: 0,
    created_at: new Date(Date.UTC(2026, 10, 23) + n * 1000).toISOString().replace("Z", "000+00:00"),
    removed_at: null,
    removed_by: null,
    author: { id: author, username: author, full_name: null, avatar_url: null },
  };
}
const head = (p: PostWithAuthor) => ({ id: p.id, created_at: p.created_at, author_id: p.author_id });

const feed = Array.from({ length: 24 }, (_, i) => post(1000 - i * 10));
const fresh = post(2000);

function setup({ focused = true, top = true } = {}) {
  const client = new QueryClient();
  rq.client = client;
  client.setQueryData<InfiniteData<PostWithAuthor[], unknown>>(["feed", ME], {
    pages: [feed.slice(0, 12), feed.slice(12)],
    pageParams: [null, { at: feed[11].created_at, id: feed[11].id }],
  });
  const flat = () => (client.getQueryData<InfiniteData<PostWithAuthor[], unknown>>(["feed", ME])?.pages ?? []).flat();
  const view = { top, toTop: vi.fn() };
  let props = { userId: ME, posts: flat(), focused, hasFeed: true, atTop: () => view.top, toTop: view.toTop };
  const hook = harness.mount(() => useNewPosts(props));
  // Home draws again with the feed as the cache holds it.
  client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const posts = flat();
    if (posts === props.posts) return;
    props = { ...props, posts };
    hook.render();
  });
  const focus = (next: boolean) => {
    props = { ...props, focused: next };
    hook.render();
  };
  return { client, hook, view, flat, focus };
}

beforeEach(() => {
  vi.useFakeTimers();
  harness.reset();
  rq.focus.reset();
  rq.online.reset();
  api.head = [head(feed[0]), head(feed[1])];
  api.page = feed.slice(0, 12);
  api.heads = 0;
  api.pages = 0;
  prefetched.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Home's look for new posts", () => {
  it("looks only while Home is in front, the app is in front and there is a signal", async () => {
    const { hook, focus } = setup({ focused: false });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(api.heads).toBe(0);
    focus(true);
    // Home came back after a while: it looks at once.
    await vi.advanceTimersByTimeAsync(0);
    expect(api.heads).toBe(1);
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS);
    expect(api.heads).toBe(2);
    // The app goes to the background: nothing.
    rq.focus.set(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(api.heads).toBe(2);
    rq.focus.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.heads).toBe(3);
    // No signal: nothing.
    rq.online.set(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(api.heads).toBe(3);
    // Another screen over Home: nothing.
    rq.online.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.heads).toBe(4);
    focus(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(api.heads).toBe(4);
    hook.unmount();
  });

  it("is one small read when nothing is new, and no page", async () => {
    const { hook } = setup();
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS);
    expect(api.heads).toBe(1);
    expect(api.pages).toBe(0);
    expect(hook.current.waiting).toBe(false);
    hook.unmount();
  });

  it("puts new posts in place for a member at the very top who is not touching the list", async () => {
    const { hook, flat } = setup({ top: true });
    api.head = [head(fresh), head(feed[0])];
    api.page = [fresh, ...feed.slice(0, 11)];
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS);
    expect(api.pages).toBe(1);
    expect(flat()[0].id).toBe(fresh.id);
    expect(flat()).toHaveLength(25);
    expect(new Set(flat().map((p) => p.id)).size).toBe(25);
    expect(hook.current.waiting).toBe(false);
    hook.unmount();
  });

  it("holds them behind the tag for a member further down, their pictures fetched, and puts them in at the top when it is tapped", async () => {
    const { hook, view, flat } = setup({ top: false });
    api.head = [head(fresh), head(feed[0])];
    api.page = [fresh, ...feed.slice(0, 11)];
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS);
    expect(hook.current.waiting).toBe(true);
    expect(flat()[0].id).toBe(feed[0].id);
    expect(prefetched.map((posts) => posts.map((p) => p.id))).toEqual([[fresh.id]]);

    // Looked again with the tag up: the page held covers it; no page read again.
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS);
    expect(api.heads).toBe(2);
    expect(api.pages).toBe(1);

    hook.current.showNew();
    expect(view.toTop).toHaveBeenCalledTimes(1);
    expect(hook.current.waiting).toBe(false);
    // Put in once the list is back at the top, from the page held.
    await vi.advanceTimersByTimeAsync(NEW_POSTS_SETTLE_MS - 1);
    expect(flat()[0].id).toBe(feed[0].id);
    await vi.advanceTimersByTimeAsync(1);
    expect(flat()[0].id).toBe(fresh.id);
    expect(api.pages).toBe(1);
    hook.unmount();
  });

  it("reads the page again on a tap when the feed changed since it was read", async () => {
    const { hook, client, flat } = setup({ top: false });
    api.head = [head(fresh), head(feed[0])];
    api.page = [fresh, ...feed.slice(0, 11)];
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS);
    expect(hook.current.waiting).toBe(true);
    // A post deleted here meanwhile writes the feed anew.
    await vi.advanceTimersByTimeAsync(1_000);
    client.setQueryData<InfiniteData<PostWithAuthor[], unknown>>(["feed", ME], (d) =>
      d ? { ...d, pages: d.pages.map((page) => page.filter((p) => p.id !== feed[3].id)) } : d,
    );
    api.page = [fresh, ...feed.slice(0, 3), ...feed.slice(4, 12)];
    hook.current.showNew();
    await vi.advanceTimersByTimeAsync(NEW_POSTS_SETTLE_MS);
    expect(api.pages).toBe(2);
    expect(flat()[0].id).toBe(fresh.id);
    expect(flat().map((p) => p.id)).not.toContain(feed[3].id);
    hook.unmount();
  });

  it("never announces the member's own posts", async () => {
    const { hook } = setup({ top: false });
    api.head = [head(post(3000, ME)), head(feed[0])];
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS);
    expect(api.pages).toBe(0);
    expect(hook.current.waiting).toBe(false);
    hook.unmount();
  });

  it("leaves the look to a read of the feed already out", async () => {
    const { hook, client } = setup();
    client.getQueryCache().find({ queryKey: ["feed", ME] })!.setState({ fetchStatus: "fetching" });
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS);
    expect(api.heads).toBe(0);
    hook.unmount();
  });

  it("takes the tag away when a refresh brings the posts, or Home is tapped again", async () => {
    const { hook, client } = setup({ top: false });
    api.head = [head(fresh), head(feed[0])];
    api.page = [fresh, ...feed.slice(0, 11)];
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS);
    expect(hook.current.waiting).toBe(true);
    client.setQueryData<InfiniteData<PostWithAuthor[], unknown>>(["feed", ME], { pages: [[fresh, ...feed.slice(0, 11)]], pageParams: [null] });
    expect(hook.current.waiting).toBe(false);

    api.head = [head(post(2100)), head(fresh)];
    api.page = [post(2100), fresh, ...feed.slice(0, 10)];
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS);
    expect(hook.current.waiting).toBe(true);
    emitHomeAgain();
    expect(hook.current.waiting).toBe(false);
    hook.unmount();
  });

  it("stops looking when Home goes", async () => {
    const { hook } = setup();
    hook.unmount();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(api.heads).toBe(0);
  });
});
