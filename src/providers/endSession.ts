import { withTimeout } from "@/utils/retry";

/** What ending a session asks of auth: the client's own `supabase.auth`. */
export interface EndingAuth {
  getSession(): Promise<{ data: { session: { access_token: string } | null } }>;
  signOut(options: { scope: "local" }): Promise<unknown>;
  admin: { signOut(jwt: string, scope: "global"): Promise<unknown> };
}

/** How long the member's own step, which needs the network, is waited for. */
export const SIGN_OUT_STEP_MS = 4000;
/** How long auth's sign-out on this phone is waited for: storage only, unless auth is still opening. */
export const SIGN_OUT_HERE_MS = 1500;

/** `work`, waited for no longer than `ms`: what it gave, or undefined when it failed or is still out. */
function atMost<T>(ms: number, work: () => Promise<T>): Promise<T | undefined> {
  return withTimeout(ms, work).catch(() => undefined);
}

/**
 * "Sign out": the session leaves this phone, whatever the network says,
 * in a few seconds at most.
 *
 * It used to be auth's sign-out everywhere and, failing that, on this
 * phone only; and both could fail and leave the session where it was.
 * Auth removes a session only once it has loaded it, and one whose access
 * token has run out is loaded by refreshing it: with no signal the
 * refresh is tried for about 25 seconds, and for a minute after a refresh
 * that failed auth answers at once with that failure. Either way both
 * sign-outs came back with the error, the keychain kept the session, auth
 * never said SIGNED_OUT, and the app showed the door with the member
 * still signed in: the next person to tap "I have an invitation" or Apply
 * was let into their account, as was the next launch.
 *
 * 1. As the member, while still signed in: `asMember` (the push rows,
 *    which only they may delete), and auth's answer of who that is, its
 *    token refreshed if it had run out, for the sign-out everywhere in 3.
 *    Both need the network, and are waited for a few seconds at most.
 * 2. This phone: the keychain's copy is taken away by hand
 *    (`forgetStored`), then auth signs out here, which with nothing
 *    stored to load forgets the session it holds and says SIGNED_OUT.
 *    That is storage only, and waited for a moment at most: auth answers
 *    nothing until it has finished opening, and an app opened with no
 *    signal on a token that had run out is still opening for those 25
 *    seconds; it says SIGNED_OUT when it has. The session provider
 *    forgets the member itself in any case.
 * 3. Everywhere: the member's other phones signed out, with the token
 *    taken in 1 (auth's own sign-out sends this same request, with the
 *    member's own token: no key of the server's). Made after this phone
 *    has let go, so an answer that comes late changes nothing here: auth's
 *    own sign-out everywhere, landing late, would have removed whatever
 *    the phone then held, a new member's session among them. Sent and not
 *    waited for: it touches nothing on this phone, which has already let
 *    go (the session provider has forgotten the member at SIGNED_OUT),
 *    and waiting on it kept the member looking at Settings, signed out
 *    underneath, for up to a further SIGN_OUT_STEP_MS on a slow network.
 *    With no signal, or no token, the other phones stay signed in, as
 *    before.
 */
export async function endSession({
  auth,
  asMember,
  forgetStored,
  stepMs = SIGN_OUT_STEP_MS,
  hereMs = SIGN_OUT_HERE_MS,
}: {
  auth: EndingAuth;
  asMember: () => Promise<void>;
  forgetStored: () => Promise<void>;
  stepMs?: number;
  hereMs?: number;
}): Promise<void> {
  const held: { token?: string } = {};
  const who = auth.getSession().then(
    ({ data }) => {
      held.token = data.session?.access_token;
    },
    () => undefined,
  );
  await atMost(stepMs, () => Promise.all([asMember().catch(() => undefined), who]));

  await forgetStored();
  await atMost(hereMs, () => auth.signOut({ scope: "local" }));

  const token = held.token;
  if (token) void auth.admin.signOut(token, "global").catch(() => undefined);
}
