import type { Session } from "@supabase/supabase-js";

/**
 * The session as auth keeps it on the phone, read without asking anyone.
 *
 * At launch auth will not say who is signed in until it has refreshed an
 * access token that has run out, which it has whenever the app was last
 * open more than an hour ago. That takes the network: a round trip on a
 * good one, up to half a minute of retries without one, and longer on a
 * connection that stalls. The splash waited all that time, and a launch
 * with no signal ended on the door, as if the member had been signed out.
 *
 * Who is signed in is already written on the phone, in the keychain, in
 * the shape auth itself wrote it. This reads it back, checked as auth
 * checks it: a session with its tokens, its expiry and its member. It
 * opens no request and refreshes nothing; it only says who to open the app
 * for while auth gets on with refreshing. Auth stays the one that decides:
 * a refresh the server refuses still signs the member out.
 */
export function parseStoredSession(raw: string | null | undefined): Session | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const s = value as Record<string, unknown>;
    if (typeof s.access_token !== "string" || s.access_token === "") return null;
    if (typeof s.refresh_token !== "string" || s.refresh_token === "") return null;
    if (!("expires_at" in s)) return null;
    const user = s.user as Record<string, unknown> | null | undefined;
    if (!user || typeof user !== "object" || typeof user.id !== "string" || user.id === "") return null;
    return value as Session;
  } catch {
    return null;
  }
}
