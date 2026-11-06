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
 * the signal just returned, found Home, Activity and the inbox empty, and
 * nothing read them again once the token went through a minute later.
 *
 * This notes such a request as it goes out (any request to the database,
 * a read or a function that reads: either can come back empty), and the
 * session provider asks, when auth next says the token went through,
 * whether to read everything again.
 */
let unsigned = false;

/** `base`, noting each request to the database that carries no member's token. */
export function noteUnsignedReads(base: typeof fetch, publicKey: string): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (urlOf(input).includes("/rest/v1/")) {
      const bearer = new Headers(init?.headers).get("Authorization");
      if (!bearer || bearer === `Bearer ${publicKey}`) unsigned = true;
    }
    return base(input, init);
  }) as typeof fetch;
}

/** Whether a request went out unsigned since this was last asked; asking forgets it. */
export function takeUnsignedRead(): boolean {
  const was = unsigned;
  unsigned = false;
  return was;
}
