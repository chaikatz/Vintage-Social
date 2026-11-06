import { urlOf } from "./boundedFetch";

/**
 * Whether a request to the database went out without the member's token.
 *
 * Auth hands the client no session while it cannot refresh an access
 * token that has run out: with no signal, and for a minute after a
 * refresh failed (auth keeps that failure and gives it back to every
 * caller meanwhile, rather than ask the server again). The client then
 * sends the project's public key in its place. The database answers
 * such a read as it answers a visitor who is not signed in: with
 * nothing, and no error. React Query keeps that nothing as the answer,
 * so a member coming back to the app after an hour in a dead zone, with
 * the signal just returned, found Home, Activity and the inbox empty
 * (a feed already on screen was replaced by nothing), and nothing read
 * them again once the token went through a minute later.
 *
 * Two things follow. Such a request is noted as it goes out (any request
 * to the database: a read, or a function that reads, can come back
 * empty), and the session provider asks, when auth next says the token
 * went through, whether to read everything again. And while a member is
 * signed in, a screen's read that would go out so is not sent at all: it
 * fails as "signing in again", which the app takes for a connection that
 * let go. A screen that had something keeps it, and one that had nothing
 * says it could not load, instead of either showing an empty state that
 * is not true; both read again once the token goes through.
 *
 * Only a screen's reads are held back (GET and HEAD with no signal of
 * their own, and the database functions named in READ_ONLY_RPCS, which
 * supabase.rpc() sends as POST). Writes, every other function, and
 * requests that bring their own signal (the post outbox's), go out as
 * before, and a visitor who is not signed in (the door, an invitation)
 * reads as a visitor.
 */
let unsigned = false;

/**
 * Database functions that only read, and read as the member: sent
 * without the member's token, they answer as to a visitor (refused, or
 * nothing), which a screen would keep as its answer. supabase.rpc() sends
 * every function as a POST, which is held back nowhere else here, so
 * each such function is named, one by one: a function that writes must
 * never be held back by a guess. One whose answer is the same for anyone
 * (`username_available`, `invite_link_owner`, asked at the door) has no
 * need to be. A new read-only function a signed-in screen calls belongs
 * here.
 */
export const READ_ONLY_RPCS: readonly string[] = Object.freeze([
  // Home's feed (migration 0025): the member's own and followed posts.
  "feed_page",
  // Admin: the invitations a new member is given (migration 0016).
  "default_invite_quota",
]);

/** The database function a request calls, or null for any other request. */
export function rpcName(url: string): string | null {
  const m = /\/rest\/v1\/rpc\/([^/?#]+)/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** Whether a request made with `method` to `url` only reads: what is held back while signing in again. */
export function isScreenRead(method: string, url: string): boolean {
  if (method === "GET" || method === "HEAD") return true;
  if (method !== "POST") return false;
  const fn = rpcName(url);
  return fn != null && READ_ONLY_RPCS.includes(fn);
}
let memberHere = false;

/** Whether the app holds a signed-in member: the session provider says so each time that changes. */
export function memberSignedIn(here: boolean): void {
  memberHere = here;
}

/**
 * The failure of a read held back while signing in again. Its message
 * is one `isTransient` knows, so the read is tried again like a dropped
 * connection and an alert says its own words, never this; its code is
 * the one PostgREST hands back at once rather than retrying itself.
 */
export function signingInAgain(): Error {
  const err = new Error("Signing in again");
  err.name = "SigningInAgain";
  (err as Error & { code?: string }).code = "ABORT_ERR";
  return err;
}

/** `base`, noting each request to the database that carries no member's token, and holding back a screen's read made so while a member is signed in. */
export function noteUnsignedReads(base: typeof fetch, publicKey: string): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = urlOf(input);
    if (url.includes("/rest/v1/")) {
      const bearer = new Headers(init?.headers).get("Authorization");
      if (!bearer || bearer === `Bearer ${publicKey}`) {
        unsigned = true;
        const method = (init?.method ?? "GET").toUpperCase();
        if (memberHere && !init?.signal && isScreenRead(method, url)) {
          return Promise.reject(signingInAgain());
        }
      }
    }
    return base(input, init);
  }) as typeof fetch;
}

/** Whether a request was made unsigned (sent, or held back) since this was last asked; asking forgets it. */
export function takeUnsignedRead(): boolean {
  const was = unsigned;
  unsigned = false;
  return was;
}
