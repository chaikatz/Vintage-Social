import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfiniteQueryObserver, QueryClient, type InfiniteData } from "@tanstack/query-core";
import {
  AT_TOP_PX,
  FEED_HEAD_SIZE,
  NEW_POSTS_EVERY_MS,
  mergeFreshFirstPage,
  newPostsWatch,
  newerThan,
  newerThanHeld,
  nextLookIn,
  placeFreshFirstPage,
  type HeadRow,
} from "@/media/newPosts";
import { confirmedRow, placeConfirmedPost } from "@/uploads/feedCache";
import type { Cursor } from "@/api/keyset";
import type { PostWithAuthor } from "@/types/db";

/**
 * Home's new posts (src/media/newPosts.ts): when to look, what counts as
 * new, and putting a newly read first page into the pages held without a
 * post twice or one lost. The pages are checked on React Query itself,
 * the same infinite query Home pages its feed with, against a server kept
 * here that pages by cursor as feed_page does.
 */

const PAGE = 12;
const ME = "me";

/** A post `n` seconds into the day, by `author`. Times as the server writes them, with microseconds. */
function post(n: number, author = "friend", id = `p${String(n).padStart(4, "0")}`): PostWithAuthor {
  const at = new Date(Date.UTC(2026, 10, 23, 0, 0, 0) + n * 1000).toISOString().replace("Z", "123+00:00");
  return {
    id,
    author_id: author,
    media_type: "photo",
    media_path: `${author}/${id}.jpg`,
    thumb_path: `${author}/${id}.jpg`,
    width: 1440,
    height: 1080,
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
    created_at: at,
    removed_at: null,
    removed_by: null,
    author: { id: author, username: author, full_name: null, avatar_url: null },
  };
}

/** The server's feed, newest first, and a page of it after a cursor, as feed_page reads it. */
function server(initial: PostWithAuthor[]) {
  let rows = [...initial];
  const sorted = () => [...rows].sort((a, b) => (newerThan(a, b) ? -1 : newerThan(b, a) ? 1 : 0));
  return {
    add(...more: PostWithAuthor[]) {
      rows.push(...more);
    },
    remove(id: string) {
      rows = rows.filter((p) => p.id !== id);
    },
    all: () => sorted(),
    page(before: Cursor | null): PostWithAuthor[] {
      const list = sorted();
      const from = before ? list.findIndex((p) => newerThan({ id: before.id, created_at: before.at }, p)) : 0;
      return from < 0 ? [] : list.slice(from, from + PAGE);
    },
  };
}

function feedOn(db: ReturnType<typeof server>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  const calls: (Cursor | null)[] = [];
  const observer = new InfiniteQueryObserver<PostWithAuthor[], Error, InfiniteData<PostWithAuthor[], Cursor | null>, string[], Cursor | null>(
    client,
    {
      queryKey: ["feed", ME],
      queryFn: async ({ pageParam }) => {
        calls.push(pageParam);
        return db.page(pageParam);
      },
      initialPageParam: null,
      // As src/api/posts.ts nextFeedCursor: a short page ends the feed.
      getNextPageParam: (last) => (last.length < PAGE ? undefined : { at: last[last.length - 1].created_at, id: last[last.length - 1].id }),
    },
  );
  const unsubscribe = observer.subscribe(() => undefined);
  const held = () => (client.getQueryData<InfiniteData<PostWithAuthor[], Cursor | null>>(["feed", ME])?.pages ?? []).flat();
  return { client, observer, calls, unsubscribe, held };
}

const ids = (rows: { id: string }[]) => rows.map((p) => p.id);

describe("when Home looks for new posts", () => {
  it("looks every 45 seconds, counting from the last look or the last read of the feed, whichever is later", () => {
    expect(NEW_POSTS_EVERY_MS).toBe(45_000);
    expect(nextLookIn(1_000_000, 0, 1_000_000)).toBe(45_000);
    expect(nextLookIn(1_000_000, 0, 1_030_000)).toBe(15_000);
    // A refresh is as good as a look.
    expect(nextLookIn(1_000_000, 1_040_000, 1_041_000)).toBe(44_000);
  });

  it("looks at once on coming back after a while, and waits out the rest after a moment", () => {
    expect(nextLookIn(1_000_000, 900_000, 1_000_000 + 10 * 60_000)).toBe(0);
    expect(nextLookIn(1_000_000, 900_000, 1_045_000)).toBe(0);
    expect(nextLookIn(1_000_000, 900_000, 1_005_000)).toBe(40_000);
  });

  it("never waits longer than the interval, and looks at once when nothing is known", () => {
    expect(nextLookIn(0, 0, 5_000)).toBe(0);
    // A time ahead of the clock (a clock set back) still looks within the interval.
    expect(nextLookIn(9_000_000, 0, 1_000_000)).toBe(45_000);
  });

  it("reads only a few of the newest posts", () => {
    expect(FEED_HEAD_SIZE).toBeGreaterThanOrEqual(1);
    expect(FEED_HEAD_SIZE).toBeLessThanOrEqual(5);
    expect(AT_TOP_PX).toBeLessThanOrEqual(8);
  });
});

describe("what counts as new", () => {
  const held = [post(50), post(40), post(30)];
  const head = (rows: PostWithAuthor[]): HeadRow[] => rows.map(({ id, created_at, author_id }) => ({ id, created_at, author_id }));

  it("nothing, when the newest posts are the ones held", () => {
    expect(newerThanHeld(head([post(50), post(40)]), held, ME)).toEqual([]);
  });

  it("a post by someone followed, newer than the top of the feed", () => {
    expect(ids(newerThanHeld(head([post(60), post(50)]), held, ME))).toEqual(["p0060"]);
  });

  it("never the member's own posts: the outbox puts those on top of Home itself", () => {
    expect(newerThanHeld(head([post(70, ME), post(50)]), held, ME)).toEqual([]);
    expect(ids(newerThanHeld(head([post(70, ME), post(60), post(50)]), held, ME))).toEqual(["p0060"]);
  });

  it("not an older post that turns up (a member followed since): that is not new", () => {
    expect(newerThanHeld(head([post(50), post(45, "newly-followed")]), held, ME)).toEqual([]);
  });

  it("measures from the newest post of someone else's held, past an own post with this phone's clock on it", () => {
    // The outbox puts the member's post in with the phone's time, which
    // may run ahead of the server's.
    const own = { ...post(10_000, ME, "mine"), created_at: new Date(Date.UTC(2026, 10, 24)).toISOString() };
    expect(ids(newerThanHeld(head([post(60), post(50)]), [own, ...held], ME))).toEqual(["p0060"]);
  });

  it("anything by someone followed, when the feed held has none of theirs", () => {
    expect(ids(newerThanHeld(head([post(5)]), [], ME))).toEqual(["p0005"]);
    expect(ids(newerThanHeld(head([post(5)]), [post(100, ME, "mine")], ME))).toEqual(["p0005"]);
  });

  it("compares times as instants, whoever wrote them, and by the server's own string within a millisecond", () => {
    expect(newerThan({ id: "a", created_at: "2026-11-23T10:00:01.000Z" }, { id: "b", created_at: "2026-11-23T10:00:00.999999+00:00" })).toBe(true);
    expect(newerThan({ id: "a", created_at: "2026-11-23T10:00:00.123457+00:00" }, { id: "b", created_at: "2026-11-23T10:00:00.123456+00:00" })).toBe(true);
    expect(newerThan({ id: "b", created_at: "2026-11-23T10:00:00.123456+00:00" }, { id: "a", created_at: "2026-11-23T10:00:00.123456+00:00" })).toBe(true);
    expect(newerThan({ id: "a", created_at: "2026-11-23T10:00:00.123456+00:00" }, { id: "a", created_at: "2026-11-23T10:00:00.123456+00:00" })).toBe(false);
  });
});

describe("a newly read first page, put into the pages held", () => {
  const pages = (rows: PostWithAuthor[]): PostWithAuthor[][] => {
    const out: PostWithAuthor[][] = [];
    for (let i = 0; i < rows.length; i += PAGE) out.push(rows.slice(i, i + PAGE));
    return out;
  };
  const feed = Array.from({ length: 36 }, (_, i) => post(1000 - i * 10));
  const held: InfiniteData<PostWithAuthor[], Cursor | null> = {
    pages: pages(feed),
    pageParams: [null, { at: feed[11].created_at, id: feed[11].id }, { at: feed[23].created_at, id: feed[23].id }],
  };

  it("brings the new posts on top, keeps every page below, and has no post twice", () => {
    const fresh = [post(1030), post(1020), post(1010), ...feed.slice(0, 9)];
    const merged = mergeFreshFirstPage(held, fresh, PAGE);
    const flat = merged.pages.flat();
    expect(ids(flat)).toEqual(ids([post(1030), post(1020), post(1010), ...feed]));
    expect(new Set(ids(flat)).size).toBe(flat.length);
    // The pages below the first are the very ones held, with their own cursors.
    expect(merged.pages[1]).toBe(held.pages[1]);
    expect(merged.pages[2]).toBe(held.pages[2]);
    expect(merged.pageParams).toEqual([null, held.pageParams[1], held.pageParams[2]]);
  });

  it("takes the new page's rows for the posts it shares, counts as they are now", () => {
    const liked = { ...feed[0], like_count: 7 };
    const merged = mergeFreshFirstPage(held, [post(1010), liked, ...feed.slice(1, 11)], PAGE);
    expect(merged.pages[0][1]).toBe(liked);
  });

  it("drops a post held above where they meet that the new page no longer has (deleted, reported, hidden)", () => {
    const fresh = [post(1010), ...feed.slice(0, 3), ...feed.slice(4, 12)];
    const merged = mergeFreshFirstPage(held, fresh, PAGE);
    expect(ids(merged.pages.flat())).not.toContain(feed[3].id);
    expect(merged.pages.flat()).toHaveLength(feed.length);
  });

  it("meets further down when posts held were deleted, and keeps the cursors of the pages after", () => {
    // The first page's posts all gone but two: the new page reaches into the second.
    const fresh = [post(1010), feed[0], feed[5], ...feed.slice(12, 21)];
    const merged = mergeFreshFirstPage(held, fresh, PAGE);
    expect(ids(merged.pages[0])).toEqual(ids([...fresh, ...feed.slice(21, 24)]));
    expect(merged.pages.slice(1)).toEqual([held.pages[2]]);
    expect(merged.pageParams).toEqual([null, held.pageParams[2]]);
  });

  it("starts again from the new page alone where the two do not meet (more new posts than a page)", () => {
    const fresh = Array.from({ length: PAGE }, (_, i) => post(2000 - i));
    expect(mergeFreshFirstPage(held, fresh, PAGE)).toEqual({ pages: [fresh], pageParams: [null] });
  });

  it("takes a new page shorter than a page for the whole feed", () => {
    const fresh = [post(1010), feed[0]];
    expect(mergeFreshFirstPage(held, fresh, PAGE)).toEqual({ pages: [fresh], pageParams: [null] });
  });

  it("is the new page alone when nothing was held", () => {
    expect(mergeFreshFirstPage(undefined, [post(1)], PAGE)).toEqual({ pages: [[post(1)]], pageParams: [null] });
    expect(mergeFreshFirstPage({ pages: [], pageParams: [] }, [post(1)], PAGE)).toEqual({ pages: [[post(1)]], pageParams: [null] });
  });
});

describe("the feed, scrolled on after new posts are put in", () => {
  it("reads on from the last post held: every post once, in order, none skipped", async () => {
    const db = server(Array.from({ length: 60 }, (_, i) => post(1000 - i * 10)));
    const { client, observer, calls, unsubscribe, held } = feedOn(db);
    await observer.refetch();
    await observer.fetchNextPage();
    await observer.fetchNextPage();
    expect(held()).toHaveLength(36);

    db.add(post(1100), post(1090), post(1080));
    const readAt = Date.now() + 1;
    vi.setSystemTime(readAt);
    const fresh = db.page(null);
    vi.setSystemTime(readAt + 10);
    expect(await placeFreshFirstPage(client, ["feed", ME], fresh, readAt, PAGE)).toBe("placed");
    expect(held()).toHaveLength(39);
    expect(ids(held().slice(0, 3))).toEqual(["p1100", "p1090", "p1080"]);

    const lastHeld = held()[held().length - 1];
    calls.length = 0;
    while (observer.getCurrentResult().hasNextPage) await observer.fetchNextPage();
    // Read on from the last post held, not from the top again: the posts
    // read are the ones not yet held, each once.
    expect(calls[0]).toEqual({ at: lastHeld.created_at, id: lastHeld.id });
    expect(calls.map((c) => db.page(c).length).reduce((a, b) => a + b, 0)).toBe(db.all().length - 39);
    expect(ids(held())).toEqual(ids(db.all()));
    expect(new Set(ids(held())).size).toBe(held().length);
    unsubscribe();
  });

  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());
});

describe("putting the page in", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("waits for a read of the feed that is out, and then reads again rather than undo it", async () => {
    const db = server(Array.from({ length: 30 }, (_, i) => post(1000 - i * 10)));
    const { client, observer, unsubscribe } = feedOn(db);
    await observer.refetch();
    db.add(post(1100));
    const readAt = Date.now();
    const fresh = db.page(null);
    vi.setSystemTime(readAt + 5);
    // The next page left after the new page was read.
    const next = observer.fetchNextPage();
    const placed = placeFreshFirstPage(client, ["feed", ME], fresh, readAt, PAGE);
    await next;
    expect(await placed).toBe("stale");
    unsubscribe();
  });

  it("does not put back a post the member deleted after it was read", async () => {
    const db = server(Array.from({ length: 30 }, (_, i) => post(1000 - i * 10)));
    const { client, observer, unsubscribe, held } = feedOn(db);
    await observer.refetch();
    db.add(post(1100));
    const readAt = Date.now();
    const fresh = db.page(null);
    vi.setSystemTime(readAt + 5);
    // Deleted here meanwhile (src/utils/postCache.ts removePostEverywhere writes the feed anew).
    client.setQueryData<InfiniteData<PostWithAuthor[], Cursor | null>>(["feed", ME], (d) =>
      d ? { ...d, pages: d.pages.map((page) => page.filter((p) => p.id !== "p1000")) } : d,
    );
    expect(await placeFreshFirstPage(client, ["feed", ME], fresh, readAt, PAGE)).toBe("stale");
    expect(ids(held())).not.toContain("p1000");
    unsubscribe();
  });

  it("does not undo the member's own post, put in by the outbox after the page was read", async () => {
    const db = server(Array.from({ length: 30 }, (_, i) => post(1000 - i * 10)));
    const { client, observer, unsubscribe, held } = feedOn(db);
    await observer.refetch();
    const readAt = Date.now();
    const fresh = db.page(null);
    vi.setSystemTime(readAt + 5);
    const mine = post(2000, ME, "mine");
    await placeConfirmedPost(client as never, ME, confirmedRow({
      draft: {
        id: mine.id,
        userId: ME,
        kind: "photo",
        filterId: "none",
        showDateStamp: false,
        caption: "",
        takenAt: null,
        location: null,
        lat: null,
        lng: null,
        placeId: null,
        author: mine.author,
      } as never,
      prepared: { width: 1, height: 1, baked: true, duration: null } as never,
      mediaUri: "file:///mine.jpg",
      thumbUri: null,
      createdAt: new Date().toISOString(),
    }));
    expect(held()[0].id).toBe("mine");
    expect(await placeFreshFirstPage(client, ["feed", ME], fresh, readAt, PAGE)).toBe("stale");
    expect(held()[0].id).toBe("mine");
    unsubscribe();
  });

  it("is gone when the feed is no longer held (signed out)", async () => {
    const client = new QueryClient();
    expect(await placeFreshFirstPage(client, ["feed", ME], [post(1)], Date.now(), PAGE)).toBe("gone");
  });
});

describe("the looks' timing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function watcher(feedReadAt = () => 0, look = vi.fn(async () => undefined)) {
    const watch = newPostsWatch({ look, feedReadAt });
    return { watch, look };
  }

  it("never looks while not watching (Home out of sight, the app away, no signal), however long", async () => {
    const { look } = watcher();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(look).not.toHaveBeenCalled();
  });

  it("looks every interval while watching, and stops when it no longer is", async () => {
    const { watch, look } = watcher(() => Date.now());
    watch.watch(true);
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS - 1);
    expect(look).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(look).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS);
    expect(look).toHaveBeenCalledTimes(2);
    watch.watch(false);
    await vi.advanceTimersByTimeAsync(10 * NEW_POSTS_EVERY_MS);
    expect(look).toHaveBeenCalledTimes(2);
    watch.stop();
  });

  it("looks at once on being watched again after a while, and not before the interval after a moment", async () => {
    const loaded = Date.now();
    const { watch, look } = watcher(() => loaded);
    watch.watch(true);
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS);
    expect(look).toHaveBeenCalledTimes(1);
    watch.watch(false);
    await vi.advanceTimersByTimeAsync(10_000);
    watch.watch(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(look).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS - 10_000);
    expect(look).toHaveBeenCalledTimes(2);
    watch.watch(false);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    watch.watch(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(look).toHaveBeenCalledTimes(3);
    watch.stop();
  });

  it("counts a read of the feed itself as a look", async () => {
    let readAt = Date.now();
    const { watch, look } = watcher(() => readAt);
    watch.watch(true);
    await vi.advanceTimersByTimeAsync(30_000);
    // Pulled to refresh: the feed was read just now.
    readAt = Date.now();
    watch.watch(false);
    watch.watch(true);
    await vi.advanceTimersByTimeAsync(NEW_POSTS_EVERY_MS - 1);
    expect(look).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(look).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it("has one look out at a time, however slow, and goes on after one that fails", async () => {
    let open = 0;
    let most = 0;
    let n = 0;
    const look = vi.fn(async () => {
      open++;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 3 * NEW_POSTS_EVERY_MS));
      open--;
      if (++n === 1) throw new Error("Network request failed");
    });
    const watch = newPostsWatch({ look, feedReadAt: () => 0 });
    watch.watch(true);
    await vi.advanceTimersByTimeAsync(20 * NEW_POSTS_EVERY_MS);
    expect(most).toBe(1);
    expect(look.mock.calls.length).toBeGreaterThanOrEqual(3);
    watch.stop();
  });

  it("schedules nothing once stopped, even when a look still out comes back", async () => {
    let finish!: () => void;
    const look = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const watch = newPostsWatch({ look, feedReadAt: () => 0 });
    watch.watch(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(look).toHaveBeenCalledTimes(1);
    watch.stop();
    finish();
    await vi.advanceTimersByTimeAsync(10 * NEW_POSTS_EVERY_MS);
    expect(look).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
