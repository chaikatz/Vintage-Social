/**
 * Try again when the network let us down.
 *
 * A post goes up in several requests, and any one of them can be cut off
 * by a tunnel, a dropped cell, or a server that was busy for a second.
 * None of that is a reason to tell someone their photograph failed.
 * `withRetry` runs a step again, briefly spaced out, when what went wrong
 * looks transient — and leaves a real refusal (a policy, a bad request)
 * to surface at once.
 */

/** Errors that are worth another go: no connection, a timeout, or a server that stumbled. */
export function isTransient(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (
    /network request failed|network error|failed to fetch|load failed|timed? ?out|socket|econnreset|etimedout|the internet connection appears to be offline|could not connect/.test(
      message,
    )
  ) {
    return true;
  }
  const status = Number(e.statusCode ?? e.status ?? NaN);
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
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
