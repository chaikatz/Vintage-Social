import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { ProfileRow } from "@/types/db";

interface SessionState {
  /** undefined while restoring the persisted session on launch. */
  session: Session | null | undefined;
  /** The signed-in member's profile; null when signed out or not yet loaded. */
  profile: ProfileRow | null;
  profileLoaded: boolean;
  isAdmin: boolean;
  isApprovedMember: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
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

  const refreshProfile = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfile(null);
      setProfileLoaded(session !== undefined);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    setProfile((data as ProfileRow | null) ?? null);
    setProfileLoaded(true);
  }, [session]);

  useEffect(() => {
    setProfileLoaded(false);
    refreshProfile();
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      session,
      profile,
      profileLoaded,
      isAdmin: profile?.role === "admin",
      isApprovedMember: profile?.status === "approved",
      refreshProfile,
      signOut,
    }),
    [session, profile, profileLoaded, refreshProfile, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
