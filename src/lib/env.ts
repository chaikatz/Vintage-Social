/**
 * Environment configuration.
 *
 * Values come from EXPO_PUBLIC_* variables (see .env.example). Expo inlines
 * them at build time; we validate here so a misconfigured build fails loudly
 * at startup instead of failing mysteriously on the first network call.
 *
 * Demo mode: when Supabase isn't configured (or EXPO_PUBLIC_DEMO_MODE=1),
 * the app runs against the in-memory demo data layer in `src/demo/` instead
 * of a backend. This exists so the UI can be reviewed in a browser (or on
 * Vercel) with zero infrastructure; with real credentials present, nothing
 * about the app changes.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const demoFlag = process.env.EXPO_PUBLIC_DEMO_MODE;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function isDemoMode(): boolean {
  if (demoFlag === "1" || demoFlag === "true") return true;
  if (demoFlag === "0" || demoFlag === "false") return false;
  return !isSupabaseConfigured();
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
