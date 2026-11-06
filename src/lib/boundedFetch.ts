import { TimeoutError } from "@/utils/retry";

/**
 * A limit on every request the Supabase client makes for the screens.
 *
 * React Native's fetch has none of its own: a request on a connection
 * that has stalled (a lift, a train, a café's portal page) waits out the
 * system's idle timeout, about a minute, before it fails. PostgREST then
 * tried a read three more times itself, and the screen's query three more
 * times over that, so a feed or a profile could sit on its skeleton for
 * many minutes with nothing to tap. Each request now has a limit, and a
 * read that reaches it fails as "timed out", which the query layer tries
 * once more and then shows as a page that did not load, with a way to try
 * again.
 *
 * Files are left alone: an upload is as long as it is, and the post
 * outbox already limits and retries its own. So is any request that
 * brings a signal of its own (the post insert, its existence check): the
 * caller has chosen its limit.
 */

/**
 * A read (GET, HEAD) still unanswered after this long is given up.
 *
 * Answered means arrived whole: React Native's fetch (whatwg-fetch over
 * XMLHttpRequest) resolves only once the whole body is in, so this limit
 * covers the download as well as the wait. Ample for the rows the app
 * reads a page at a time; a read that grows unpaged (a whole thread, a
 * whole profile) on a slow connection is what would reach it first.
 */
export const READ_LIMIT_MS = 15_000;
/** A write is given longer: one that lands late must not be taken for one that never would. */
export const WRITE_LIMIT_MS = 30_000;

/** The limit for one request, or null for one this does not limit. */
export function limitFor(url: string, method: string | undefined): number | null {
  if (url.includes("/storage/v1/")) return null;
  const m = (method ?? "GET").toUpperCase();
  return m === "GET" || m === "HEAD" ? READ_LIMIT_MS : WRITE_LIMIT_MS;
}

/**
 * The error a request that reached its limit fails with. Its message says
 * "timed out", so `isTransient` takes it for a connection that let go.
 * Its code is the one PostgREST reads as a request called off: it hands
 * that straight back instead of running the same stalled read three more
 * times. Its name is not AbortError, so nothing takes it for work the
 * member cancelled.
 */
export function requestTimedOut(): TimeoutError {
  const err = new TimeoutError("The request");
  (err as TimeoutError & { code?: string }).code = "ABORT_ERR";
  return err;
}

/** The address a request goes to, from whatever fetch was handed. */
export function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const o = input as { href?: unknown; url?: unknown };
    if (typeof o.href === "string") return o.href;
    if (typeof o.url === "string") return o.url;
  }
  return String(input);
}

function methodOf(input: unknown, init: RequestInit | undefined): string | undefined {
  if (init?.method) return init.method;
  if (input && typeof input === "object" && typeof (input as { method?: unknown }).method === "string") {
    return (input as { method: string }).method;
  }
  return undefined;
}

/** `base`, with each request it makes limited as above. */
export function boundedFetch(base: typeof fetch): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const ms = limitFor(urlOf(input), methodOf(input, init));
    if (ms == null || init?.signal) return base(input, init);
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(requestTimedOut());
        ctl.abort();
      }, ms);
    });
    // The race also covers a fetch that does not honour the signal: the
    // caller stops waiting even if the request cannot be torn down.
    return Promise.race([base(input, { ...init, signal: ctl.signal }), limit]).finally(() => clearTimeout(timer));
  }) as typeof fetch;
}
