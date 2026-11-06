import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the app asks the database for, as the real client sends it.
 *
 * The client here is the real supabase-js, pointed at a fetch that writes
 * down every request and answers from a small club kept in memory, the
 * way PostgREST would for the handful of query shapes these reads use
 * (filters eq / neq / in / is, order, limit, and an embedded resource's
 * own order and limit, which PostgREST applies per parent row). So these
 * check the requests themselves - how many, how long their URLs are, what
 * they ask for - and that what each function gives back is what it gave
 * back before, worked out the old way from the same rows.
 *
 * PostgREST itself does not run here; the shapes it is sent are the ones
 * its documentation gives for each feature.
 */

const h = vi.hoisted(() => ({
  requests: [] as { url: URL; method: string }[],
  inFlight: 0,
  maxInFlight: 0,
  tables: {} as Record<string, Record<string, unknown>[]>,
  /**
   * How feed_page answers: as the database would, as if not there yet,
   * with a failure, or with its rows in some other order than the
   * function's (nothing promises the function's order survives the query
   * PostgREST wraps around it to join the author).
   */
  feedPage: "there" as "there" | "missing" | "broken" | "unordered",
}));

vi.mock("@/lib/env", () => ({
  isDemoMode: () => false,
  isSupabaseConfigured: () => true,
  requireEnv: () => ({ supabaseUrl: "https://proj.supabase.co", supabaseAnonKey: "anon-key" }),
}));

// ---------------------------------------------------------------------------
// A PostgREST of the few shapes used here
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

/** Split PostgREST's in.(a,b,"c") list. */
function inList(value: string): string[] {
  return value.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
}

function matches(row: Row, column: string, filter: string): boolean {
  const [op, ...rest] = filter.split(".");
  const value = rest.join(".");
  const cell = row[column];
  if (op === "eq") return String(cell) === value;
  if (op === "neq") return String(cell) !== value;
  if (op === "in") return inList(value).includes(String(cell));
  if (op === "is") return value === "null" ? cell == null : String(cell) === value;
  throw new Error(`filter not modelled: ${column}=${filter}`);
}

function ordered(rows: Row[], spec: string | null): Row[] {
  if (!spec) return rows;
  const keys = spec.split(",").map((k) => k.split("."));
  return [...rows].sort((a, b) => {
    for (const [column, direction] of keys) {
      const c = String(a[column]).localeCompare(String(b[column]));
      if (c !== 0) return direction === "desc" ? -c : c;
    }
    return 0;
  });
}

/** The embedded resources a select names: alias, table, and its own select. */
function embeds(select: string): { key: string; table: string; fk: string | null; inner: string }[] {
  const out: { key: string; table: string; fk: string | null; inner: string }[] = [];
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < select.length; i++) {
    if (select[i] === "(") depth++;
    if (select[i] === ")") depth--;
    if (select[i] === "," && depth === 0) {
      parts.push(select.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(select.slice(start));
  for (const part of parts.map((p) => p.trim())) {
    const m = /^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/.exec(part);
    if (m) out.push({ key: m[1] ?? m[2], table: m[2], fk: m[3] ?? null, inner: m[4] });
  }
  return out;
}

/** How a child table points at its parent, for the embeds used here. */
const LINKS: Record<string, { child: string; parent: string; childColumn: string; parentColumn: string }> = {
  comments_post_id_fkey: { child: "comments", parent: "posts", childColumn: "post_id", parentColumn: "id" },
  messages_conversation_id_fkey: { child: "messages", parent: "conversations", childColumn: "conversation_id", parentColumn: "id" },
  comments_author_id_fkey: { child: "comments", parent: "profiles", childColumn: "author_id", parentColumn: "id" },
  posts_author_id_fkey: { child: "posts", parent: "profiles", childColumn: "author_id", parentColumn: "id" },
};

function answer(url: URL): Row[] {
  const table = url.pathname.replace("/rest/v1/", "");
  const params = url.searchParams;
  let rows = (h.tables[table] ?? []).slice();
  const select = params.get("select") ?? "*";
  const nested = embeds(select);
  for (const [key, value] of params) {
    if (["select", "order", "limit", "offset"].includes(key) || key.includes(".")) continue;
    if (key === "or") {
      const alternatives = value.replace(/^\(|\)$/g, "").split(",").map((a) => {
        const [column, ...f] = a.split(".");
        return [column, f.join(".")];
      });
      rows = rows.filter((r) => alternatives.some(([c, f]) => matches(r, c, f)));
      continue;
    }
    rows = rows.filter((r) => matches(r, key, value));
  }
  rows = ordered(rows, params.get("order"));
  const limit = params.get("limit");
  const offset = Number(params.get("offset") ?? 0);
  rows = rows.slice(offset, offset + Math.min(limit ? Number(limit) : Infinity, 1000));
  return rows.map((row) => {
    const out: Row = select === "*" || select.startsWith("*") ? { ...row } : {};
    for (const column of select.split(",").map((c) => c.trim()).filter((c) => /^\w+$/.test(c))) out[column] = row[column];
    for (const e of nested) {
      const link = e.fk ? LINKS[e.fk] : null;
      if (!link) throw new Error(`embed not modelled: ${e.table}`);
      if (link.child === e.table) {
        let children = (h.tables[e.table] ?? []).filter((c) => c[link.childColumn] === row[link.parentColumn]);
        for (const [key, value] of params) {
          if (!key.startsWith(`${e.key}.`)) continue;
          const column = key.slice(e.key.length + 1);
          if (column === "order") children = ordered(children, value);
          else if (column === "limit") children = children.slice(0, Number(value));
          else children = children.filter((c) => matches(c, column, value));
        }
        out[e.key] = children.map((c) => {
          const copy: Row = { ...c };
          for (const inner of embeds(e.inner)) {
            const innerLink = inner.fk ? LINKS[inner.fk] : null;
            if (!innerLink) throw new Error(`embed not modelled: ${inner.table}`);
            copy[inner.key] = (h.tables[innerLink.parent] ?? []).find((p) => p[innerLink.parentColumn] === c[innerLink.childColumn]) ?? null;
          }
          return copy;
        });
      } else {
        out[e.key] = (h.tables[link.parent] ?? []).find((p) => p[link.parentColumn] === row[link.childColumn]) ?? null;
      }
    }
    return out;
  });
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  h.requests.push({ url, method: init?.method ?? "GET" });
  h.inFlight++;
  h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
  await new Promise((r) => setTimeout(r, 1));
  h.inFlight--;
  // The ceiling the gateway sets on a request line.
  if (url.href.length > 8192) return new Response("URI Too Long", { status: 414 });
  if (url.pathname === "/rest/v1/rpc/feed_page") return feedPage(url, JSON.parse(String(init?.body ?? "{}")));
  return new Response(JSON.stringify(answer(url)), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** feed_page (0025) as the database answers it for the signed-in member, ME. */
function feedPage(url: URL, args: { p_limit?: number; p_offset?: number }): Response {
  if (h.feedPage === "missing") {
    return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function public.feed_page" }), { status: 404 });
  }
  if (h.feedPage === "broken") {
    return new Response(JSON.stringify({ code: "57014", message: "canceling statement due to statement timeout" }), { status: 500 });
  }
  const followed = new Set((h.tables.follows ?? []).filter((f) => f.follower_id === ME && f.status === "accepted").map((f) => f.followee_id));
  const mine = (h.tables.posts ?? [])
    .filter((p) => p.removed_at == null && (p.author_id === ME || followed.has(p.author_id)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)));
  let page = mine.slice(args.p_offset ?? 0, (args.p_offset ?? 0) + Math.min(Math.max(args.p_limit ?? 12, 1), 100));
  if (h.feedPage === "unordered") page = [...page.filter((_, i) => i % 2 === 1), ...page.filter((_, i) => i % 2 === 0)];
  // The select (and its embedded author) applies to the function's rows as to a table's.
  h.tables.__feed = page;
  const shaped = answer(new URL(url.href.replace("/rest/v1/rpc/feed_page", "/rest/v1/__feed")));
  return new Response(JSON.stringify(shaped), { status: 200, headers: { "Content-Type": "application/json" } });
}

vi.mock("@/lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient("https://proj.supabase.co", "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fakeFetch as typeof fetch },
    }),
  };
});

const posts = await import("@/api/posts");
const tags = await import("@/api/tags");
const messages = await import("@/api/messages");
const { readInChunks, chunked, IDS_PER_REQUEST } = await import("@/api/batch");

const ME = "00000000-0000-4000-8000-000000000001";
const id = (prefix: string, n: number) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

beforeEach(() => {
  h.requests.length = 0;
  h.inFlight = 0;
  h.maxInFlight = 0;
  h.tables = {};
  h.feedPage = "there";
  (posts as { forgetFeedPageMissing?: () => void }).forgetFeedPageMissing?.();
  // Optional so an older messages.ts (a mutation check) still loads.
  (messages as { forgetSharedPosts?: () => void }).forgetSharedPosts?.();
});

describe("a long list of ids goes in requests a gateway accepts", () => {
  it("splits, keeps first order, drops repeats", () => {
    expect(chunked(["a", "b", "a", "c", "d"], 2)).toEqual([["a", "b"], ["c", "d"]]);
    expect(chunked([], 2)).toEqual([]);
  });

  it("asks a few chunks at a time, and gives the answers back in order", async () => {
    let open = 0;
    let most = 0;
    const out = await readInChunks(Array.from({ length: 1000 }, (_, i) => i), async (chunk) => {
      open++;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 1));
      open--;
      return [chunk[0]];
    });
    expect(out).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(most).toBe(4);
  });

  it("which of 1,000 photographs I liked: ten requests, none too long, every like found", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => id("aa", i));
    h.tables.likes = ids.filter((_, i) => i % 7 === 0).map((post_id) => ({ post_id, user_id: ME }));
    const liked = await posts.fetchMyLikes(ME, ids);
    expect(liked.size).toBe(h.tables.likes.length);
    expect(h.requests.length).toBe(10);
    for (const r of h.requests) {
      expect(r.url.href.length).toBeLessThan(8192 / 2);
      expect(inList(r.url.searchParams.get("post_id")!.slice(3)).length).toBeLessThanOrEqual(IDS_PER_REQUEST);
    }
  });

  it("the same list in one request, as it was, is refused by the gateway", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => id("aa", i));
    const params = new URLSearchParams({ select: "post_id", user_id: `eq.${ME}`, post_id: `in.(${ids.join(",")})` });
    expect(`https://proj.supabase.co/rest/v1/likes?${params}`.length).toBeGreaterThan(8192);
    // And it did not take a thousand: a few hundred is enough.
    const few = ids.slice(0, 220);
    const p2 = new URLSearchParams({ select: "post_id", user_id: `eq.${ME}`, post_id: `in.(${few.join(",")})` });
    expect(`https://proj.supabase.co/rest/v1/likes?${p2}`.length).toBeGreaterThan(8192);
  });

  it("where I am tagged, across 250 photographs", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => id("ab", i));
    h.tables.post_tags = [
      { post_id: ids[3], user_id: ME, status: "pending" },
      { post_id: ids[240], user_id: ME, status: "accepted" },
      { post_id: ids[5], user_id: "someone-else", status: "accepted" },
    ];
    expect(await tags.fetchMyTagStatus(ME, ids)).toEqual({ [ids[3]]: "pending", [ids[240]]: "accepted" });
    expect(h.requests.length).toBe(3);
  });
});

describe("the comment previews under each photograph", () => {
  function club() {
    const postIds = Array.from({ length: 150 }, (_, i) => id("ba", i));
    h.tables.posts = postIds.map((pid) => ({ id: pid }));
    h.tables.profiles = [{ id: ME, username: "me", avatar_url: null }];
    h.tables.comments = [];
    // A busy photograph, a quiet one, one with a removed comment, and most with none.
    for (let n = 0; n < 1200; n++) {
      h.tables.comments.push({ id: id("bc", n), post_id: postIds[0], author_id: ME, body: `c${n}`, created_at: at(n), removed_at: null });
    }
    h.tables.comments.push({ id: id("bd", 1), post_id: postIds[1], author_id: ME, body: "only", created_at: at(5), removed_at: null });
    h.tables.comments.push({ id: id("bd", 2), post_id: postIds[120], author_id: ME, body: "kept", created_at: at(1), removed_at: null });
    h.tables.comments.push({ id: id("bd", 3), post_id: postIds[120], author_id: ME, body: "removed", created_at: at(2), removed_at: at(3) });
    return postIds;
  }

  /** What the previews were, worked out the old way from every comment. */
  function oldWay(postIds: string[], perPost: number) {
    const out: Record<string, Row[]> = {};
    const live = ordered((h.tables.comments ?? []).filter((c) => postIds.includes(String(c.post_id)) && c.removed_at == null), "created_at.asc");
    for (const c of live) (out[String(c.post_id)] ??= []).push(c);
    for (const k of Object.keys(out)) out[k] = out[k].slice(-perPost);
    return out;
  }

  it("brings the newest few of each, oldest first, as before", async () => {
    const postIds = club();
    const previews = await posts.fetchCommentPreviews(postIds, 2);
    const expected = oldWay(postIds, 2);
    expect(Object.keys(previews).sort()).toEqual(Object.keys(expected).sort());
    for (const k of Object.keys(expected)) {
      expect(previews[k].map((c) => c.id)).toEqual(expected[k].map((c) => c.id));
      expect(previews[k][0].author).toMatchObject({ id: ME, username: "me" });
    }
    // The busy photograph's previews are its two newest comments.
    expect(previews[postIds[0]].map((c) => c.body)).toEqual(["c1198", "c1199"]);
  });

  it("asks the database for a few per photograph, not every comment", async () => {
    const postIds = club();
    await posts.fetchCommentPreviews(postIds, 2);
    expect(h.requests.length).toBe(2);
    for (const r of h.requests) {
      expect(r.url.pathname).toBe("/rest/v1/posts");
      expect(r.url.searchParams.get("select")).toMatch(/^id,comments!comments_post_id_fkey\(\*,author:profiles!comments_author_id_fkey\(id,username,avatar_url\)\)$/);
      expect(r.url.searchParams.get("comments.order")).toBe("created_at.desc");
      expect(r.url.searchParams.get("comments.limit")).toBe("2");
      expect(r.url.searchParams.get("comments.removed_at")).toBe("is.null");
    }
  });

  it("would have shown old comments as the newest on a photograph past a thousand", () => {
    // The old read stopped at max_rows from the oldest end.
    const postIds = club();
    const firstThousand = ordered(h.tables.comments.filter((c) => c.removed_at == null), "created_at.asc").slice(0, 1000);
    const old = firstThousand.filter((c) => c.post_id === postIds[0]).slice(-2).map((c) => c.body);
    expect(old).not.toEqual(["c1198", "c1199"]);
  });
});

describe("a photograph's comments", () => {
  it("are the newest thousand, oldest first: the same list whenever there are fewer", async () => {
    const pid = id("ca", 1);
    h.tables.profiles = [{ id: ME, username: "me", avatar_url: null }];
    h.tables.comments = Array.from({ length: 1500 }, (_, n) => ({
      id: id("cb", n), post_id: pid, author_id: ME, body: `c${n}`, created_at: at(n), removed_at: null,
    }));
    const list = await posts.fetchComments(pid);
    expect(list.length).toBe(1000);
    expect(list[0].body).toBe("c500");
    expect(list[999].body).toBe("c1499");
    expect(h.requests[0].url.searchParams.get("order")).toBe("created_at.desc");
    expect(h.requests[0].url.searchParams.get("limit")).toBe("1000");

    h.tables.comments = h.tables.comments.slice(0, 30);
    const few = await posts.fetchComments(pid);
    expect(few.map((c) => c.body)).toEqual(Array.from({ length: 30 }, (_, n) => `c${n}`));
  });
});

describe("the inbox", () => {
  const PEERS = Array.from({ length: 140 }, (_, i) => id("d1", i + 2));

  function inbox() {
    h.tables.profiles = [{ id: ME, username: "me", full_name: null, avatar_url: null },
      ...PEERS.map((p, i) => ({ id: p, username: `peer${i}`, full_name: null, avatar_url: null }))];
    h.tables.conversations = PEERS.map((p, i) => {
      const [a, b] = ME < p ? [ME, p] : [p, ME];
      return { id: id("d2", i), user_a: a, user_b: b, created_at: at(0), last_message_at: at(i) };
    });
    h.tables.messages = [];
    let n = 0;
    for (const c of h.tables.conversations) {
      const peer = c.user_a === ME ? c.user_b : c.user_a;
      for (let k = 0; k < 12; k++) {
        n++;
        h.tables.messages.push({
          id: id("d3", n), conversation_id: c.id, sender_id: k % 2 ? ME : peer, body: `m${n}`, post_id: null,
          created_at: at(n), read_at: k < 9 ? at(n) : null,
        });
      }
    }
  }

  /** The inbox the old way: every message of every thread, oldest first, cut at max_rows. */
  function oldWay(cutAt = Infinity) {
    const convs = ordered(h.tables.conversations, "last_message_at.desc");
    const all = ordered(h.tables.messages, "created_at.asc").slice(0, cutAt);
    return convs.map((c) => {
      const mine = all.filter((m) => m.conversation_id === c.id);
      return {
        id: c.id,
        last: mine.length ? mine[mine.length - 1].id : null,
        unread: mine.filter((m) => m.sender_id !== ME && !m.read_at).length,
      };
    });
  }

  it("gives each thread its newest message and its unread count, as before", async () => {
    inbox();
    const list = await messages.fetchConversations(ME);
    expect(list.map((c) => ({ id: c.id, last: c.last_message?.id ?? null, unread: c.unread_count }))).toEqual(oldWay());
    expect(list[0].peer.username).toBe("peer139");
  });

  it("no longer reads every message of every thread to do it", async () => {
    inbox();
    await messages.fetchConversations(ME);
    const conversationsRead = h.requests.find((r) => r.url.pathname === "/rest/v1/conversations")!;
    expect(conversationsRead.url.searchParams.get("messages.order")).toBe("created_at.desc");
    expect(conversationsRead.url.searchParams.get("messages.limit")).toBe("1");
    const messageReads = h.requests.filter((r) => r.url.pathname === "/rest/v1/messages");
    for (const r of messageReads) {
      expect(r.url.searchParams.get("read_at")).toBe("is.null");
      expect(r.url.searchParams.get("sender_id")).toBe(`neq.${ME}`);
    }
    for (const r of h.requests) expect(r.url.href.length).toBeLessThan(8192 / 2);
  });

  it("was wrong past a thousand messages, and is right now", async () => {
    inbox(); // 140 threads x 12 messages = 1,680 messages
    const old = oldWay(1000);
    const now = await messages.fetchConversations(ME);
    const truth = oldWay();
    expect(now.map((c) => ({ id: c.id, last: c.last_message?.id ?? null, unread: c.unread_count }))).toEqual(truth);
    expect(old).not.toEqual(truth);
  });

  it("counts the badge from the same", async () => {
    inbox();
    const unread = oldWay().reduce((n, c) => n + c.unread, 0);
    expect(await messages.fetchUnreadMessageCount(ME)).toBe(unread);
    const inboxCount = (await messages.fetchConversations(ME)).reduce((n, c) => n + c.unread_count, 0);
    expect(inboxCount).toBe(unread);
  });

  it("counts the badge without reading anyone's profile or any thread's newest message", async () => {
    inbox();
    await messages.fetchUnreadMessageCount(ME);
    expect(h.requests.some((r) => r.url.pathname === "/rest/v1/profiles")).toBe(false);
    const threads = h.requests.filter((r) => r.url.pathname === "/rest/v1/conversations");
    expect(threads.length).toBe(1);
    expect(threads[0].url.searchParams.get("select")).toBe("id");
    for (const r of h.requests.filter((q) => q.url.pathname === "/rest/v1/messages")) {
      expect(r.url.searchParams.get("select")).toBe("conversation_id");
      expect(r.url.searchParams.get("read_at")).toBe("is.null");
      expect(r.url.searchParams.get("sender_id")).toBe(`neq.${ME}`);
    }
  });

  it("counts no badge for a member with no threads, in one read", async () => {
    inbox();
    h.tables.conversations = [];
    expect(await messages.fetchUnreadMessageCount(ME)).toBe(0);
    expect(h.requests.length).toBe(1);
  });
});

describe("a thread", () => {
  it("is its newest thousand messages, oldest first", async () => {
    const conv = id("e1", 1);
    h.tables.messages = Array.from({ length: 1300 }, (_, n) => ({
      id: id("e2", n), conversation_id: conv, sender_id: ME, body: `m${n}`, post_id: null, created_at: at(n), read_at: null,
    }));
    const list = await messages.fetchMessages(conv);
    expect(list.length).toBe(1000);
    expect(list[0].body).toBe("m300");
    expect(list[999].body).toBe("m1299");
  });

  it("reads the photographs it carries together, not one request each", async () => {
    const conv = id("e1", 2);
    const shared = Array.from({ length: 30 }, (_, n) => id("e3", n));
    h.tables.profiles = [{ id: ME, username: "me", full_name: null, avatar_url: null }];
    h.tables.posts = shared.slice(0, 29).map((pid) => ({ id: pid, author_id: ME, removed_at: null }));
    h.tables.messages = shared.map((pid, n) => ({
      id: id("e4", n), conversation_id: conv, sender_id: ME, body: "", post_id: pid, created_at: at(n), read_at: null,
    }));
    const list = await messages.fetchMessages(conv);
    const postReads = h.requests.filter((r) => r.url.pathname === "/rest/v1/posts");
    expect(postReads.length).toBe(1);
    expect(list.slice(0, 29).every((m) => m.post?.author?.username === "me")).toBe(true);
    // The one the server answered without is gone, and is said to be.
    expect(list[29].post).toBeNull();

    // Kept for the next poll: no photograph is read again.
    await messages.fetchMessages(conv);
    expect(h.requests.filter((r) => r.url.pathname === "/rest/v1/posts").length).toBe(1);
  });
});

describe("the home feed", () => {
  function club(followees: number) {
    const friends = Array.from({ length: followees }, (_, i) => id("f1", i));
    h.tables.profiles = [ME, ...friends].map((p, i) => ({ id: p, username: `m${i}`, full_name: null, avatar_url: null }));
    h.tables.follows = friends.map((f, i) => ({ follower_id: ME, followee_id: f, status: i % 10 === 9 ? "pending" : "accepted" }));
    h.tables.posts = [];
    let n = 0;
    for (const author of [ME, ...friends, id("f9", 1)]) {
      for (let k = 0; k < 3; k++) {
        n++;
        h.tables.posts.push({ id: id("f2", n), author_id: author, created_at: at((n * 37) % 500), removed_at: n % 13 === 0 ? at(1) : null });
      }
    }
    posts.forgetFollowingIds(ME);
  }

  it("is asked of feed_page, with no list of who the member follows in the URL", async () => {
    club(800);
    const page = await posts.fetchFeedPage(ME, 2);
    expect(page.length).toBe(posts.FEED_PAGE_SIZE);
    expect(h.requests.length).toBe(1);
    expect(h.requests[0].url.pathname).toBe("/rest/v1/rpc/feed_page");
    expect(h.requests[0].method).toBe("POST");
    expect(h.requests[0].url.href.length).toBeLessThan(400);
    expect(h.requests[0].url.searchParams.get("select")).toBe(
      "*,author:profiles!posts_author_id_fkey(id,username,full_name,avatar_url)",
    );
    expect(page[0].author).toMatchObject({ username: expect.stringMatching(/^m\d+$/) });
  });

  it("asks PostgREST for the order too, so a page is newest first whatever order the rows come in", async () => {
    club(60);
    const expected = (await posts.fetchFeedPage(ME, 1)).map((x) => x.id);
    h.feedPage = "unordered";
    h.requests.length = 0;
    const page = await posts.fetchFeedPage(ME, 1);
    expect(h.requests[0].url.searchParams.get("order")).toBe("created_at.desc,id.desc");
    expect(page.map((x) => x.id)).toEqual(expected);
    const times = page.map((x) => String(x.created_at));
    expect(times).toEqual([...times].sort().reverse());
  });

  it("gives the same pages the old read gave, while the old read still worked", async () => {
    club(60);
    const viaFunction: string[][] = [];
    for (let p = 0; p < 6; p++) viaFunction.push((await posts.fetchFeedPage(ME, p)).map((x) => x.id));
    h.feedPage = "missing";
    posts.forgetFeedPageMissing();
    const theOldWay: string[][] = [];
    for (let p = 0; p < 6; p++) theOldWay.push((await posts.fetchFeedPage(ME, p)).map((x) => x.id));
    expect(viaFunction).toEqual(theOldWay);
    expect(viaFunction.flat().length).toBeGreaterThan(posts.FEED_PAGE_SIZE * 5);
  });

  it("falls back to the old read where the database has no feed_page yet, and does not keep asking", async () => {
    club(30);
    h.feedPage = "missing";
    const first = await posts.fetchFeedPage(ME, 0);
    expect(first.length).toBe(posts.FEED_PAGE_SIZE);
    await posts.fetchFeedPage(ME, 1);
    const asked = h.requests.filter((r) => r.url.pathname === "/rest/v1/rpc/feed_page").length;
    expect(asked).toBe(1);
  });

  it("does not hide a real failure behind the fallback", async () => {
    club(30);
    h.feedPage = "broken";
    await expect(posts.fetchFeedPage(ME, 0)).rejects.toMatchObject({ code: "57014" });
  });

  it("the old read, past a couple of hundred follows, could not be sent at all", async () => {
    club(800);
    h.feedPage = "missing";
    await expect(posts.fetchFeedPage(ME, 0)).rejects.toBeTruthy();
  });
});
