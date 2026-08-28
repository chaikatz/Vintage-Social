import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";
import { requireEnv } from "./env";
import type { Database } from "@/types/db";

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

const { supabaseUrl, supabaseAnonKey } = requireEnv();

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === "web" ? undefined : secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is foregrounded.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
