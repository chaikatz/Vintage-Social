import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { READ_LIMIT_MS, WRITE_LIMIT_MS, boundedFetch, limitFor } from "@/lib/boundedFetch";
import { isAbortError, isTimedOut, isTransient, retryRead } from "@/utils/retry";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

/** A connection that has stalled: the request is sent and nothing ever comes back. */
function stalled() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("a limit on each request", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives up a stalled read through the real client at the limit, once, as a timeout worth one more try", async () => {
    const net = stalled();
    const client = createClient("https://example.supabase.co", "anon", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: boundedFetch(net.fetch) },
    });
    let settled = false;
    const reading = client
      .from("posts")
      .select("*")
      .then((r) => {
        settled = true;
        return r;
      });
    await vi.advanceTimersByTimeAsync(READ_LIMIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const { error, data } = await reading;
    expect(data).toBeNull();
    expect(error?.message).toMatch(/timed out/);
    // PostgREST did not run the stalled read again itself.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(net.calls.filter((c) => c.url.includes("/rest/v1/posts"))).toHaveLength(1);
    // The screen's query tries it once more, then shows it did not load.
    expect(isTransient(error)).toBe(true);
    expect(isTimedOut(error)).toBe(true);
    expect(retryRead(0, error)).toBe(true);
    expect(retryRead(1, error)).toBe(false);
  });

  it("before, the same stalled read had no limit at all", async () => {
    const net = stalled();
    const client = createClient("https://example.supabase.co", "anon", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: net.fetch },
    });
    let settled = false;
    void client
      .from("posts")
      .select("*")
      .then(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(settled).toBe(false);
  });

  it("gives a write longer, and stops waiting even for a fetch that ignores the signal", async () => {
    const deaf = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    let failure: unknown = null;
    const writing = boundedFetch(deaf)("https://x.supabase.co/rest/v1/comments", { method: "POST" }).catch((e) => {
      failure = e;
    });
    await vi.advanceTimersByTimeAsync(READ_LIMIT_MS);
    expect(failure).toBeNull();
    await vi.advanceTimersByTimeAsync(WRITE_LIMIT_MS - READ_LIMIT_MS);
    await writing;
    expect(isTimedOut(failure)).toBe(true);
    // Never taken for work the member called off.
    expect(isAbortError(failure)).toBe(false);
  });

  it("leaves files, and a caller that brought its own limit, as they were", async () => {
    expect(limitFor("https://x.supabase.co/storage/v1/object/media/a/b.jpg", "POST")).toBeNull();
    expect(limitFor("https://x.supabase.co/rest/v1/posts", "GET")).toBe(READ_LIMIT_MS);
    expect(limitFor("https://x.supabase.co/auth/v1/token?grant_type=refresh_token", "POST")).toBe(WRITE_LIMIT_MS);
    expect(limitFor("https://x.supabase.co/rest/v1/rpc/block_member", undefined)).toBe(READ_LIMIT_MS);

    const net = stalled();
    let upload = false;
    void boundedFetch(net.fetch)("https://x.supabase.co/storage/v1/object/media/a/b.jpg", { method: "POST" }).then(
      () => (upload = true),
      () => (upload = true),
    );
    const own = new AbortController();
    void boundedFetch(net.fetch)("https://x.supabase.co/rest/v1/posts", { method: "POST", signal: own.signal }).catch(
      () => undefined,
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(upload).toBe(false);
    // The caller's own signal went through untouched.
    expect(net.calls[1].init?.signal).toBe(own.signal);
  });

  it("answers in time are passed through, and their timers cleared", async () => {
    const ok = vi.fn(async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    const res = await boundedFetch(ok)("https://x.supabase.co/rest/v1/posts");
    expect(res.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the app's client", () => {
  it("limits its requests", () => {
    expect(read("src/lib/supabase.ts")).toMatch(/global: \{ fetch: noteUnsignedReads\(boundedFetch\(\(input, init\) => fetch\(input, init\)\), supabaseAnonKey\) \}/);
    expect(read("src/lib/queryClient.ts")).toMatch(/retry: \(failures, error\) => onlineManager\.isOnline\(\) && retryRead\(failures, error\),/);
  });
});
