import { describe, expect, it } from "vitest";
import { QueryClient, QueryObserver, type InfiniteData } from "@tanstack/react-query";
import { removePostEverywhere, removeValue, rewriteValue } from "@/utils/postCache";

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

describe("taking one deleted post out of a cached list", () => {
  it("drops it from a flat list and keeps the others as they were", () => {
    const list = [post("a", "x"), post("b", "y"), post("c", "z")];
    const out = removeValue(list, "b") as typeof list;
    expect(out.map((p) => p.id)).toEqual(["a", "c"]);
    expect(out[0]).toBe(list[0]);
    expect(list).toHaveLength(3);
  });

  it("drops it from whichever page of the feed holds it, and every page keeps its place", () => {
    const feed = { pages: [[post("a", "x")], [post("b", "y")], [post("c", "z")]], pageParams: [0, 1, 2] };
    const out = removeValue(feed, "b") as typeof feed;
    expect(out.pages.map((page) => page.map((p) => p.id))).toEqual([["a"], [], ["c"]]);
    expect(out.pageParams).toBe(feed.pageParams);
    expect(out.pages[0]).toBe(feed.pages[0]);
    expect(out.pages[2]).toBe(feed.pages[2]);
  });

  it("returns the very same value when the post is not there, so nothing re-renders", () => {
    const list = [post("a", "x")];
    const feed = { pages: [[post("a", "x")]], pageParams: [0] };
    expect(removeValue(list, "zzz")).toBe(list);
    expect(removeValue(feed, "zzz")).toBe(feed);
    expect(removeValue(undefined, "a")).toBeUndefined();
    expect(removeValue(null, "a")).toBeNull();
  });

  it("does not take out a profile or a comment that happens to share the id", () => {
    const people = [{ id: "a", username: "ann" }];
    expect(removeValue(people, "a")).toBe(people);
    const one = post("a", "x");
    expect(removeValue(one, "a")).toBe(one);
  });
});

describe("a deleted post, gone from every screen at once", () => {
  type Row = ReturnType<typeof post>;
  const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const ids = (rows: Row[] | undefined) => (rows ?? []).map((p) => p.id);

  it("leaves the feed, every grid, the tagged photographs and explore, and nothing else in them", async () => {
    const qc = client();
    qc.setQueryData<InfiniteData<Row[]>>(["feed", "u1"], { pages: [[post("gone", "x"), post("a", "y")], [post("b", "z")]], pageParams: [0, 1] });
    qc.setQueryData<Row[]>(["user-posts", "u1"], [post("gone", "x"), post("c", "y")]);
    qc.setQueryData<Row[]>(["user-posts", "u2"], [post("d", "y")]);
    qc.setQueryData<Row[]>(["tagged-posts", "u3"], [post("gone", "x"), post("e", "y")]);
    qc.setQueryData<Row[]>(["explore", "u4"], [post("f", "y"), post("gone", "x")]);
    const untouched = qc.getQueryData(["user-posts", "u2"]);

    await removePostEverywhere(qc, "gone");

    const feed = qc.getQueryData<InfiniteData<Row[]>>(["feed", "u1"])!;
    expect(feed.pages.map((page) => ids(page))).toEqual([["a"], ["b"]]);
    expect(ids(qc.getQueryData<Row[]>(["user-posts", "u1"]))).toEqual(["c"]);
    expect(qc.getQueryData(["user-posts", "u2"])).toBe(untouched);
    expect(ids(qc.getQueryData<Row[]>(["tagged-posts", "u3"]))).toEqual(["e"]);
    expect(ids(qc.getQueryData<Row[]>(["explore", "u4"]))).toEqual(["f"]);
    // And each is read again, to confirm it, the next time it is shown.
    for (const key of [["feed", "u1"], ["user-posts", "u1"], ["tagged-posts", "u3"], ["explore", "u4"]]) {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("reads the messages, the inbox and the notices again, and lets go of what was only about the post", async () => {
    const qc = client();
    qc.setQueryData(["messages", "convo-1"], [{ id: "m1", body: "", post_id: "gone" }]);
    qc.setQueryData(["conversations", "u1"], []);
    qc.setQueryData(["activity", "u1"], []);
    qc.setQueryData(["comments", "gone"], [{ id: "c1" }]);
    qc.setQueryData(["post-tags", "gone"], []);
    qc.setQueryData(["share-link", "gone", "u1"], "token");
    qc.setQueryData(["comments", "kept"], [{ id: "c2" }]);
    qc.setQueryData(["comment-previews", "gone,kept"], {});

    await removePostEverywhere(qc, "gone");

    expect(qc.getQueryState(["messages", "convo-1"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["conversations", "u1"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["activity", "u1"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["comments", "gone"])).toBeUndefined();
    expect(qc.getQueryState(["post-tags", "gone"])).toBeUndefined();
    expect(qc.getQueryState(["share-link", "gone", "u1"])).toBeUndefined();
    expect(qc.getQueryData(["comments", "kept"])).toEqual([{ id: "c2" }]);
    // Keyed by the ids on screen: the next read asks for a new key by itself.
    expect(qc.getQueryState(["comment-previews", "gone,kept"])?.isInvalidated).toBe(false);
  });

  it("sets its own page to gone at once when nothing is showing it", async () => {
    const qc = client();
    qc.setQueryData(["post", "gone"], post("gone", "x"));
    await removePostEverywhere(qc, "gone");
    expect(qc.getQueryData(["post", "gone"])).toBeNull();
  });

  it("leaves its own page as it is while that page is still on screen, and only then says it is gone", async () => {
    const qc = client();
    const shown = post("gone", "x");
    qc.setQueryData(["post", "gone"], shown);
    let fetched = 0;
    const page = new QueryObserver(qc, {
      queryKey: ["post", "gone"],
      queryFn: async () => {
        fetched += 1;
        return null;
      },
    });
    const leave = page.subscribe(() => undefined);

    await removePostEverywhere(qc, "gone");
    // Still sliding away: no refetch, no "This photograph is gone" flash.
    expect(qc.getQueryData(["post", "gone"])).toBe(shown);
    expect(fetched).toBe(0);

    leave();
    expect(qc.getQueryData(["post", "gone"])).toBeNull();
  });

  it("does not let a read that left before the delete put the post back, on screen or not", async () => {
    const qc = client();
    let server = [post("gone", "x"), post("a", "y")];
    let release!: () => void;
    let gate = Promise.resolve();
    const read = async () => {
      const answer = [...server];
      await gate;
      return answer;
    };
    // On screen: the profile's grid. Not on screen: a gallery's, read in passing.
    const grid = new QueryObserver<Row[]>(qc, { queryKey: ["user-posts", "u1"], queryFn: read });
    const leave = grid.subscribe(() => undefined);
    await grid.refetch();
    qc.setQueryData<Row[]>(["user-posts", "u9"], [...server]);

    // Both read again before the delete, and still on their way.
    gate = new Promise<void>((r) => (release = r));
    const onScreen = grid.refetch();
    const offScreen = qc.fetchQuery({ queryKey: ["user-posts", "u9"], queryFn: read, staleTime: 0 });
    await Promise.resolve();
    server = server.filter((p) => p.id !== "gone");

    await removePostEverywhere(qc, "gone");
    expect(ids(qc.getQueryData<Row[]>(["user-posts", "u1"]))).toEqual(["a"]);
    expect(ids(qc.getQueryData<Row[]>(["user-posts", "u9"]))).toEqual(["a"]);
    release();
    await Promise.allSettled([onScreen, offScreen]);
    await new Promise((r) => setTimeout(r, 0));
    expect(ids(qc.getQueryData<Row[]>(["user-posts", "u1"]))).toEqual(["a"]);
    expect(ids(qc.getQueryData<Row[]>(["user-posts", "u9"]))).toEqual(["a"]);
    leave();
  });
});
