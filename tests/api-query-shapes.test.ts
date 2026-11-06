import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";

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
  requests: [] as { url: URL; method: string; body?: string }[],
  inFlight: 0,
  maxInFlight: 0,
  tables: {} as Record<string, Record<string, unknown>[]>,
  /**
   * How feed_page answers: as the database would, as if not there yet,
   * with a failure, or with its rows in some other order than the
   * function's (nothing promises the function's order survives the query
   * PostgREST wraps around it to join the author).
   */
  feedPage: "there" as "there" | "missing" | "broken" | "unordered" | "stuck",
  /** How unread_message_counts (0037) answers: as the database would, as if not there yet, or with a failure. */
  unreadCounts: "there" as "there" | "missing" | "broken",
  /** How claim_push_token (0036) answers, and what it was sent. */
  claimToken: "there" as "there" | "missing",
  claims: [] as Record<string, unknown>[],
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

/** A value as PostgREST reads it: in double quotes, with \\ and \" escaped, or bare. */
function unquoted(value: string): string {
  return /^".*"$/.test(value) ? value.slice(1, -1).replace(/\\(.)/g, "$1") : value;
}

function matches(row: Row, column: string, filter: string): boolean {
  const [op, ...rest] = filter.split(".");
  const raw = rest.join(".");
  const value = unquoted(raw);
  const cell = row[column];
  if (op === "eq") return String(cell) === value;
  if (op === "neq") return String(cell) !== value;
  if (op === "lt") return String(cell) < value;
  if (op === "lte") return String(cell) <= value;
  if (op === "gt") return String(cell) > value;
  if (op === "gte") return String(cell) >= value;
  if (op === "in") return inList(raw).includes(String(cell));
  if (op === "is") return value === "null" ? cell == null : String(cell) === value;
  throw new Error(`filter not modelled: ${column}=${filter}`);
}

/** Split at the commas of this level: not inside parentheses or double quotes. */
function topLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out;
}

/**
 * PostgREST's or=(…), with and(…) / or(…) inside it. A term is
 * column.operator.value, and a value with "," "." ":" or parentheses in
 * it must come in double quotes, or it is read wrong: a bare value here
 * stops at its first "," or ")", as PostgREST's does.
 */
function logic(row: Row, kind: "or" | "and", list: string): boolean {
  const terms = topLevel(list).map((term) => {
    const nested = /^(and|or)\((.*)\)$/.exec(term);
    if (nested) return logic(row, nested[1] as "or" | "and", nested[2]);
    const [column, op, ...rest] = term.split(".");
    const value = rest.join(".");
    // PostgREST's documentation: a value with any of , . : ( ) in it goes in
    // double quotes. Held to it here, so a bare time is caught.
    if (!/^".*"$/.test(value) && /[,.:()]/.test(value)) throw new Error(`unquoted value in or(): ${term}`);
    return matches(row, column, `${op}.${value}`);
  });
  return kind === "or" ? terms.some(Boolean) : terms.every(Boolean);
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
  follows_follower_id_fkey: { child: "follows", parent: "profiles", childColumn: "follower_id", parentColumn: "id" },
  follows_followee_id_fkey: { child: "follows", parent: "profiles", childColumn: "followee_id", parentColumn: "id" },
  reports_reporter_id_fkey: { child: "reports", parent: "profiles", childColumn: "reporter_id", parentColumn: "id" },
  reports_profile_id_fkey: { child: "reports", parent: "profiles", childColumn: "profile_id", parentColumn: "id" },
  reports_comment_id_fkey: { child: "reports", parent: "comments", childColumn: "comment_id", parentColumn: "id" },
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
      const list = value.replace(/^\(|\)$/g, "");
      rows = rows.filter((r) => logic(r, "or", list));
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
        const parent = (h.tables[link.parent] ?? []).find((p) => p[link.parentColumn] === row[link.childColumn]) ?? null;
        const copy: Row | null = parent ? { ...parent } : null;
        // Its own to-one embeds (a reported comment's author).
        for (const inner of copy ? embeds(e.inner) : []) {
          const innerLink = inner.fk ? LINKS[inner.fk] : null;
          if (!innerLink) throw new Error(`embed not modelled: ${inner.table}`);
          copy![inner.key] = (h.tables[innerLink.parent] ?? []).find((p) => p[innerLink.parentColumn] === copy![innerLink.childColumn]) ?? null;
        }
        out[e.key] = copy;
      }
    }
    return out;
  });
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  h.requests.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
  h.inFlight++;
  h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
  await new Promise((r) => setTimeout(r, 1));
  h.inFlight--;
  // The ceiling the gateway sets on a request line.
  if (url.href.length > 8192) return new Response("URI Too Long", { status: 414 });
  if (url.pathname === "/rest/v1/rpc/feed_page") return feedPage(url, JSON.parse(String(init?.body ?? "{}")));
  if (url.pathname === "/rest/v1/rpc/unread_message_counts") return unreadMessageCounts();
  if (url.pathname === "/rest/v1/rpc/claim_push_token") {
    if (h.claimToken === "missing") {
      return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function public.claim_push_token" }), { status: 404 });
    }
    h.claims.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(null, { status: 204 });
  }
  // A delete: the rows it matches go, and with count=exact the number
  // comes back in Content-Range (row-level security is the table's here:
  // what the test leaves in it is what the member may remove).
  if (init?.method === "DELETE") {
    const table = url.pathname.replace("/rest/v1/", "");
    const filters = [...url.searchParams].filter(([k]) => k !== "select");
    const gone = (h.tables[table] ?? []).filter((r) => filters.every(([k, v]) => matches(r, k, v)));
    h.tables[table] = (h.tables[table] ?? []).filter((r) => !gone.includes(r));
    // With select (return=representation), the rows that went come back.
    const select = url.searchParams.get("select");
    if (select) {
      const cols = select.split(",").map((c) => c.trim());
      const body = gone.map((r) => (select === "*" ? r : Object.fromEntries(cols.map((c) => [c, r[c]]))));
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(null, { status: 204, headers: { "Content-Range": `*/${gone.length}` } });
  }
  // A count with no rows (select(…, { count: "exact", head: true })): the
  // number comes back in Content-Range, and no row does.
  if (init?.method === "HEAD") {
    const table = url.pathname.replace("/rest/v1/", "");
    const all = new URL(url.href);
    all.searchParams.delete("limit");
    const n = (h.tables[table] ?? []).filter((r) =>
      [...all.searchParams].every(([k, v]) => k === "select" || matches(r, k, v)),
    ).length;
    return new Response(null, { status: 200, headers: { "Content-Range": `*/${n}` } });
  }
  return new Response(JSON.stringify(answer(url)), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** unread_message_counts (0037) as the database answers it for ME: a row a thread with unread messages from the other member, newest thread first, max_rows at most. */
function unreadMessageCounts(): Response {
  if (h.unreadCounts === "missing") {
    return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function public.unread_message_counts" }), { status: 404 });
  }
  if (h.unreadCounts === "broken") {
    return new Response(JSON.stringify({ code: "57014", message: "canceling statement due to statement timeout" }), { status: 500 });
  }
  const mine = ordered((h.tables.conversations ?? []).filter((c) => c.user_a === ME || c.user_b === ME), "last_message_at.desc");
  const rows: Row[] = [];
  for (const c of mine) {
    const n = (h.tables.messages ?? []).filter((m) => m.conversation_id === c.id && m.read_at == null && m.sender_id !== ME).length;
    if (n > 0) rows.push({ conversation_id: c.id, unread: n });
  }
  return new Response(JSON.stringify(rows.slice(0, 1000)), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** feed_page (0025) as the database answers it for the signed-in member, ME. */
function feedPage(url: URL, args: { p_limit?: number; p_before_at?: string | null; p_before_id?: string | null }): Response {
  // PostgREST finds a function by the names of the arguments sent: there is
  // no feed_page with an offset (0025 takes a cursor).
  const known = ["p_limit", "p_before_at", "p_before_id"];
  if (h.feedPage === "missing" || Object.keys(args).some((k) => !known.includes(k))) {
    return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function public.feed_page" }), { status: 404 });
  }
  if (h.feedPage === "broken") {
    return new Response(JSON.stringify({ code: "57014", message: "canceling statement due to statement timeout" }), { status: 500 });
  }
  const followed = new Set((h.tables.follows ?? []).filter((f) => f.follower_id === ME && f.status === "accepted").map((f) => f.followee_id));
  const mine = (h.tables.posts ?? [])
    .filter((p) => p.removed_at == null && (p.author_id === ME || followed.has(p.author_id)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)));
  // "stuck": a function that pays no heed to the cursor, the same rows every time.
  const at = h.feedPage === "stuck" ? null : args.p_before_at;
  const after = at
    ? mine.filter((p) => String(p.created_at) < at || (String(p.created_at) === at && args.p_before_id != null && String(p.id) < args.p_before_id))
    : mine;
  let page = after.slice(0, Math.min(Math.max(args.p_limit ?? 12, 1), 100));
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
type FeedCursor = import("@/api/posts").FeedCursor;
const tags = await import("@/api/tags");
const messages = await import("@/api/messages");
const profiles = await import("@/api/profiles");
const moderation = await import("@/api/moderation");
const { readInChunks, chunked, IDS_PER_REQUEST } = await import("@/api/batch");
const notifications = await import("@/api/notifications");
const { forgetRpcMissing } = await import("@/api/rpcMissing");

const ME = "00000000-0000-4000-8000-000000000001";
const id = (prefix: string, n: number) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

beforeEach(() => {
  h.requests.length = 0;
  h.inFlight = 0;
  h.maxInFlight = 0;
  h.tables = {};
  h.feedPage = "there";
  h.unreadCounts = "there";
  h.claimToken = "there";
  h.claims = [];
  forgetRpcMissing();
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

  it("no longer reads every message of every thread to do it, nor any message to count them", async () => {
    inbox();
    await messages.fetchConversations(ME);
    const conversationsRead = h.requests.find((r) => r.url.pathname === "/rest/v1/conversations")!;
    expect(conversationsRead.url.searchParams.get("messages.order")).toBe("created_at.desc");
    expect(conversationsRead.url.searchParams.get("messages.limit")).toBe("1");
    // The unread counts are counted by the database (0037), in one request.
    expect(h.requests.filter((r) => r.url.pathname === "/rest/v1/messages")).toEqual([]);
    expect(h.requests.filter((r) => r.url.pathname === "/rest/v1/rpc/unread_message_counts").length).toBe(1);
    for (const r of h.requests) expect(r.url.href.length).toBeLessThan(8192 / 2);
  });

  it("counts every unread message, past the thousand rows a read of them stopped at", async () => {
    inbox();
    // Forty unread from the other member in each thread: 5,600 in all,
    // 4,000 in the first hundred threads alone.
    let n = 10_000;
    for (const c of h.tables.conversations) {
      const peer = c.user_a === ME ? c.user_b : c.user_a;
      for (let k = 0; k < 40; k++) {
        n++;
        h.tables.messages.push({ id: id("d3", n), conversation_id: c.id, sender_id: peer, body: "", post_id: null, created_at: at(n), read_at: null });
      }
    }
    const truth = oldWay().reduce((t, c) => t + c.unread, 0);
    expect(truth).toBeGreaterThan(5000);
    expect(await messages.fetchUnreadMessageCount(ME)).toBe(truth);
    const inboxCount = (await messages.fetchConversations(ME)).reduce((t, c) => t + c.unread_count, 0);
    expect(inboxCount).toBe(truth);
    // Read the old way, a hundred threads a request, each cut at a thousand rows.
    h.unreadCounts = "missing";
    forgetRpcMissing();
    expect(await messages.fetchUnreadMessageCount(ME)).toBeLessThan(truth);
  });

  it("reads the unread messages the old way where the database has no unread_message_counts yet, and does not keep asking", async () => {
    inbox();
    const truth = oldWay();
    h.unreadCounts = "missing";
    const list = await messages.fetchConversations(ME);
    expect(list.map((c) => ({ id: c.id, last: c.last_message?.id ?? null, unread: c.unread_count }))).toEqual(truth);
    expect(await messages.fetchUnreadMessageCount(ME)).toBe(truth.reduce((t, c) => t + c.unread, 0));
    expect(h.requests.filter((r) => r.url.pathname === "/rest/v1/rpc/unread_message_counts").length).toBe(1);
    for (const r of h.requests.filter((q) => q.url.pathname === "/rest/v1/messages")) {
      expect(r.url.searchParams.get("read_at")).toBe("is.null");
      expect(r.url.searchParams.get("sender_id")).toBe(`neq.${ME}`);
    }
  });

  it("a count that fails is not taken for none: the badge keeps what it had, the inbox shows unmarked", async () => {
    inbox();
    h.unreadCounts = "broken";
    await expect(messages.fetchUnreadMessageCount(ME)).rejects.toMatchObject({ code: "57014" });
    const list = await messages.fetchConversations(ME);
    expect(list.length).toBe(140);
    expect(list.every((c) => c.unread_count === 0)).toBe(true);
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

  it("counts the badge in one request, without reading anyone's profile, any thread or any message", async () => {
    inbox();
    await messages.fetchUnreadMessageCount(ME);
    expect(h.requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual(["POST /rest/v1/rpc/unread_message_counts"]);
  });

  it("reads the newest thousand threads by name, so a member with more sees their newest, not an arbitrary thousand", async () => {
    const many = Array.from({ length: 1100 }, (_, i) => id("d4", i + 2));
    h.tables.profiles = [{ id: ME, username: "me", full_name: null, avatar_url: null }];
    h.tables.conversations = many.map((p, i) => {
      const [a, b] = ME < p ? [ME, p] : [p, ME];
      // Stored oldest first, so a cut made without the order would keep the oldest.
      return { id: id("d5", i), user_a: a, user_b: b, created_at: at(0), last_message_at: at(i) };
    });
    h.tables.messages = [];
    const list = await messages.fetchConversations(ME);
    expect(list.length).toBe(messages.INBOX_THREADS);
    expect(list[0].id).toBe(id("d5", 1099));
    expect(list.at(-1)!.id).toBe(id("d5", 100));
    const read = h.requests.find((r) => r.url.pathname === "/rest/v1/conversations")!;
    expect(read.url.searchParams.get("limit")).toBe(String(messages.INBOX_THREADS));
    expect(read.url.searchParams.get("order")).toBe("last_message_at.desc");
    // The badge's old way, for a database without 0037, reads the same newest thousand.
    h.unreadCounts = "missing";
    forgetRpcMissing();
    h.requests.length = 0;
    await messages.fetchUnreadMessageCount(ME);
    const ids = h.requests.find((r) => r.url.pathname === "/rest/v1/conversations")!;
    expect(ids.url.searchParams.get("limit")).toBe(String(messages.INBOX_THREADS));
    expect(ids.url.searchParams.get("order")).toBe("last_message_at.desc");
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

  it("keeps nothing it read for one member for the next to sign in on the phone", async () => {
    const conv = id("e1", 3);
    const shared = id("e3", 99);
    h.tables.profiles = [{ id: ME, username: "me", full_name: null, avatar_url: null }];
    // The member signed in may see it; it is in the thread.
    h.tables.posts = [{ id: shared, author_id: ME, removed_at: null }];
    h.tables.messages = [
      { id: id("e4", 99), conversation_id: conv, sender_id: ME, body: "", post_id: shared, created_at: at(1), read_at: null },
    ];
    expect((await messages.fetchMessages(conv))[0].post?.author?.username).toBe("me");

    // Signed out, and the next member, whom the server does not show it, opens a thread that carries it.
    messages.forgetSharedPosts();
    h.tables.posts = [];
    const next = await messages.fetchMessages(conv);
    expect(next[0].post).toBeNull();
    expect(h.requests.filter((r) => r.url.pathname === "/rest/v1/posts").length).toBe(2);
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

  /** The member's whole feed, newest first, as the database holds it now. */
  function truth(): string[] {
    const followed = new Set((h.tables.follows ?? []).filter((f) => f.status === "accepted").map((f) => f.followee_id));
    return (h.tables.posts ?? [])
      .filter((p) => p.removed_at == null && (p.author_id === ME || followed.has(p.author_id)))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))
      .map((p) => String(p.id));
  }

  /** Pages as Home asks for them: each after the last post of the one before, until one ends the feed. */
  async function walk(most = 1000): Promise<string[][]> {
    const pages: string[][] = [];
    let cursor: FeedCursor | null = null;
    for (let i = 0; i < most; i++) {
      const page = await posts.fetchFeedPage(ME, cursor);
      pages.push(page.map((x) => x.id));
      const next = posts.nextFeedCursor(page);
      if (!next) break;
      cursor = next;
    }
    return pages;
  }

  it("is asked of feed_page, with no list of who the member follows in the URL", async () => {
    club(800);
    const page = await posts.fetchFeedPage(ME, null);
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

  it("asks for the page after the last post held, by its time and id as the server gave them, never by an offset", async () => {
    club(60);
    const first = await posts.fetchFeedPage(ME, null);
    expect(JSON.parse(h.requests[0].body ?? "{}")).toEqual({ p_limit: posts.FEED_PAGE_SIZE });
    const cursor = posts.nextFeedCursor(first)!;
    const last = first[first.length - 1];
    // The server's own string, not one remade through a Date (which keeps
    // milliseconds where created_at has microseconds).
    expect(cursor).toEqual({ at: last.created_at, id: last.id });
    h.requests.length = 0;
    await posts.fetchFeedPage(ME, cursor);
    const body = JSON.parse(h.requests[0].body ?? "{}");
    expect(body).toEqual({ p_limit: posts.FEED_PAGE_SIZE, p_before_at: last.created_at, p_before_id: last.id });
    expect(body).not.toHaveProperty("p_offset");
    // A microsecond time goes back exactly as it came.
    const micro = Array.from({ length: posts.FEED_PAGE_SIZE }, (_, i) => ({ id: `p${i}`, created_at: "2026-11-06T10:00:00.123456+00:00" }));
    expect(posts.nextFeedCursor(micro)).toEqual({ at: "2026-11-06T10:00:00.123456+00:00", id: `p${posts.FEED_PAGE_SIZE - 1}` });
  });

  it("a page shorter than a page ends the feed; a full one does not", () => {
    const row = (i: number) => ({ id: `p${i}`, created_at: at(100 - i) });
    expect(posts.nextFeedCursor([])).toBeUndefined();
    expect(posts.nextFeedCursor(Array.from({ length: posts.FEED_PAGE_SIZE - 1 }, (_, i) => row(i)))).toBeUndefined();
    expect(posts.nextFeedCursor(Array.from({ length: posts.FEED_PAGE_SIZE }, (_, i) => row(i)))).toEqual({
      at: at(100 - (posts.FEED_PAGE_SIZE - 1)),
      id: `p${posts.FEED_PAGE_SIZE - 1}`,
    });
  });

  it("walks the whole feed page by page, every post once, in order, across posts made in the same instant", async () => {
    club(60);
    // One post in three made in the same instant as another.
    h.tables.posts.forEach((p, i) => {
      if (i % 3 === 2) p.created_at = h.tables.posts[i - 1].created_at;
    });
    const pages = await walk();
    expect(pages.flat()).toEqual(truth());
    expect(new Set(pages.flat()).size).toBe(pages.flat().length);
    expect(pages.length).toBeGreaterThan(5);
    // Many posts share a time here: the walk crosses them by id.
    const times = (h.tables.posts ?? []).map((p) => p.created_at);
    expect(new Set(times).size).toBeLessThan(times.length);
  });

  it("a post deleted between two pages skips no other, and a post arriving between them repeats none", async () => {
    club(60);
    const before = truth();
    const first = await posts.fetchFeedPage(ME, null);
    // Two posts of the page held are deleted, and three new ones arrive above it.
    h.tables.posts = h.tables.posts.filter((p) => p.id !== first[1].id && p.id !== first[3].id);
    for (let k = 0; k < 3; k++) {
      h.tables.posts.push({ id: id("f3", k), author_id: ME, created_at: at(10_000 + k), removed_at: null });
    }
    const second = await posts.fetchFeedPage(ME, posts.nextFeedCursor(first)!);
    expect(second.map((x) => x.id)).toEqual(before.slice(posts.FEED_PAGE_SIZE, posts.FEED_PAGE_SIZE * 2));
    expect(second.some((x) => first.some((y) => y.id === x.id))).toBe(false);
  });

  it("Home's query, paged as Home pages it, holds every post once while the club moves between pages", async () => {
    club(60);
    const before = truth();
    const home = readFileSync(join(__dirname, "..", "app", "(tabs)", "index.tsx"), "utf8");
    expect(home).toMatch(/initialPageParam: null as FeedCursor \| null,/);
    expect(home).toMatch(/getNextPageParam: \(lastPage\) => nextFeedCursor\(lastPage\),/);
    expect(home).not.toMatch(/pages\.length/);
    const client = new QueryClient();
    const feed = new InfiniteQueryObserver(client, {
      queryKey: ["feed", ME],
      queryFn: ({ pageParam }: { pageParam: FeedCursor | null }) => posts.fetchFeedPage(ME, pageParam),
      initialPageParam: null as FeedCursor | null,
      getNextPageParam: (lastPage: Awaited<ReturnType<typeof posts.fetchFeedPage>>) => posts.nextFeedCursor(lastPage),
    });
    await feed.refetch();
    // Between the first and second page a post already seen is deleted;
    // between the second and third, two new ones arrive at the top.
    h.tables.posts = h.tables.posts.filter((p) => p.id !== before[3]);
    await feed.fetchNextPage();
    h.tables.posts.push(
      { id: id("f4", 1), author_id: ME, created_at: at(20_000), removed_at: null },
      { id: id("f4", 2), author_id: ME, created_at: at(20_001), removed_at: null },
    );
    const result = await feed.fetchNextPage();
    const held = result.data!.pages.flat().map((p) => p.id);
    expect(held).toEqual(before.slice(0, posts.FEED_PAGE_SIZE * 3));
    client.clear();
  });

  it("asks PostgREST for the order too, so a page is newest first whatever order the rows come in", async () => {
    club(60);
    const first = await posts.fetchFeedPage(ME, null);
    const cursor = posts.nextFeedCursor(first)!;
    const expected = (await posts.fetchFeedPage(ME, cursor)).map((x) => x.id);
    h.feedPage = "unordered";
    h.requests.length = 0;
    const page = await posts.fetchFeedPage(ME, cursor);
    expect(h.requests[0].url.searchParams.get("order")).toBe("created_at.desc,id.desc");
    expect(page.map((x) => x.id)).toEqual(expected);
    const times = page.map((x) => String(x.created_at));
    expect(times).toEqual([...times].sort().reverse());
  });

  it("gives the same pages the old read gives, where the database has no feed_page yet", async () => {
    club(60);
    const viaFunction = await walk();
    h.feedPage = "missing";
    posts.forgetFeedPageMissing();
    h.requests.length = 0;
    const theOldWay = await walk();
    expect(viaFunction).toEqual(theOldWay);
    expect(viaFunction.flat().length).toBeGreaterThan(posts.FEED_PAGE_SIZE * 5);
    // The old read asks after the same post, its time in quotes (it has "." and ":" in it).
    const second = h.requests.filter((r) => r.url.pathname === "/rest/v1/posts")[1];
    expect(second.url.searchParams.get("or")).toMatch(
      /^\(created_at\.lt\."[^"]+",and\(created_at\.eq\."[^"]+",id\.lt\."[0-9a-f-]+"\)\)$/,
    );
    // And the time on its own, which posts_author_idx can start from.
    expect(second.url.searchParams.get("created_at")).toMatch(/^lte\.\d{4}-\d\d-\d\dT/);
    expect(second.url.searchParams.get("order")).toBe("created_at.desc,id.desc");
    expect(second.url.searchParams.get("limit")).toBe(String(posts.FEED_PAGE_SIZE));
    expect(second.url.searchParams.get("offset")).toBeNull();
  });

  it("falls back to the old read where the database has no feed_page yet, and does not keep asking", async () => {
    club(30);
    h.feedPage = "missing";
    const first = await posts.fetchFeedPage(ME, null);
    expect(first.length).toBe(posts.FEED_PAGE_SIZE);
    await posts.fetchFeedPage(ME, posts.nextFeedCursor(first)!);
    const asked = h.requests.filter((r) => r.url.pathname === "/rest/v1/rpc/feed_page").length;
    expect(asked).toBe(1);
  });

  it("does not hide a real failure behind the fallback", async () => {
    club(30);
    h.feedPage = "broken";
    await expect(posts.fetchFeedPage(ME, null)).rejects.toMatchObject({ code: "57014" });
  });

  it("leaves out photographs whose author the reader may not see, and still pages to the end", async () => {
    club(60);
    // Two members the reader follows whose profiles the reader may not
    // read (outside the club): their photographs come with author null.
    const hidden = new Set([id("f1", 2), id("f1", 5)]);
    h.tables.profiles = h.tables.profiles.filter((p) => !hidden.has(String(p.id)));
    const shown = truth().filter((pid) => !hidden.has(String(h.tables.posts.find((p) => p.id === pid)!.author_id)));
    expect(shown.length).toBeLessThan(truth().length);
    for (const mode of ["there", "missing"] as const) {
      h.feedPage = mode;
      posts.forgetFeedPageMissing();
      const pages = await walk();
      expect(pages.flat(), mode).toEqual(shown);
      // Every page but the last is a whole page: none is taken for the end.
      expect(pages.slice(0, -1).every((p) => p.length === posts.FEED_PAGE_SIZE), mode).toBe(true);
    }
  });

  it("makes a page up from the rows after one whose photographs it left out, in a few reads", async () => {
    club(10);
    // The newest thirty in the feed are by a member the reader may not see.
    const hidden = id("f1", 0);
    h.tables.profiles = h.tables.profiles.filter((p) => p.id !== hidden);
    for (let k = 0; k < 30; k++) h.tables.posts.push({ id: id("f5", k), author_id: hidden, created_at: at(10_000 + k), removed_at: null });
    const first = await posts.fetchFeedPage(ME, null);
    expect(first.length).toBe(posts.FEED_PAGE_SIZE);
    expect(first.every((p) => p.author != null)).toBe(true);
    // Twelve, twelve, then twenty-four: three reads.
    expect(h.requests.map((r) => JSON.parse(r.body ?? "{}").p_limit)).toEqual([12, 12, 24]);
  });

  it("never takes a long run of such photographs for the end of the feed", async () => {
    club(10);
    // Three hundred in a row by a member the reader may not see, just
    // after the newest photograph: four reads of twelve used to end the feed there.
    const hidden = id("f1", 0);
    h.tables.profiles = h.tables.profiles.filter((p) => p.id !== hidden);
    const newest = Math.max(...h.tables.posts.map((p) => Date.parse(String(p.created_at))));
    for (let k = 0; k < 300; k++) {
      h.tables.posts.push({ id: id("f8", k), author_id: hidden, created_at: new Date(newest - 1 - k).toISOString(), removed_at: null });
    }
    const shown = truth().filter((pid) => h.tables.posts.find((p) => p.id === pid)!.author_id !== hidden);
    for (const mode of ["there", "missing"] as const) {
      h.feedPage = mode;
      posts.forgetFeedPageMissing();
      h.requests.length = 0;
      const pages = await walk();
      expect(pages.flat(), mode).toEqual(shown);
      expect(pages.slice(0, -1).every((p) => p.length === posts.FEED_PAGE_SIZE), mode).toBe(true);
      // Crossed in reads that grow, none larger than feed_page answers.
      const sizes = h.requests
        .filter((r) => r.url.pathname === (mode === "there" ? "/rest/v1/rpc/feed_page" : "/rest/v1/posts"))
        .map((r) => (mode === "there" ? Number(JSON.parse(r.body ?? "{}").p_limit) : Number(r.url.searchParams.get("limit"))));
      expect(sizes.length, mode).toBeGreaterThan(0);
      expect(Math.max(...sizes), mode).toBe(posts.FEED_FILL_MAX);
      expect(sizes.length, mode).toBeLessThan(20);
    }
  });

  it("stops reading for a page when a read has not moved past the one before", async () => {
    club(10);
    // Every photograph by a member the reader may not see, and a function
    // that answers the same rows whatever the cursor: no endless reading.
    h.tables.profiles = h.tables.profiles.filter((p) => p.id === ME);
    h.tables.posts = h.tables.posts.filter((p) => p.author_id !== ME);
    h.feedPage = "stuck";
    expect(await posts.fetchFeedPage(ME, null)).toEqual([]);
    expect(h.requests.length).toBe(2);
  });

  it("asks for no more rows a read than feed_page gives, so a full read is never taken for the end", () => {
    const sql = readFileSync(join(__dirname, "..", "supabase", "migrations", "0025_feed_page.sql"), "utf8");
    const ceiling = Number(sql.match(/least\(greatest\(coalesce\(p_limit, 12\), 1\), (\d+)\)/)?.[1]);
    expect(ceiling).toBeGreaterThan(0);
    expect(posts.FEED_FILL_MAX).toBeLessThanOrEqual(ceiling);
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(posts.feedFillSize)).toEqual([12, 12, 24, 48, 96, 100, 100, 100]);
  });

  it("the old read, past a couple of hundred follows, could not be sent at all", async () => {
    club(800);
    h.feedPage = "missing";
    await expect(posts.fetchFeedPage(ME, null)).rejects.toBeTruthy();
  });
});

describe("a photograph on its own", () => {
  it("whose author the reader may not see is, for them, not there", async () => {
    const hidden = id("f6", 1);
    h.tables.profiles = [{ id: ME, username: "me", full_name: null, avatar_url: null }];
    h.tables.posts = [
      { id: id("f7", 1), author_id: ME, created_at: at(1), removed_at: null },
      { id: id("f7", 2), author_id: hidden, created_at: at(2), removed_at: null },
    ];
    expect((await posts.fetchPost(id("f7", 1)))?.author?.username).toBe("me");
    expect(await posts.fetchPost(id("f7", 2))).toBeNull();
    expect(await posts.fetchPost(id("f7", 3))).toBeNull();
  });
});

describe("this phone's push token", () => {
  it("is filed through claim_push_token, which moves it from whoever held it", async () => {
    await notifications.registerPushToken(ME, "ExponentPushToken[x]", "ios", "Apple iPhone");
    expect(h.claims).toEqual([{ p_token: "ExponentPushToken[x]", p_platform: "ios", p_device: "Apple iPhone" }]);
    expect(h.requests.some((r) => r.url.pathname === "/rest/v1/push_tokens")).toBe(false);
  });

  it("is filed the old way where the database has no claim_push_token yet, and the function is not asked again", async () => {
    h.claimToken = "missing";
    await notifications.registerPushToken(ME, "ExponentPushToken[x]", "ios", null);
    await notifications.registerPushToken(ME, "ExponentPushToken[x]", "ios", null);
    expect(h.requests.filter((r) => r.url.pathname === "/rest/v1/rpc/claim_push_token").length).toBe(1);
    const upserts = h.requests.filter((r) => r.url.pathname === "/rest/v1/push_tokens");
    expect(upserts.length).toBe(2);
    expect(upserts[0].method).toBe("POST");
    expect(upserts[0].url.searchParams.get("on_conflict")).toBe("token");
  });

  it("says how many rows its removal took: none when the row was another member's", async () => {
    h.tables.push_tokens = [
      { token: "ExponentPushToken[mine]", user_id: ME },
      { token: "ExponentPushToken[second-phone]", user_id: ME },
    ];
    expect(await notifications.unregisterPushToken("ExponentPushToken[mine]")).toBe(1);
    // A row row-level security does not let this member see: not in the table they are shown.
    expect(await notifications.unregisterPushToken("ExponentPushToken[someone-else]")).toBe(0);
    // Every row of the member's, and which tokens went, in the one request.
    expect(await notifications.unregisterAllPushTokens(ME)).toEqual(["ExponentPushToken[second-phone]"]);
    expect(h.tables.push_tokens).toEqual([]);
    const all = h.requests.filter((r) => r.method === "DELETE").at(-1)!;
    expect(all.url.searchParams.get("user_id")).toBe(`eq.${ME}`);
    expect(all.url.searchParams.get("select")).toBe("token");
  });
});

describe("followers and following", () => {
  const STAR = id("90", 0);
  /** STAR, followed by `n` members (one in nine since blocked, so unreadable), and following them back. */
  function crowd(n: number) {
    const fans = Array.from({ length: n }, (_, i) => id("91", i));
    h.tables.profiles = [STAR, ME, ...fans.filter((_, i) => i % 9 !== 4)].map((p, i) => ({
      id: p, username: `u${i}`, full_name: null, avatar_url: null, city: null, bio: "long",
    }));
    h.tables.follows = fans.flatMap((f, i) => [
      // Many follows made in the same second: the pages cross them by id.
      { follower_id: f, followee_id: STAR, status: i % 50 === 7 ? "pending" : "accepted", created_at: at(Math.floor(i / 3)) },
      { follower_id: STAR, followee_id: f, status: "accepted", created_at: at(Math.floor(i / 4)) },
    ]);
    // I follow one of them, and have asked another.
    h.tables.follows.push(
      { follower_id: ME, followee_id: fans[1], status: "accepted", created_at: at(1) },
      { follower_id: ME, followee_id: fans[2], status: "pending", created_at: at(1) },
    );
    return fans;
  }

  async function walk(side: "followers" | "following", who: string) {
    const ids: string[] = [];
    let cursor: import("@/api/profiles").FollowCursor | null = null;
    for (let i = 0; i < 1000; i++) {
      const page: import("@/api/profiles").FollowPage = await profiles.fetchFollowPage(side, who, cursor);
      ids.push(...page.members.map((m) => m.id));
      if (!page.next) break;
      cursor = page.next;
    }
    return ids;
  }

  /** Who the database says, newest follow first, readable members only. */
  function truth(side: "followers" | "following", who: string, readableOnly = true) {
    const [mine, theirs] = side === "followers" ? ["followee_id", "follower_id"] : ["follower_id", "followee_id"];
    const readable = new Set(h.tables.profiles.map((p) => p.id));
    return h.tables.follows
      .filter((f) => f[mine] === who && f.status === "accepted")
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b[theirs]).localeCompare(String(a[theirs])))
      .map((f) => String(f[theirs]))
      .filter((m) => !readableOnly || readable.has(m));
  }

  it("2,500 followers come a page of fifty at a time, every one once, past PostgREST's thousand", async () => {
    crowd(2500);
    const all = await walk("followers", STAR);
    expect(all).toEqual(truth("followers", STAR));
    expect(all.length).toBeGreaterThan(2000);
    expect(new Set(all).size).toBe(all.length);
    const reads = h.requests.filter((r) => r.url.pathname === "/rest/v1/follows");
    expect(reads.length).toBe(Math.floor(truth("followers", STAR, false).length / 50) + 1);
    for (const r of reads) {
      expect(r.url.searchParams.get("limit")).toBe("50");
      expect(r.url.searchParams.get("order")).toBe("created_at.desc,follower_id.desc");
      // Only what a row draws: no bio, no counts, no settings.
      expect(r.url.searchParams.get("select")).toBe(
        "created_at,follower_id,member:profiles!follows_follower_id_fkey(id,username,full_name,avatar_url,city)",
      );
    }
    // After the first, each page starts from the last follow held, the time on its own for the index.
    expect(reads[1].url.searchParams.get("created_at")).toMatch(/^lte\./);
    expect(reads[1].url.searchParams.get("or")).toMatch(
      /^\(created_at\.lt\."[^"]+",and\(created_at\.eq\."[^"]+",follower_id\.lt\."[0-9a-f-]+"\)\)$/,
    );
  });

  it("and whom they follow, the same way", async () => {
    crowd(700);
    const all = await walk("following", STAR);
    expect(all).toEqual(truth("following", STAR));
    expect(h.requests.every((r) => r.url.searchParams.get("limit") === "50")).toBe(true);
  });

  it("a page whose members cannot be read does not end the list", async () => {
    crowd(200);
    const newest = truth("followers", STAR);
    // The fifty newest followers, none of them readable now.
    h.tables.profiles = h.tables.profiles.filter((p) => !newest.slice(0, 50).includes(String(p.id)));
    h.requests.length = 0;
    // A page of nobody readable is read through: the first answer brings
    // the next fifty, so the list does not show as empty while they wait.
    const first = await profiles.fetchFollowPage("followers", STAR, null);
    expect(first.members.length).toBeGreaterThan(0);
    expect(first.members.map((m) => m.id)).toEqual(newest.slice(50, 50 + first.members.length));
    expect(first.next).toBeDefined();
    expect(h.requests.filter((r) => r.url.pathname === "/rest/v1/follows").length).toBe(2);
    const rest = await walk("followers", STAR);
    expect(rest).toEqual(newest.slice(50));
  });

  it("a list whose every member cannot be read ends, empty; one far longer is read on ten pages a call, no more", async () => {
    const reads = () => h.requests.filter((r) => r.url.pathname === "/rest/v1/follows").length;
    crowd(120);
    h.tables.profiles = h.tables.profiles.filter((p) => !truth("followers", STAR, false).includes(String(p.id)));
    h.requests.length = 0;
    const short = await profiles.fetchFollowPage("followers", STAR, null);
    expect(short.members).toEqual([]);
    expect(short.next).toBeUndefined();
    expect(reads()).toBe(3);

    crowd(900);
    h.tables.profiles = h.tables.profiles.filter((p) => !truth("followers", STAR, false).includes(String(p.id)));
    h.requests.length = 0;
    const long = await profiles.fetchFollowPage("followers", STAR, null);
    expect(long.members).toEqual([]);
    expect(long.next).toBeDefined();
    expect(reads()).toBe(10);
  });

  it("where I stand with a search's results, both ways, read about those members only, past a thousand follows", async () => {
    // I follow 1,500 members and 1,200 follow me; a search finds thirty.
    const many = Array.from({ length: 1500 }, (_, i) => id("c1", i));
    h.tables.follows = [
      ...many.map((m) => ({ follower_id: ME, followee_id: m, status: "accepted", created_at: at(1) })),
      ...many.slice(0, 1200).map((m) => ({ follower_id: m, followee_id: ME, status: "accepted", created_at: at(2) })),
      { follower_id: ME, followee_id: id("c2", 1), status: "pending", created_at: at(3) },
    ];
    // Ten I follow from the end of my list (past the first thousand), ten
    // who follow me only, one I asked to follow, and nine strangers.
    const found = [...many.slice(1490), ...many.slice(1190, 1200), id("c2", 1), ...Array.from({ length: 9 }, (_, i) => id("c3", i))];
    const circle = await profiles.fetchFollowsAmong(ME, found);
    expect(new Set(circle.following)).toEqual(new Set([...many.slice(1490), ...many.slice(1190, 1200)]));
    expect(new Set(circle.followers)).toEqual(new Set(many.slice(1190, 1200)));
    expect(h.requests.length).toBe(2);
    for (const r of h.requests) {
      expect(r.url.pathname).toBe("/rest/v1/follows");
      expect(r.url.searchParams.get("status")).toBe("eq.accepted");
      expect([r.url.searchParams.get("followee_id"), r.url.searchParams.get("follower_id")]).toContain(`eq.${ME}`);
      expect(r.url.searchParams.get("followee_id")?.startsWith("in.") || r.url.searchParams.get("follower_id")?.startsWith("in.")).toBe(true);
    }
    expect(await profiles.fetchFollowsAmong(ME, [])).toEqual({ following: [], followers: [] });
    expect(h.requests.length).toBe(2);
  });

  it("where I stand with the members on a page, in one read of those rows", async () => {
    const fans = crowd(40);
    h.requests.length = 0;
    const states = await profiles.fetchFollowStates(ME, fans.slice(0, 30));
    expect(states).toEqual({ [fans[1]]: "accepted", [fans[2]]: "pending" });
    expect(h.requests.length).toBe(1);
    expect(h.requests[0].url.searchParams.get("follower_id")).toBe(`eq.${ME}`);
    expect(await profiles.fetchFollowStates(ME, [])).toEqual({});
  });

  it("requests waiting on me come newest first, without a member who cannot be read", async () => {
    crowd(400);
    const list = await profiles.fetchPendingRequests(STAR);
    const read = h.requests.find((r) => r.url.pathname === "/rest/v1/follows")!;
    expect(read.url.searchParams.get("order")).toBe("created_at.desc");
    const pending = h.tables.follows
      .filter((f) => f.followee_id === STAR && f.status === "pending")
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    expect(pending.some((f) => !h.tables.profiles.some((p) => p.id === f.follower_id))).toBe(true);
    expect(list.map((p) => p.id)).toEqual(
      pending.map((f) => f.follower_id).filter((m) => h.tables.profiles.some((p) => p.id === m)),
    );
  });
});

describe("the admin's queues", () => {
  const ADMIN = id("a0", 0);
  function queue(n: number) {
    h.tables.profiles = [ADMIN, ME].map((p, i) => ({ id: p, username: i ? "me" : "admin" }));
    const post = id("a1", 0);
    h.tables.comments = [{ id: id("a2", 0), post_id: post, author_id: ME, body: "what was said", removed_at: null }];
    h.tables.reports = Array.from({ length: n }, (_, i) => ({
      id: id("a3", i),
      reporter_id: i % 7 === 3 ? null : ADMIN,
      target_type: i % 3 === 0 ? "comment" : i % 3 === 1 ? "profile" : "post",
      post_id: i % 3 === 2 ? post : null,
      comment_id: i % 3 === 0 ? id("a2", 0) : null,
      profile_id: i % 3 === 1 ? ME : null,
      reason: "Spam or scam",
      status: i % 4 === 0 ? "resolved" : "open",
      // Several filed in the same second.
      created_at: at(Math.floor(i / 2)),
    }));
    h.tables.applications = Array.from({ length: n }, (_, i) => ({
      id: id("a4", i), user_id: id("a5", i), status: i % 5 === 0 ? "approved" : "pending", created_at: at(Math.floor(i / 3)),
    }));
  }

  async function walkReports(status: "open" | "resolved") {
    const ids: string[] = [];
    let after: import("@/api/moderation").AdminCursor | null = null;
    for (let i = 0; i < 100; i++) {
      const page = await moderation.fetchReports(status, after);
      ids.push(...page.map((r) => r.id));
      const next = moderation.nextAdminCursor(page);
      if (!next) break;
      after = next;
    }
    return ids;
  }

  it("open reports come fifty at a time, oldest first, every one once, past a thousand", async () => {
    queue(1500);
    const all = await walkReports("open");
    const truth = h.tables.reports
      .filter((r) => r.status === "open")
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
      .map((r) => r.id);
    expect(all).toEqual(truth);
    expect(all.length).toBeGreaterThan(1000);
    const reads = h.requests.filter((r) => r.url.pathname === "/rest/v1/reports");
    for (const r of reads) {
      expect(r.url.searchParams.get("limit")).toBe("50");
      expect(r.url.searchParams.get("order")).toBe("created_at.asc,id.asc");
    }
    expect(reads[1].url.searchParams.get("created_at")).toMatch(/^gte\./);
    expect(reads[1].url.searchParams.get("or")).toMatch(/^\(created_at\.gt\."[^"]+",and\(created_at\.eq\."[^"]+",id\.gt\."[0-9a-f-]+"\)\)$/);
  });

  it("decided reports come newest first, so the latest is what a page shows", async () => {
    queue(400);
    const all = await walkReports("resolved");
    const truth = h.tables.reports
      .filter((r) => r.status === "resolved")
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))
      .map((r) => r.id);
    expect(all).toEqual(truth);
    expect(h.requests[0].url.searchParams.get("order")).toBe("created_at.desc,id.desc");
  });

  it("a comment report brings the comment, its photograph and its author; a member report the member's name", async () => {
    queue(12);
    const page = await moderation.fetchReports("open");
    expect(h.requests[0].url.searchParams.get("select")).toBe(
      "*,reporter:profiles!reports_reporter_id_fkey(id,username)" +
        ",comment:comments!reports_comment_id_fkey(id,body,post_id,removed_at,author:profiles!comments_author_id_fkey(id,username))" +
        ",member:profiles!reports_profile_id_fkey(id,username)",
    );
    const onComment = page.find((r) => r.target_type === "comment")!;
    expect(onComment.comment).toMatchObject({ body: "what was said", post_id: id("a1", 0), author: { username: "me" } });
    const onMember = page.find((r) => r.target_type === "profile")!;
    expect(onMember.member).toMatchObject({ id: ME, username: "me" });
    // A report whose reporter has since gone (0031) still comes, with nobody named.
    expect(page.some((r) => r.reporter === null)).toBe(true);
  });

  it("applications waiting come fifty at a time, oldest first", async () => {
    queue(300);
    const page = await moderation.fetchApplications("pending");
    expect(page.length).toBe(50);
    expect(h.requests[0].url.searchParams.get("limit")).toBe("50");
    expect(h.requests[0].url.searchParams.get("order")).toBe("created_at.asc,id.asc");
    const next = await moderation.fetchApplications("pending", moderation.nextAdminCursor(page)!);
    expect(next.some((a) => page.some((b) => b.id === a.id))).toBe(false);
    await moderation.fetchApplications("approved");
    expect(h.requests[2].url.searchParams.get("order")).toBe("created_at.desc,id.desc");
  });

  it("every queue still to be worked reads oldest first, every record of what was decided newest first", async () => {
    queue(10);
    const order = async (read: () => Promise<unknown>) => {
      h.requests.length = 0;
      await read();
      return h.requests[0].url.searchParams.get("order");
    };
    const oldest = "created_at.asc,id.asc";
    const newest = "created_at.desc,id.desc";
    expect(await order(() => moderation.fetchApplications("pending"))).toBe(oldest);
    expect(await order(() => moderation.fetchApplications("waitlisted"))).toBe(oldest);
    expect(await order(() => moderation.fetchApplications("approved"))).toBe(newest);
    expect(await order(() => moderation.fetchApplications("rejected"))).toBe(newest);
    expect(await order(() => moderation.fetchReports("open"))).toBe(oldest);
    expect(await order(() => moderation.fetchReports("resolved"))).toBe(newest);
    expect(await order(() => moderation.fetchReports("dismissed"))).toBe(newest);
  });

  it("the dashboard counts what waits without reading a row of it", async () => {
    queue(1500);
    expect(await moderation.countReports("open")).toBe(h.tables.reports.filter((r) => r.status === "open").length);
    expect(await moderation.countApplications("pending")).toBe(h.tables.applications.filter((a) => a.status === "pending").length);
    for (const r of h.requests) {
      expect(r.method).toBe("HEAD");
      expect(r.url.searchParams.get("select")).toBe("id");
    }
    const dashboard = readFileSync(join(__dirname, "..", "app", "admin", "index.tsx"), "utf8");
    expect(dashboard).toMatch(/queryFn: \(\) => countApplications\("pending"\)/);
    expect(dashboard).toMatch(/queryFn: \(\) => countReports\("open"\)/);
    expect(dashboard).not.toMatch(/fetchApplications|fetchReports|\.length \?\? 0/);
  });
});
