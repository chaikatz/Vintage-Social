import "react-native-url-polyfill/auto";
import { createClient, type Session } from "@supabase/supabase-js";
import { onlineManager } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";
import { isDemoMode, requireEnv } from "./env";
import type { Database } from "@/types/db";
import { forgetDarkroom } from "@/darkroom/forget";
import { parseStoredSession } from "./storedSession";
import { boundedFetch } from "./boundedFetch";
import { noteUnsignedReads } from "./unsignedRead";

/**
 * Session tokens live in the iOS keychain (SecureStore), not AsyncStorage.
 * SecureStore rejects values > 2048 bytes with a warning but stores them;
 * Supabase sessions fit after we disable verbose session storage.
 */
const secureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

// In demo mode (browser review without a backend) no request ever reaches
// this client — the api layer branches into src/demo first — but the client
// must still construct, so it gets inert placeholder credentials.
const { supabaseUrl, supabaseAnonKey } = isDemoMode()
  ? { supabaseUrl: "https://demo.invalid", supabaseAnonKey: "demo-anon-key" }
  : requireEnv();

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === "web" ? undefined : secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // Every request but a file's has a limit (boundedFetch.ts), and one that
  // fails while the phone says it has no signal is handed back at once.
  // The global fetch is looked up on each call, as the client itself
  // does. A read that goes out without the member's token is noted
  // (unsignedRead.ts), so it can be read again once the token goes through.
  global: {
    fetch: noteUnsignedReads(
      boundedFetch((input, init) => fetch(input, init), () => !onlineManager.isOnline()),
      supabaseAnonKey,
    ),
  },
});

/** Where auth keeps the session on this phone: the client's own key, read back rather than worked out again. */
const sessionKey = (supabase as unknown as { storageKey?: string }).storageKey ?? "";

/**
 * The session auth has kept on this phone, straight from the keychain:
 * no request, no refresh (see storedSession.ts). Null when there is none,
 * in demo mode, or when the keychain cannot be read.
 */
export async function readStoredSession(): Promise<Session | null> {
  if (isDemoMode() || !sessionKey) return null;
  try {
    const raw =
      Platform.OS === "web"
        ? typeof localStorage !== "undefined"
          ? localStorage.getItem(sessionKey)
          : null
        : await SecureStore.getItemAsync(sessionKey);
    return parseStoredSession(raw);
  } catch {
    return null;
  }
}

// The Darkroom's memory on this phone goes with the session. Listened for
// here, as the client is made, rather than in the session provider: auth
// starts restoring the session the moment the client exists, and a
// refresh the server refuses at launch (a sign-out made on another
// device) says SIGNED_OUT once, to whoever is listening by then.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") forgetDarkroom();
});

// Refresh tokens only while the app is foregrounded. From launch too: iOS
// tells a listener the app has become active only when it changes, and by
// the time this listens on a cold start it already is, so the first run of
// the app after a launch used to go without a refresher until the next
// trip to the background.
if (!isDemoMode() && AppState.currentState !== "background") supabase.auth.startAutoRefresh();
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
