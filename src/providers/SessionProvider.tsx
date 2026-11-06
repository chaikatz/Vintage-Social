import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { router } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { forgetStoredSession, readStoredSession, supabase } from "@/lib/supabase";
import { memberSignedIn, takeUnsignedRead } from "@/lib/unsignedRead";
import { queryClient } from "@/lib/queryClient";
import { isTransient, withRetry } from "@/utils/retry";
import { isDemoMode } from "@/lib/env";
import { demoCurrentProfile, demoSignOut, demoSubscribe } from "@/demo/store";
import type { ProfileRow } from "@/types/db";
import { forgetPushTokensEverywhere } from "@/utils/push";
import { forgetSharedPosts } from "@/api/messages";
import { claimDarkroom, forgetDarkroom } from "@/darkroom/forget";
import { forgetOutbox } from "@/uploads";
import { clearRecent } from "@/utils/searchHistory";
import { forgetMember, recallMember, rememberMember } from "./rememberedMember";
import { openSession } from "./launchSession";
import { endSession } from "./endSession";

interface SessionState {
  /** undefined while restoring the persisted session on launch. */
  session: Session | null | undefined;
  /** The signed-in member's profile; null when signed out or not yet loaded. */
  profile: ProfileRow | null;
  profileLoaded: boolean;
  isAdmin: boolean;
  isApprovedMember: boolean;
  /** True when running against the in-memory demo backend (browser review). */
  isDemo: boolean;
  /** Re-read the signed-in member's profile. Resolves true when the read landed, false when it could not. */
  refreshProfile: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Leave the app after signing out.
 *
 * Clearing the session is not enough on its own. The redirect that sends a
 * signed-out visitor to the door lives in the tab layout, and Settings and
 * the waitlist screen are *pushed on top of* that layout — so the landing
 * would render underneath while the member went on looking at Settings,
 * with no way back to sign in. Unwind the stack, then replace what's left.
 */
async function leaveToLanding(): Promise<void> {
  try {
    router.dismissAll();
  } catch {
    // Nothing pushed — already at the root of the stack.
  }
  router.replace("/(gate)/landing");
}

/**
 * Go in, once signed in or let in.
 *
 * The door's screens — landing, sign in, the invitation card, the waitlist —
 * are pushed on the root stack, and the tabs used to be pushed on top of
 * them. For a while after signing in the whole stack was still there under
 * the tabs, and a swipe from the left edge on any tab popped back to the
 * sign-in screen with the member still signed in. Unwind the door first,
 * then replace what is left with the root, which sends an approved member
 * to the tabs with nothing underneath.
 */
export async function enterApp(): Promise<void> {
  try {
    router.dismissAll();
  } catch {
    // Nothing pushed — already at the root of the stack.
  }
  router.replace("/");
}

/**
 * The Darkroom's memory on this phone — what it showed, the shelf, the
 * place, the first-visit page — belongs to one member, whose id is kept
 * beside it. Whoever signs in claims it, and finds it forgotten first if
 * it was kept for someone else (`claimDarkroom` has the rule). It is also
 * forgotten when the session ends: at "Sign out", and when auth says
 * SIGNED_OUT (see below).
 *
 * Nobody signed in is not, on its own, a reason to forget. A launch with
 * no network and an expired access token answers "nobody" while the
 * session is still on the phone, and the same member comes back as soon
 * as the token refreshes; their shelf must still be there.
 */
function useDarkroomOwner(userId: string | null): void {
  useEffect(() => {
    if (userId) claimDarkroom(userId);
  }, [userId]);
}

/** A minimal fake Session so route gates behave identically in demo mode. */
function demoSession(profile: ProfileRow): Session {
  return {
    access_token: "demo",
    refresh_token: "demo",
    token_type: "bearer",
    expires_in: 3600,
    user: { id: profile.id, aud: "demo", created_at: profile.created_at },
  } as unknown as Session;
}

function DemoSessionProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<ProfileRow | null>(() => demoCurrentProfile());

  useEffect(() => demoSubscribe(() => setProfile(demoCurrentProfile())), []);
  useDarkroomOwner(profile?.id ?? null);

  const value = useMemo<SessionState>(
    () => ({
      session: profile ? demoSession(profile) : null,
      profile,
      profileLoaded: true,
      isAdmin: profile?.role === "admin",
      isApprovedMember: profile?.status === "approved",
      isDemo: true,
      refreshProfile: async () => {
        setProfile(demoCurrentProfile());
        return true;
      },
      signOut: async () => {
        demoSignOut();
        // The demo reads the phone's own library too: nothing of this member stays.
        forgetDarkroom();
        forgetOutbox();
        // Nor what was read for them, nor who they looked for in Search.
        queryClient.clear();
        clearRecent();
        await leaveToLanding();
      },
    }),
    [profile],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * A read that found no profile while the member's token could not be
 * refreshed: it went out without the token, and no row is what such a
 * read sees. Not taken for "no profile", which would send an approved
 * member to the waitlist; it is tried again like a dropped connection.
 */
class NotSignedInYet extends Error {
  constructor() {
    super("Signing in again");
    this.name = "NotSignedInYet";
  }
}

function SupabaseSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  // Auth could not reach the server as the app opened (launchSession.ts).
  const authUnreachable = useRef(false);
  // The profile read, for the auth listener, which is made before it.
  const readProfileAgain = useRef<() => Promise<boolean>>(async () => false);
  // Who is signed in now: for the listener, and for a read that lands
  // after they have gone.
  const currentUser = useRef<string | null>(null);

  useEffect(() => {
    // Who is signed in, from the phone's own copy at once and from auth
    // when it has answered, so the launch never waits on the network to
    // find out (launchSession.ts).
    const stopOpening = openSession(supabase.auth, readStoredSession, setSession, () => {
      authUnreachable.current = true;
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // The first answer of nobody is the launch read's to give (above):
      // auth says it also when a refresh could not reach the server.
      if (event === "INITIAL_SESSION" && !next) return;
      // What was read without the member's token came back empty: at
      // launch while auth could not reach the server, and on a return to
      // the app after the token ran out with no signal, when auth hands
      // the client no session for a minute (src/lib/unsignedRead.ts).
      // Once a refresh goes through, every screen reads again, and the
      // profile of the member already here (one signing in is read as
      // they arrive, below).
      if (next && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) {
        const unsigned = takeUnsignedRead();
        if (authUnreachable.current || unsigned) {
          authUnreachable.current = false;
          void queryClient.invalidateQueries();
          if (next.user?.id === currentUser.current) void readProfileAgain.current();
        }
      }
      // SIGNED_OUT forgets the Darkroom, the recent searches and the
      // phone's push token where the client is made (src/lib/supabase.ts),
      // so that one said during launch is heard.
      // auth-js says it only once it has removed the session from this
      // phone: a sign-out, or a refresh token the server refused; a
      // refresh that failed for want of a network keeps the session.
      //
      // Any word of a member claims the Darkroom for them, not only a new
      // id: a "Sign out" that could not reach the server forgets it and
      // seals it while auth keeps the same member, who must have it back
      // (empty) when they are next heard from. A claim already made in
      // this run costs nothing.
      //
      // Posts still going up go with the session: their uploads are made
      // as the member who has just left. So does what was read for them,
      // as at "Sign out": a session ended on another device leaves the app
      // running, and the next member to sign in on this phone would
      // otherwise be shown the last one's posts, comments and threads
      // from the cache (many of its keys do not name the reader).
      if (event === "SIGNED_OUT") {
        forgetOutbox();
        forgetMember();
        queryClient.clear();
        // And the photographs passed along in their threads, kept for a few
        // minutes as their rights let them read them (src/api/messages.ts).
        forgetSharedPosts();
      }
      if (event !== "SIGNED_OUT" && next?.user?.id) claimDarkroom(next.user.id);
      setSession(next);
    });
    return () => {
      stopOpening();
      sub.subscription.unsubscribe();
    };
  }, []);

  // Keyed on who is signed in, not on the session object: a token refresh
  // hands over a new object for the same member, and re-reading the
  // profile for that used to drop `profileLoaded` — and, on a flaky
  // connection, the profile itself — which sent an approved member to the
  // waitlist screen.
  const userId = session?.user?.id ?? null;
  const restoring = session === undefined;
  useDarkroomOwner(userId);
  // While a member is here, a screen's read that auth would send without
  // their token is held back rather than answered as a visitor's
  // (src/lib/unsignedRead.ts).
  useEffect(() => memberSignedIn(userId != null), [userId]);

  // One read at a time: a second call while the first is still retrying
  // joins it instead of stacking another behind it.
  const inFlight = useRef<Promise<boolean> | null>(null);
  currentUser.current = userId;
  const refreshProfile = useCallback(async (): Promise<boolean> => {
    if (!userId) {
      setProfile(null);
      setProfileLoaded(!restoring);
      return true;
    }
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
    try {
      const data = await withRetry(
        async () => {
          const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
          if (error) throw error;
          if (!data && !(await supabase.auth.getSession()).data.session) throw new NotSignedInYet();
          return data as ProfileRow | null;
        },
        { retryOn: (err) => err instanceof NotSignedInYet || isTransient(err) },
      );
      // Read for a member who has since signed out: neither shown nor kept.
      if (currentUser.current !== userId) return false;
      setProfile(data);
      setProfileLoaded(true);
      // Kept for the next launch to open on (rememberedMember.ts).
      if (data) rememberMember(data);
      else forgetMember();
      return true;
    } catch {
      // The read failed, not the membership. Keep what we knew; a member
      // with no profile yet stays on the splash until a read succeeds.
      setProfile((p) => {
        if (p) setProfileLoaded(true);
        return p;
      });
      return false;
    }
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, [userId, restoring]);
  readProfileAgain.current = refreshProfile;

  // A member this phone has seen opens on the profile last read for them,
  // at once, and the read goes on behind it; anyone else waits for the read.
  useEffect(() => {
    const known = userId ? recallMember(userId) : null;
    if (known) {
      setProfile(known);
      setProfileLoaded(true);
    } else {
      setProfileLoaded(false);
    }
    refreshProfile();
  }, [refreshProfile]); // userId is read through refreshProfile

  // No profile yet and the read keeps failing: try again until it lands.
  useEffect(() => {
    if (!userId || profileLoaded) return;
    const t = setInterval(() => refreshProfile(), 6000);
    return () => clearInterval(t);
  }, [userId, profileLoaded, refreshProfile]);

  const signOut = useCallback(async () => {
    // The session leaves this phone whatever the network says, in a few
    // seconds at most (endSession.ts). First, while still signed in so the
    // rows can be deleted under RLS, the push tokens: sign out ends the
    // member's sessions on every phone, so every phone of theirs stops
    // being sent their notices now, not when its app next runs: this
    // one's token and the others'. Without a signal the rows stay, and
    // the session must still leave this phone, or "Sign out" leaves you
    // signed in.
    await endSession({
      auth: supabase.auth,
      asMember: () => forgetPushTokensEverywhere(currentUser.current),
      forgetStored: forgetStoredSession,
    });
    // Gone from here too before the door is shown, whether or not auth has
    // said SIGNED_OUT yet: the door lets a session it sees straight in, and
    // would let the next person into this member's account.
    currentUser.current = null;
    setSession(null);
    setProfile(null);
    // Nothing of this member stays for the next one to sign in on this phone:
    // the photographs passed along in their threads (kept for a few minutes
    // as their rights let them read them, src/api/messages.ts), what was
    // read for them, the Darkroom.
    forgetSharedPosts();
    queryClient.clear();
    forgetDarkroom();
    // Who they looked for in Search: also forgotten when auth says SIGNED_OUT
    // (src/lib/supabase.ts), and here as well in case that is not heard.
    clearRecent();
    forgetOutbox();
    forgetMember();
    await leaveToLanding();
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      session,
      profile,
      profileLoaded,
      isAdmin: profile?.role === "admin",
      isApprovedMember: profile?.status === "approved",
      isDemo: false,
      refreshProfile,
      signOut,
    }),
    [session, profile, profileLoaded, refreshProfile, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  if (isDemoMode()) return <DemoSessionProvider>{children}</DemoSessionProvider>;
  return <SupabaseSessionProvider>{children}</SupabaseSessionProvider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
