import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { router } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";
import { withRetry } from "@/utils/retry";
import { isDemoMode } from "@/lib/env";
import { demoCurrentProfile, demoSignOut, demoSubscribe } from "@/demo/store";
import type { ProfileRow } from "@/types/db";
import { forgetPushToken } from "@/utils/push";

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
  refreshProfile: () => Promise<void>;
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

  const value = useMemo<SessionState>(
    () => ({
      session: profile ? demoSession(profile) : null,
      profile,
      profileLoaded: true,
      isAdmin: profile?.role === "admin",
      isApprovedMember: profile?.status === "approved",
      isDemo: true,
      refreshProfile: async () => setProfile(demoCurrentProfile()),
      signOut: async () => {
        demoSignOut();
        await leaveToLanding();
      },
    }),
    [profile],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function SupabaseSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Keyed on who is signed in, not on the session object: a token refresh
  // hands over a new object for the same member, and re-reading the
  // profile for that used to drop `profileLoaded` — and, on a flaky
  // connection, the profile itself — which sent an approved member to the
  // waitlist screen.
  const userId = session?.user?.id ?? null;
  const restoring = session === undefined;

  const refreshProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setProfileLoaded(!restoring);
      return;
    }
    try {
      const data = await withRetry(async () => {
        const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
        if (error) throw error;
        return data as ProfileRow | null;
      });
      setProfile(data);
      setProfileLoaded(true);
    } catch {
      // The read failed, not the membership. Keep what we knew; a member
      // with no profile yet stays on the splash until a read succeeds.
      setProfile((p) => {
        if (p) setProfileLoaded(true);
        return p;
      });
    }
  }, [userId, restoring]);

  useEffect(() => {
    setProfileLoaded(false);
    refreshProfile();
  }, [refreshProfile]);

  // No profile yet and the read keeps failing: try again until it lands.
  useEffect(() => {
    if (!userId || profileLoaded) return;
    const t = setInterval(() => refreshProfile(), 6000);
    return () => clearInterval(t);
  }, [userId, profileLoaded, refreshProfile]);

  const signOut = useCallback(async () => {
    // While still signed in, so the row can be deleted under RLS.
    await forgetPushToken();
    // Signing out everywhere needs the network; without it, the session
    // must still leave this phone, or "Sign out" leaves you signed in.
    const { error } = await supabase.auth.signOut();
    if (error) await supabase.auth.signOut({ scope: "local" });
    // Nothing of this member stays for the next one to sign in on this phone.
    queryClient.clear();
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
