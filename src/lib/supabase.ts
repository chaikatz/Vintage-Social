import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";
import { isDemoMode, requireEnv } from "./env";
import type { Database } from "@/types/db";
import { forgetDarkroom } from "@/darkroom/forget";

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
});

// The Darkroom's memory on this phone goes with the session. Listened for
// here, as the client is made, rather than in the session provider: auth
// starts restoring the session the moment the client exists, and a
// refresh the server refuses at launch (a sign-out made on another
// device) says SIGNED_OUT once, to whoever is listening by then.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") forgetDarkroom();
});

// Refresh tokens only while the app is foregrounded.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
