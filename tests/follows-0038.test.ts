import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Follows that respect private accounts (migration 0038), and the two
 * calls of the app that file and answer them.
 *
 * The client is the real supabase-js, pointed at a fetch that answers as
 * PostgREST would from a small table of follows, with a database that
 * has 0038 (the status of a new follow is the followee's to decide, the
 * followee may accept or decline) or one without it (the status is what
 * was sent; an accept or a decline by the followee changes no row and
 * says nothing). The database half is proven against PostgreSQL in
 * supabase/tests/17_follows_0038.sql; this holds the migration to what
 * that file proves.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const ADA = "0a380000-0000-4000-8000-000000000001"; // private
const BEN = "0a380000-0000-4000-8000-000000000002";
const PIA = "0a380000-0000-4000-8000-000000000006"; // public

type Follow = { follower_id: string; followee_id: string; status: "pending" | "accepted" };

const h = vi.hoisted(() => ({
  requests: [] as { method: string; url: URL; body?: string }[],
  follows: [] as { follower_id: string; followee_id: string; status: "pending" | "accepted" }[],
  privateIds: new Set<string>(),
  /** How the read of a followee's is_private answers: as it is, failing, or stale (public, though it is private now). */
  profileRead: "ok" as "ok" | "fails" | "stale",
  /** With 0038, or as production is before it. */
  database: "0038" as "0038" | "before",
  /** Who is signed in, for the followee's own decisions. */
  me: "",
}));

vi.mock("@/lib/env", () => ({
  isDemoMode: () => false,
  isSupabaseConfigured: () => true,
  requireEnv: () => ({ supabaseUrl: "https://proj.supabase.co", supabaseAnonKey: "anon-key" }),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const eq = (url: URL, column: string) => url.searchParams.get(column)?.replace(/^eq\./, "");

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? init.body : undefined;
  h.requests.push({ method, url, body });
  const table = url.pathname.replace("/rest/v1/", "");

  if (table === "profiles" && method === "GET") {
    if (h.profileRead === "fails") return json({ code: "57014", message: "canceling statement due to statement timeout" }, 500);
    const id = eq(url, "id")!;
    return json([{ is_private: h.profileRead === "stale" ? false : h.privateIds.has(id) }]);
  }

  if (table === "follows" && method === "POST") {
    const row = JSON.parse(body ?? "{}") as Follow;
    if (h.follows.some((f) => f.follower_id === row.follower_id && f.followee_id === row.followee_id)) {
      return json({ code: "23505", message: 'duplicate key value violates unique constraint "follows_pkey"' }, 409);
    }
    // 0038: the followee decides, whatever was sent. Before it: what was sent, or the default.
    const status = h.database === "0038" ? (h.privateIds.has(row.followee_id) ? "pending" : "accepted") : row.status ?? "accepted";
    const stored = { follower_id: row.follower_id, followee_id: row.followee_id, status } as Follow;
    h.follows.push(stored);
    return url.searchParams.get("select") ? json([{ status: stored.status }], 201) : new Response(null, { status: 201 });
  }

  const matching = (f: Follow) =>
    [...url.searchParams].every(([k, v]) => k === "select" || String((f as Record<string, string>)[k]) === v.replace(/^eq\./, ""));

  if (table === "follows" && method === "GET") {
    const rows = h.follows.filter(matching).map((f) => ({ status: f.status }));
    return json(rows);
  }

  // Row-level security: only the followee may change a follow, and only with 0038.
  const allowed = (f: Follow) => h.database === "0038" && f.followee_id === h.me;

  if (table === "follows" && method === "PATCH") {
    const changes = JSON.parse(body ?? "{}") as Partial<Follow>;
    const hit = h.follows.filter(matching).filter(allowed).filter((f) => f.status === "pending");
    for (const f of hit) Object.assign(f, changes);
    return json(hit.map((f) => ({ follower_id: f.follower_id })));
  }

  if (table === "follows" && method === "DELETE") {
    const hit = h.follows.filter(matching).filter(allowed);
    h.follows = h.follows.filter((f) => !hit.includes(f));
    return json(hit.map((f) => ({ follower_id: f.follower_id })));
  }

  throw new Error(`not modelled: ${method} ${url.pathname}${url.search}`);
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

const { follow, decideFollowRequest, REQUEST_NOT_DECIDED } = await import("@/api/profiles");

beforeEach(() => {
  h.requests = [];
  h.follows = [];
  h.privateIds = new Set([ADA]);
  h.profileRead = "ok";
  h.database = "0038";
  h.me = "";
});

describe("follow()", () => {
  it("stops when the followee's privacy cannot be read, and files nothing", async () => {
    h.profileRead = "fails";
    await expect(follow(BEN, ADA)).rejects.toMatchObject({ code: "57014" });
    expect(h.requests.filter((r) => r.method === "POST")).toHaveLength(0);
    expect(h.follows).toEqual([]);
  });

  it("files a request of a private member, and says so", async () => {
    await expect(follow(BEN, ADA)).resolves.toBe("pending");
    expect(h.follows).toEqual([{ follower_id: BEN, followee_id: ADA, status: "pending" }]);
  });

  it("follows a public member at once", async () => {
    await expect(follow(BEN, PIA)).resolves.toBe("accepted");
  });

  it("labels the button with what the database stored, not what it sent", async () => {
    // The account went private after the read: the database files a request.
    h.profileRead = "stale";
    await expect(follow(BEN, ADA)).resolves.toBe("pending");
    const insert = h.requests.find((r) => r.method === "POST")!;
    expect(JSON.parse(insert.body!)).toMatchObject({ status: "accepted" });
    expect(insert.url.searchParams.get("select")).toBe("status");
    // From the row the insert returned: no second read of the follow.
    expect(h.requests.filter((r) => r.method === "GET" && r.url.pathname.endsWith("/follows"))).toHaveLength(0);
  });

  it("when the follow was there already, reads where it stands", async () => {
    h.follows.push({ follower_id: BEN, followee_id: ADA, status: "pending" });
    h.profileRead = "stale";
    await expect(follow(BEN, ADA)).resolves.toBe("pending");
    expect(h.requests.filter((r) => r.method === "GET" && r.url.pathname.endsWith("/follows"))).toHaveLength(1);
  });

  it("before 0038, still sends the status a private account needs", async () => {
    h.database = "before";
    await expect(follow(BEN, ADA)).resolves.toBe("pending");
    expect(h.follows[0].status).toBe("pending");
  });
});

describe("decideFollowRequest()", () => {
  beforeEach(() => {
    h.me = ADA;
    h.follows.push({ follower_id: BEN, followee_id: ADA, status: "pending" });
  });

  it("accepts a waiting request, asking for the row it changed", async () => {
    await expect(decideFollowRequest(BEN, ADA, true)).resolves.toBeUndefined();
    expect(h.follows).toEqual([{ follower_id: BEN, followee_id: ADA, status: "accepted" }]);
    const patch = h.requests.find((r) => r.method === "PATCH")!;
    expect(patch.url.searchParams.get("select")).toBe("follower_id");
    expect(patch.url.searchParams.get("status")).toBe("eq.pending");
  });

  it("declines one, and only a request: an accepted follow is not taken back by a late Decline", async () => {
    await expect(decideFollowRequest(BEN, ADA, false)).resolves.toBeUndefined();
    expect(h.follows).toEqual([]);
    h.follows.push({ follower_id: BEN, followee_id: ADA, status: "accepted" });
    await expect(decideFollowRequest(BEN, ADA, false)).rejects.toThrow(REQUEST_NOT_DECIDED);
    expect(h.follows).toHaveLength(1);
    const del = h.requests.filter((r) => r.method === "DELETE").pop()!;
    expect(del.url.searchParams.get("status")).toBe("eq.pending");
    expect(del.url.searchParams.get("select")).toBe("follower_id");
  });

  it("says it failed when the database changed nothing (before 0038, as production is)", async () => {
    h.database = "before";
    await expect(decideFollowRequest(BEN, ADA, true)).rejects.toThrow(REQUEST_NOT_DECIDED);
    await expect(decideFollowRequest(BEN, ADA, false)).rejects.toThrow(REQUEST_NOT_DECIDED);
    expect(h.follows).toEqual([{ follower_id: BEN, followee_id: ADA, status: "pending" }]);
  });

  it("says it failed when the request was withdrawn meanwhile", async () => {
    h.follows = [];
    await expect(decideFollowRequest(BEN, ADA, true)).rejects.toThrow(REQUEST_NOT_DECIDED);
  });

  it("in the screen's own words for a refusal", () => {
    expect(REQUEST_NOT_DECIDED).toBe("Nothing changed. Try again in a moment.");
    expect(read("app/requests.tsx")).toContain(`"${REQUEST_NOT_DECIDED}"`);
  });
});

// ---------------------------------------------------------------------------
// the migration, held to what 17_follows_0038.sql proves
// ---------------------------------------------------------------------------
const sql = () => read("supabase/migrations/0038_follows_respect_private_accounts.sql").replace(/--[^\n]*/g, "");

describe("0038", () => {
  it("decides a member's new follow from the followee, before insert, in private, as its owner, nobody's to call", () => {
    const s = sql();
    expect(s).toMatch(
      /create or replace function private\.follow_status_from_followee\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+set search_path = ''/,
    );
    expect(s).toMatch(/if \(select auth\.uid\(\)\) is null then\s+return new;\s+end if;/);
    // Read plainly; a private followee read again with its row held, so a
    // change of is_private and the request wait for each other. Only then:
    // a follow that counts keeps bump_follow_counts' order (follower, then
    // followee), which a lock on the followee taken first would turn round.
    expect(s).toMatch(
      /select p\.is_private into v_private\s+from public\.profiles p\s+where p\.id = new\.followee_id;\s+if coalesce\(v_private, false\) then\s+select p\.is_private into v_private\s+from public\.profiles p\s+where p\.id = new\.followee_id\s+for no key update;\s+end if;\s+new\.status := case when coalesce\(v_private, false\) then 'pending' else 'accepted' end;/,
    );
    expect(s.match(/for no key update/g)).toHaveLength(1);
    // Not a share lock: two followers holding one would deadlock when both count the follow.
    expect(s).not.toMatch(/followee_id\s+for (key )?share/);
    expect(s).toMatch(/revoke execute on function private\.follow_status_from_followee\(\) from public, anon, authenticated;/);
    expect(s).toMatch(
      /create trigger follows_status_from_followee\s+before insert on public\.follows\s+for each row execute function private\.follow_status_from_followee\(\);/,
    );
  });

  it("lets the followee accept (pending to accepted only), with update granted on status alone", () => {
    const s = sql();
    expect(s).toMatch(
      /create policy "follows: followee accepts" on public\.follows\s+for update\s+using \(followee_id = \(select auth\.uid\(\)\) and status = 'pending'\)\s+with check \(followee_id = \(select auth\.uid\(\)\) and status = 'accepted'\);/,
    );
    expect(s).toMatch(/revoke update on public\.follows from anon, authenticated;\s+grant update \(status\) on public\.follows to authenticated;/);
    // Never keyed on the follower: they cannot accept themselves.
    expect(s).not.toMatch(/for update[\s\S]{0,80}follower_id = \(select auth\.uid\(\)\)/);
  });

  it("lets the followee decline or remove, in a policy of its own beside the follower's", () => {
    const s = sql();
    expect(s).toMatch(/create policy "follows: followee removes" on public\.follows\s+for delete\s+using \(followee_id = \(select auth\.uid\(\)\)\);/);
    expect(s).not.toMatch(/"follows: unfollow as self"/);
  });

  it("counts accepted follows only, the accept included, and recounts once", () => {
    const s = sql();
    expect(s).toMatch(/if old\.status = 'accepted' then\s+update public\.profiles set following_count = greatest\(0, following_count - 1\)/);
    expect(s).toMatch(/if new\.status = 'accepted' then\s+update public\.profiles set following_count = following_count \+ 1/);
    expect(s).toMatch(/after insert or delete or update of status on public\.follows\s+for each row execute function public\.bump_follow_counts\(\);/);
    expect(s).toMatch(/where f\.followee_id = pr\.id and f\.status = 'accepted'/);
    expect(s).toMatch(/and \(p\.follower_count <> c\.followers or p\.following_count <> c\.following\);/);
  });

  it("files a request as follow_request, which Activity and the push function know", () => {
    expect(sql()).toMatch(/case when new\.status = 'pending' then 'follow_request' else 'follow' end/);
    expect(read("app/(tabs)/activity.tsx")).toMatch(/case "follow_request":\s+return "asked to follow you\.";/);
    expect(read("supabase/functions/push/index.ts")).toMatch(/case "follow_request":[\s\S]{0,120}data\.route = "\/requests";/);
  });

  it("says how to roll it back, opens no transaction, grants nothing to visitors, and the owner's check has its rows", () => {
    const text = read("supabase/migrations/0038_follows_respect_private_accounts.sql");
    expect(text).toMatch(/^-- Rollback/m);
    expect(sql()).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql()).not.toMatch(/grant [^;]* to [^;]*\banon\b/i);
    expect(sql()).not.toMatch(/\bservice_role\b/);
    const verify = read("supabase/production/12_policies_read_once_verify.sql").replace(/--[^\n]*/g, "");
    for (const n of [40, 41, 42, 43, 44, 45, 46, 47, 48]) expect(verify).toMatch(new RegExp(`select ${n}, '0038:`));
  });

  it("takes a request's notice out of Activity when it is accepted, declined or withdrawn, and only a request's", () => {
    const s = sql();
    expect(s).toMatch(
      /create or replace function private\.forget_follow_request\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+set search_path = ''/,
    );
    // Still a request after the change: its notice stands.
    expect(s).toMatch(/if tg_op = 'UPDATE' and new\.status = 'pending' then\s+return null;\s+end if;/);
    expect(s).toMatch(
      /delete from public\.activity\s+where recipient_id = old\.followee_id\s+and actor_id = old\.follower_id\s+and type = 'follow_request';/,
    );
    expect(s).toMatch(/revoke execute on function private\.forget_follow_request\(\) from public, anon, authenticated;/);
    expect(s).toMatch(
      /create trigger follows_request_notice_gone\s+after update of status or delete on public\.follows\s+for each row\s+when \(old\.status = 'pending'\)\s+execute function private\.forget_follow_request\(\);/,
    );
  });

  it("lets a private account's waiting requests in when it is made public, and nothing else", () => {
    const s = sql();
    expect(s).toMatch(
      /create or replace function private\.accept_requests_when_public\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+set search_path = ''/,
    );
    expect(s).toMatch(/update public\.follows\s+set status = 'accepted'\s+where followee_id = new\.id\s+and status = 'pending';/);
    expect(s).toMatch(/revoke execute on function private\.accept_requests_when_public\(\) from public, anon, authenticated;/);
    expect(s).toMatch(
      /create trigger profiles_public_accepts_requests\s+after update of is_private on public\.profiles\s+for each row\s+when \(old\.is_private and not new\.is_private\)\s+execute function private\.accept_requests_when_public\(\);/,
    );
  });

  it("keeps a request to its two members: a restrictive read policy that leaves accepted follows as they were", () => {
    const s = sql();
    expect(s).toMatch(
      /create policy "follows: a request seen by its two members" on public\.follows\s+as restrictive for select using \(\s+status = 'accepted'\s+or follower_id = \(select auth\.uid\(\)\)\s+or followee_id = \(select auth\.uid\(\)\)\s+\);/,
    );
    // 0023's rewrite test knows it as a policy a later migration added.
    expect(read("supabase/tests/08_policy_rewrite.sql")).toMatch(/\('follows', 'follows: a request seen by its two members'\)\)\)\),/);
    // Nothing in the app asks for another member's request: every read of follows names the member
    // asking on one side, or asks for accepted follows only.
    for (const file of ["src/api/profiles.ts", "src/api/posts.ts"]) {
      const src = read(file);
      for (const [query] of src.matchAll(/\.from\("follows"\)[\s\S]*?;/g)) {
        // A write, or the table named for one below (decideFollowRequest).
        if (/\.(insert|delete|update)\(/.test(query) || query === '.from("follows");') continue;
        expect(query, `${file}: ${query.slice(0, 120)}`).toMatch(/\.eq\("status", "accepted"\)|\.eq\("follower_id", followerId\)|\.eq\("followee_id", followeeId\)|\.eq\("follower_id", userId\)/);
      }
    }
  });

  it("has a way back that is a tested file: everything 0038 makes taken away, and counts as 0001 counts them", () => {
    const header = read("supabase/migrations/0038_follows_respect_private_accounts.sql");
    expect(header).toMatch(/^-- Rollback: supabase\/tests\/0038_rollback\.sql/m);
    const back = read("supabase/tests/0038_rollback.sql").replace(/--[^\n]*/g, "");
    expect(back).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(back.split(";").map((st) => st.trim()).find(Boolean)).toBe("set local lock_timeout = '5s'");
    for (const made of [
      /drop trigger if exists follows_status_from_followee on public\.follows;/,
      /drop function if exists private\.follow_status_from_followee\(\);/,
      /drop trigger if exists follows_request_notice_gone on public\.follows;/,
      /drop function if exists private\.forget_follow_request\(\);/,
      /drop trigger if exists profiles_public_accepts_requests on public\.profiles;/,
      /drop function if exists private\.accept_requests_when_public\(\);/,
      /drop policy if exists "follows: followee accepts" on public\.follows;/,
      /drop policy if exists "follows: followee removes" on public\.follows;/,
      /drop policy if exists "follows: a request seen by its two members" on public\.follows;/,
      /grant update on public\.follows to anon, authenticated;/,
      /create trigger follows_count_trigger\s+after insert or delete on public\.follows\s+for each row execute function public\.bump_follow_counts\(\);/,
    ]) expect(back).toMatch(made);
    // Every trigger, function and policy 0038 makes, the rollback takes away.
    const s = sql();
    for (const [, name] of s.matchAll(/create trigger (\w+)/g)) {
      if (name !== "follows_count_trigger") expect(back, name).toMatch(new RegExp(`drop trigger if exists ${name} `));
    }
    for (const [, name] of s.matchAll(/create or replace function private\.(\w+)\(/g)) {
      expect(back, name).toMatch(new RegExp(`drop function if exists private\\.${name}\\(\\);`));
    }
    for (const [, name] of s.matchAll(/create policy "([^"]+)"/g)) {
      expect(back, name).toMatch(new RegExp(`drop policy if exists "${name}"`));
    }
    // 0001's two functions, word for word.
    const first = read("supabase/migrations/0001_schema.sql");
    for (const fn of ["bump_follow_counts", "notify_follow"]) {
      const body = (text: string) => text.match(new RegExp(`create or replace function public\\.${fn}\\(\\)[\\s\\S]*?\\$\\$;`))?.[0];
      expect(body(first), fn).toMatch(/^create or replace function/);
      expect(body(back), fn).toBe(body(first));
    }
    // The recount is of every follow, requests included (no status in it), as 0001's trigger counts.
    const recount = back.slice(back.lastIndexOf("update public.profiles p"));
    expect(recount).toMatch(/\(select count\(\*\) from public\.follows f where f\.followee_id = pr\.id\)::int as followers/);
    expect(recount).toMatch(/\(select count\(\*\) from public\.follows f where f\.follower_id = pr\.id\)::int as following/);
    expect(recount).not.toMatch(/status/);
    // Applied for real in the harness, then 0038 again over it.
    const test = read("supabase/tests/17_follows_0038.sql");
    expect(test.indexOf("\\ir 0038_rollback.sql")).toBeGreaterThan(0);
    expect(test.lastIndexOf("\\ir ../migrations/0038_follows_respect_private_accounts.sql")).toBeGreaterThan(test.indexOf("\\ir 0038_rollback.sql"));
  });

  it("is proven on its own, straight after 0022, before 0023-0037", () => {
    const runner = read("supabase/tests/run.mjs");
    expect(runner).toMatch(/const alone = "vintage_0038_first";/);
    expect(runner).toMatch(/\.\.\.migrationFiles\.filter\(\(f\) => f\.split\("\/"\)\.pop\(\) < "0023"\),\s+first,\s+\.\.\.migrationFiles\.filter\(\(f\) => f\.split\("\/"\)\.pop\(\) >= "0023" && f !== first\),/);
    expect(runner).toMatch(/psqlOn\(alone, \["-U", "vintage_owner", "-f", join\(here, "17_follows_0038\.sql"\)\]/);
    // So nothing in 0038 may lean on 0023-0037: the schema it uses is made if it is missing.
    expect(sql()).toMatch(/create schema if not exists private;/);
  });

  it("waits five seconds at most for a lock, and the harness runs its test", () => {
    expect(sql().split(";").map((st) => st.trim()).find(Boolean)).toBe("set local lock_timeout = '5s'");
    expect(read("supabase/tests/run.mjs")).toMatch(/"17_follows_0038\.sql"/);
    const test = read("supabase/tests/17_follows_0038.sql");
    expect(test).toMatch(/\\ir \.\.\/migrations\/0038_follows_respect_private_accounts\.sql/);
    expect(test.trim().endsWith("rollback;")).toBe(true);
    // 0023's rewrite test knows these two as policies a later migration added.
    expect(read("supabase/tests/08_policy_rewrite.sql")).toMatch(
      /\('follows', 'follows: followee accepts'\),\s+\('follows', 'follows: followee removes'\)/,
    );
  });
});
