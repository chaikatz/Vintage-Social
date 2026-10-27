/**
 * Try again when the network let us down.
 *
 * A post goes up in several requests, and any one of them can be cut off
 * by a tunnel, a dropped cell, or a server that was busy for a second.
 * None of that is a reason to tell someone their photograph failed.
 * `withRetry` runs a step again, briefly spaced out, when what went wrong
 * looks transient — and leaves a real refusal (a policy, a bad request)
 * to surface at once.
 *
 * Posting keeps exactly one retry layer: the outbox in src/uploads runs a
 * step again on its own schedule (`backoffDelay`), so the requests it
 * makes do not retry inside themselves as well. Retries that stack, three
 * inside three, are how a flaky connection used to turn into a thirty
 * second wait behind a spinner.
 */

/**
 * Errors that are worth another go: no connection, a timeout, or a server that stumbled.
 *
 * The messages come from three places: fetch in JS ("Network request
 * failed"), NSURLSession through a native upload task ("The network
 * connection was lost.", "A server with the specified hostname could not
 * be found.", which is what a phone with no signal says about DNS), and
 * our own timeouts below ("… timed out").
 */
export function isTransient(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (
    /network request failed|network error|failed to fetch|load failed|timed? ?out|socket|econnreset|etimedout|the internet connection appears to be offline|could not connect|network connection was lost|not connected to the internet|hostname could not be found/.test(
      message,
    )
  ) {
    return true;
  }
  const status = Number(e.statusCode ?? e.status ?? NaN);
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * A request that took longer than it was given. The message says "timed
 * out" on purpose, so `isTransient` treats it like any other connection
 * that let go: an aborted request may still have landed, and the retry
 * that follows is told so by the server (a 409 or a 23505).
 */
export class TimeoutError extends Error {
  constructor(what = "The request") {
    super(`${what} timed out`);
    this.name = "TimeoutError";
  }
}

/** The work was called off on purpose (a discard, a sign-out). Never retried, never shown. */
export function abortError(): Error {
  const err = new Error("Cancelled");
  err.name = "AbortError";
  return err;
}

export function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { name?: unknown }).name === "AbortError");
}

/**
 * Run `run` with an AbortSignal that fires after `ms`, or as soon as
 * `options.signal` does.
 *
 * Without this a request had no limit of its own. React Native's XHR
 * timeout is 0, so a stalled insert waited for the system's idle timeout,
 * about a minute, before anything could try again. The race also covers
 * calls that take no signal at all (storage-js has none): the caller stops
 * waiting even though the request itself cannot be torn down.
 */
export async function withTimeout<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; what?: string } = {},
): Promise<T> {
  const outer = options.signal;
  if (outer?.aborted) throw abortError();
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(options.what));
      ctl.abort();
    }, ms);
    onAbort = () => {
      reject(abortError());
      ctl.abort();
    };
    outer?.addEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([run(ctl.signal), limit]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) outer?.removeEventListener("abort", onAbort);
  }
}

/**
 * How long to wait before attempt number `attempt` (2, 3, …): `baseMs`,
 * doubling each time, never more than `maxMs`. The same curve `withRetry`
 * uses, for callers that keep their own loop (the post outbox, which must
 * also stop for a lost connection or a discard between attempts).
 */
export function backoffDelay(attempt: number, baseMs = 800, maxMs = 30_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 2));
}

export interface RetryOptions {
  /** How many times to try in total. */
  attempts?: number;
  /** Delay before the second attempt, in ms; doubles each time after. */
  baseDelayMs?: number;
  /** Decide whether a failure deserves another attempt. */
  retryOn?: (err: unknown) => boolean;
  /** Called before each retry with the attempt number about to run (2, 3, …). */
  onRetry?: (attempt: number, err: unknown) => void;
  /** Test hook. */
  sleep?: (ms: number) => Promise<void>;
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const base = options.baseDelayMs ?? 800;
  const retryOn = options.retryOn ?? isTransient;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let attempt = 1;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= attempts || !retryOn(err)) throw err;
      attempt += 1;
      options.onRetry?.(attempt, err);
      await sleep(base * 2 ** (attempt - 2));
    }
  }
}
