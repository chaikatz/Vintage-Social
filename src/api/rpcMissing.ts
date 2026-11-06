/**
 * Database functions the app may meet before their migration is applied.
 *
 * A build can reach members before the owner applies the migration that
 * adds a function it calls (each waits for the owner's approval). Such a
 * call is answered "no such function", and the app does what it did
 * before the function existed, the old way. So that every screen does not
 * ask twice each time meanwhile, a function found missing is not asked
 * for again for a while, then looked for again.
 */

/** How long a function found missing is left alone before it is looked for again. */
export const RPC_RECHECK_MS = 10 * 60_000;

const missingUntil = new Map<string, number>();

/** PostgREST's "no such function" (PGRST202), and Postgres's own (42883). */
export function functionMissing(error: { code?: unknown } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/** Whether `name` was found missing a short while ago, and is not to be asked for yet. */
export function rpcKnownMissing(name: string): boolean {
  return Date.now() < (missingUntil.get(name) ?? 0);
}

/** `name` is not in the database yet: leave it alone for RPC_RECHECK_MS. */
export function noteRpcMissing(name: string): void {
  missingUntil.set(name, Date.now() + RPC_RECHECK_MS);
}

/** Forget what was found missing (tests). */
export function forgetRpcMissing(): void {
  missingUntil.clear();
}
