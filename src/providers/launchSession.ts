import { isAuthRetryableFetchError, type Session } from "@supabase/supabase-js";

/** The session as the provider holds it: undefined until anyone has said. */
export type HeldSession = Session | null | undefined;

/** What the launch needs of auth: its own answer. */
export interface LaunchAuth {
  getSession(): Promise<{ data: { session: Session | null }; error: unknown }>;
}

/**
 * Who is signed in, as the app opens, without waiting on the network.
 *
 * Two answers are asked for at once. The phone's own copy of the session
 * (`readStored`, from the keychain: no request) comes back in a moment
 * and opens the app for that member while nothing else has been said.
 * Auth's answer comes when it has refreshed an access token that has run
 * out, which can take a round trip, or half a minute of retries with no
 * signal; when it comes it is the answer, whatever the copy said.
 *
 * Except one: auth says "nobody" when the refresh could not reach the
 * server, though the session is still on the phone and the same member is
 * back the moment a refresh goes through. That is not taken for a
 * sign-out. The member stays (or is let in, from the copy), and the
 * events auth sends later (a refresh that worked, or a sign-out because
 * the server refused the session) carry on from there.
 *
 * `set` takes an update of what is held, so an event auth sent meanwhile
 * (a sign-out, a refresh) is never overwritten by an older answer.
 * `unreachable` is told when auth could not reach the server: until a
 * refresh goes through, what the app reads goes out without the member's
 * token and comes back empty, so it is read again then.
 * Returns the way to stop listening for both answers.
 */
export function openSession(
  auth: LaunchAuth,
  readStored: () => Promise<Session | null>,
  set: (update: (now: HeldSession) => HeldSession) => void,
  unreachable: () => void = () => undefined,
): () => void {
  let alive = true;
  readStored().then(
    (stored) => {
      if (alive && stored) set((now) => (now === undefined ? stored : now));
    },
    () => undefined,
  );
  const stillHere = () => {
    unreachable();
    return readStored().then(
      (stored) => {
        if (alive) set((now) => (now !== undefined ? now : stored));
      },
      () => {
        if (alive) set((now) => (now !== undefined ? now : null));
      },
    );
  };
  auth.getSession().then(
    ({ data, error }) => {
      if (!alive) return;
      if (!data.session && error && isAuthRetryableFetchError(error)) void stillHere();
      else set(() => data.session);
    },
    () => {
      if (alive) void stillHere();
    },
  );
  return () => {
    alive = false;
  };
}
