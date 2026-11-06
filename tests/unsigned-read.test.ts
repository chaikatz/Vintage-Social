import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { memberSignedIn, noteUnsignedReads, takeUnsignedRead } from "@/lib/unsignedRead";
import { isTransient, retryRead } from "@/utils/retry";
import { errorMessage } from "@/utils/errorMessage";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

const URL_ = "https://example.supabase.co";
const PUBLIC_KEY = "public-anon-key";

/** The phone's keychain, in memory, holding the member's session as auth wrote it. */
function keychain(expiresInSeconds: number) {
  const items = new Map<string, string>();
  items.set(
    "sb-example-auth-token",
    JSON.stringify({
      access_token: "member-token",
      refresh_token: "refresh-1",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
      user: { id: "u1", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
    }),
  );
  return {
    getItem: async (k: string) => items.get(k) ?? null,
    setItem: async (k: string, v: string) => void items.set(k, v),
    removeItem: async (k: string) => void items.delete(k),
  };
}

/**
 * The network as it is just after the signal returns: auth's refresh
 * still fails (its last failure is kept for a minute), and the database
 * answers a read, with what the token it was sent lets it see.
 */
function network() {
  const sent: { url: string; authorization: string | null }[] = [];
  const fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
    if (url.includes("/auth/v1/token")) throw new TypeError("Network request failed");
    const member = new Headers(init?.headers).get("Authorization") === "Bearer member-token";
    return new Response(JSON.stringify(member ? [{ id: "p1" }] : []), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

describe("a read that goes out without the member's token", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    takeUnsignedRead();
    memberSignedIn(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    memberSignedIn(false);
  });

  it("is noted when auth, unable to refresh a token that ran out, hands the client no session", async () => {
    const net = network();
    const client = createClient(URL_, PUBLIC_KEY, {
      auth: { storage: keychain(-60), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: noteUnsignedReads(net.fetch, PUBLIC_KEY) },
    });
    const reading = client.from("posts").select("*");
    // Auth tries its refresh for up to half a minute before giving up.
    await vi.advanceTimersByTimeAsync(31_000);
    const { data, error } = await reading;

    // The database's answer to a visitor: nothing, and no error. This is
    // what React Query would keep as the feed.
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const toDatabase = net.sent.filter((r) => r.url.includes("/rest/v1/"));
    expect(toDatabase).toHaveLength(1);
    expect(toDatabase[0].authorization).toBe(`Bearer ${PUBLIC_KEY}`);

    // Noted, once: the provider reads everything again when auth next
    // says the token went through.
    expect(takeUnsignedRead()).toBe(true);
    expect(takeUnsignedRead()).toBe(false);
  });

  it("is held back while a member is signed in: no visitor's empty answer, but a failure tried again like a dropped connection", async () => {
    memberSignedIn(true);
    const net = network();
    const client = createClient(URL_, PUBLIC_KEY, {
      auth: { storage: keychain(-60), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: noteUnsignedReads(net.fetch, PUBLIC_KEY) },
    });
    const reading = client.from("posts").select("*");
    await vi.advanceTimersByTimeAsync(31_000);
    let settled = false;
    const answered = reading.then((r) => {
      settled = true;
      return r;
    });
    // Handed back at once, not tried again by PostgREST itself.
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    const { data, error } = await answered;
    expect(data).toBeNull();
    expect(error?.message).toMatch(/Signing in again/);
    // Never sent: the database never answered it as a visitor's.
    expect(net.sent.filter((r) => r.url.includes("/rest/v1/"))).toHaveLength(0);
    // Tried again like a connection that let go; an alert says its own words.
    expect(isTransient(error)).toBe(true);
    // For as long as auth takes to get a refresh through (about a minute
    // and a half at most), not three tries: a screen that waits for an
    // answer before saying it is empty would otherwise say so meanwhile.
    expect(retryRead(3, error)).toBe(true);
    expect(retryRead(19, error)).toBe(true);
    expect(retryRead(20, error)).toBe(false);
    // A dropped connection still gets its three.
    expect(retryRead(3, new TypeError("Network request failed"))).toBe(false);
    expect(errorMessage(error, "Try again in a moment.")).toBe("Try again in a moment.");
    // And read again once the token goes through.
    expect(takeUnsignedRead()).toBe(true);
  });

  it("holds back only a screen's reads: writes, and requests with a signal of their own, go out as before", async () => {
    memberSignedIn(true);
    const passed = vi.fn(async () => new Response("[]"));
    const watched = noteUnsignedReads(passed as unknown as typeof fetch, PUBLIC_KEY);
    const anon = { Authorization: `Bearer ${PUBLIC_KEY}` };
    await watched(`${URL_}/rest/v1/comments`, { method: "POST", headers: anon });
    await watched(`${URL_}/rest/v1/posts?id=eq.p1`, { method: "GET", headers: anon, signal: new AbortController().signal });
    expect(passed).toHaveBeenCalledTimes(2);
    await expect(watched(`${URL_}/rest/v1/posts`, { method: "GET", headers: anon })).rejects.toThrow(/Signing in again/);
    // The member's own token goes through as ever.
    await watched(`${URL_}/rest/v1/posts`, { method: "GET", headers: { Authorization: "Bearer member-token" } });
    expect(passed).toHaveBeenCalledTimes(3);
  });

  it("is not noted when the member's token went with it", async () => {
    const net = network();
    const client = createClient(URL_, PUBLIC_KEY, {
      auth: { storage: keychain(3600), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: noteUnsignedReads(net.fetch, PUBLIC_KEY) },
    });
    const { data } = await client.from("posts").select("*");
    expect(data).toEqual([{ id: "p1" }]);
    expect(takeUnsignedRead()).toBe(false);
  });

  it("counts only requests to the database: auth's own, which always carry the public key, are not reads", async () => {
    const passed = vi.fn(async () => new Response("{}"));
    const watched = noteUnsignedReads(passed as unknown as typeof fetch, PUBLIC_KEY);
    await watched(`${URL_}/auth/v1/token?grant_type=refresh_token`, { headers: { Authorization: `Bearer ${PUBLIC_KEY}` } });
    await watched(`${URL_}/storage/v1/object/sign/media/a.jpg`, { headers: { Authorization: `Bearer ${PUBLIC_KEY}` } });
    expect(takeUnsignedRead()).toBe(false);
    await watched(`${URL_}/rest/v1/rpc/feed`, { method: "POST" });
    expect(takeUnsignedRead()).toBe(true);
    // Every request is passed on as it was.
    expect(passed).toHaveBeenCalledTimes(3);
  });
});

describe("the app", () => {
  it("notes its own client's unsigned reads", () => {
    expect(read("src/lib/supabase.ts")).toMatch(
      /fetch: noteUnsignedReads\(\s*boundedFetch\(\(input, init\) => fetch\(input, init\), \(\) => !onlineManager\.isOnline\(\)\),\s*supabaseAnonKey,\s*\)/,
    );
  });

  it("reads everything again once the token goes through, after launch and after a return to the app alike", () => {
    const provider = read("src/providers/SessionProvider.tsx");
    // And says whether a member is here, so their reads are never answered as a visitor's.
    expect(provider).toMatch(/useEffect\(\(\) => memberSignedIn\(userId != null\), \[userId\]\);/);
    expect(provider).toMatch(
      /if \(next && \(event === "TOKEN_REFRESHED" \|\| event === "SIGNED_IN"\)\) \{\s*const unsigned = takeUnsignedRead\(\);\s*if \(authUnreachable\.current \|\| unsigned\) \{\s*authUnreachable\.current = false;\s*void queryClient\.invalidateQueries\(\);\s*if \(next\.user\?\.id === currentUser\.current\) void readProfileAgain\.current\(\);/,
    );
  });
});
