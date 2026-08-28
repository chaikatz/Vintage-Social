/**
 * Environment configuration.
 *
 * Values come from EXPO_PUBLIC_* variables (see .env.example). Expo inlines
 * them at build time; we validate here so a misconfigured build fails loudly
 * at startup instead of failing mysteriously on the first network call.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function requireEnv(): { supabaseUrl: string; supabaseAnonKey: string } {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase configuration. Copy .env.example to .env and set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return { supabaseUrl, supabaseAnonKey };
}
