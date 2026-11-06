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
 * their own). Writes, and requests that bring their own signal (the post
 * outbox's), go out as before, and a visitor who is not signed in (the
 * door, an invitation) reads as a visitor.
 */
let unsigned = false;
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
    if (urlOf(input).includes("/rest/v1/")) {
      const bearer = new Headers(init?.headers).get("Authorization");
      if (!bearer || bearer === `Bearer ${publicKey}`) {
        unsigned = true;
        const method = (init?.method ?? "GET").toUpperCase();
        if (memberHere && !init?.signal && (method === "GET" || method === "HEAD")) {
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
