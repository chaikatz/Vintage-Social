import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Sign out" takes the session off the phone, whatever the network says.
 *
 * Run on the app's own client (src/lib/supabase.ts) with the auth client
 * it ships, on a keychain of our own: a session put away three hours ago,
 * whose access token has run out and whose refresh token has not, and a
 * phone with no signal, where every request fails at once. Auth's clock
 * and timers are the test's, so its half a minute of retries is measured
 * without being waited for.
 */

const h = vi.hoisted(() => ({
  keychain: new Map<string, string>(),
  online: false,
  /** What the network was asked, in order: method, path and the token it carried. */
  sent: [] as { method: string; path: string; auth: string | null; online: boolean }[],
  signedOutHeard: 0,
  /** A slow network: the sign-out of the other phones has not been answered yet. */
  logoutHangs: false,
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  // In the background, so the client starts no refresh timer of its own.
  AppState: { currentState: "background", addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock("react-native-url-polyfill/auto", () => ({}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => h.keychain.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void h.keychain.set(k, v),
  deleteItemAsync: async (k: string) => void h.keychain.delete(k),
}));
vi.mock("@tanstack/react-query", () => ({ onlineManager: { isOnline: () => h.online } }));
vi.mock("@/lib/env", () => ({
  isDemoMode: () => false,
  requireEnv: () => ({ supabaseUrl: "https://vintage.invalid", supabaseAnonKey: "anon" }),
}));
vi.mock("@/darkroom/forget", () => ({ forgetDarkroom: () => undefined }));
vi.mock("@/utils/searchHistory", () => ({ clearRecent: () => undefined }));
// The client's own SIGNED_OUT listener lets the phone's push token go.
vi.mock("@/utils/pushKept", () => ({ pushAfterSignedOut: async () => void (h.signedOutHeard += 1) }));

/** Where auth keeps the session for this project: sb-<project>-auth-token. */
const KEY = "sb-vintage-auth-token";

function storedSession(token = "old", expiresAt = Math.floor(Date.now() / 1000) - 3 * 3600) {
  return {
    access_token: token,
    refresh_token: "r1",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id: "a", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
  };
}

/** The network: nothing with no signal; with one, auth refreshes and signs out, and the database answers. */
async function network(input: unknown, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const headers = new Headers(init?.headers);
  h.sent.push({ method: init?.method ?? "GET", path: url.pathname + url.search, auth: headers.get("Authorization"), online: h.online });
  if (!h.online) throw new TypeError("Network request failed");
  const json = (status: number, body: unknown) =>
    new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.pathname === "/auth/v1/token") {
    return json(200, { ...storedSession("fresh", Math.floor(Date.now() / 1000) + 3600), refresh_token: "r2" });
  }
  if (url.pathname === "/auth/v1/logout") return h.logoutHangs ? new Promise<Response>(() => undefined) : json(204, null);
  return json(200, []);
}

/** Let auth's timers run, a tenth of a second at a time, until `p` settles or `ms` has gone by. */
async function run<T>(p: Promise<T>, ms: number): Promise<{ done: boolean; took: number; value?: T }> {
  const start = Date.now();
  const out: { done: boolean; took: number; value?: T } = { done: false, took: 0 };
  void p.then((value) => {
    out.done = true;
    out.value = value;
    out.took = Date.now() - start;
  });
  for (let t = 0; t < ms && !out.done; t += 100) await vi.advanceTimersByTimeAsync(100);
  return out;
}

/**
 * The app opened with the session on the phone, as the client module is
 * loaded. `settle` lets auth finish opening (its refresh failing for want
 * of a signal, which keeps the session), as an app open for a while has.
 */
async function openApp({ settle = true } = {}) {
  vi.resetModules();
  h.keychain.set(KEY, JSON.stringify(storedSession()));
  const client = await import("@/lib/supabase");
  const events: string[] = [];
  const { data } = client.supabase.auth.onAuthStateChange((event) => void events.push(event));
  if (settle) await run(client.supabase.auth.getSession(), 40_000);
  return { ...client, events, stop: () => data.subscription.unsubscribe() };
}

/** What the session provider hands over: the push rows, removed as the member (a request that needs their token). */
function pushRows(supabase: Awaited<ReturnType<typeof openApp>>["supabase"]) {
  return async () => {
    await supabase.from("push_tokens").delete().eq("user_id", "a").select("token");
  };
}

let quiet: { mockRestore: () => void } | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.stubGlobal("fetch", network);
  h.keychain.clear();
  h.online = false;
  h.sent = [];
  h.signedOutHeard = 0;
  h.logoutHangs = false;
  // Auth warns about a refresh that could not reach the server.
  quiet = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  quiet?.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("auth's own sign-out, with no signal and a token that has run out", () => {
  it("leaves the session on the phone, says nothing, and the one everywhere waits about 25 seconds", async () => {
    const { supabase, events, stop } = await openApp();
    try {
      // A minute after the failed refresh: both answer at once, with it.
      const everywhere = await run(supabase.auth.signOut(), 1000);
      expect(everywhere.done).toBe(true);
      expect(everywhere.value?.error?.name).toBe("AuthRetryableFetchError");
      const here = await run(supabase.auth.signOut({ scope: "local" }), 1000);
      expect(here.value?.error?.name).toBe("AuthRetryableFetchError");
      expect(h.keychain.has(KEY)).toBe(true);
      expect(events).not.toContain("SIGNED_OUT");

      // Past that minute, the sign-out everywhere tries the refresh again, for about 25 seconds.
      vi.setSystemTime(Date.now() + 61_000);
      const later = await run(supabase.auth.signOut(), 40_000);
      expect(later.done).toBe(true);
      expect(later.took).toBeGreaterThan(20_000);
      expect(later.value?.error?.name).toBe("AuthRetryableFetchError");
      expect(h.keychain.has(KEY)).toBe(true);
      expect(events).not.toContain("SIGNED_OUT");
    } finally {
      stop();
    }
  });
});

describe("Sign out (endSession)", () => {
  it("takes the session off the phone, says SIGNED_OUT, and is done in seconds: in the minute after a failed refresh", async () => {
    const { supabase, forgetStoredSession, events, stop } = await openApp();
    const { endSession, SIGN_OUT_STEP_MS } = await import("@/providers/endSession");
    try {
      const out = await run(endSession({ auth: supabase.auth, asMember: pushRows(supabase), forgetStored: forgetStoredSession }), 60_000);
      expect(out.done).toBe(true);
      expect(out.took).toBeLessThan(SIGN_OUT_STEP_MS);
      expect(h.keychain.has(KEY)).toBe(false);
      expect(events.filter((e) => e === "SIGNED_OUT")).toHaveLength(1);
      // The client's own listener heard it: the phone stops being sent the member's notices.
      expect(h.signedOutHeard).toBe(1);
      // And it stays gone: nobody is signed in, and nothing comes back with the signal.
      h.online = true;
      const after = await run(supabase.auth.getSession(), 1000);
      expect(after.value?.data.session).toBeNull();
      expect(after.value?.error).toBeNull();
      expect(h.keychain.has(KEY)).toBe(false);
    } finally {
      stop();
    }
  });

  it("is done in seconds, not 25, when auth would try the refresh again", async () => {
    const { supabase, forgetStoredSession, events, stop } = await openApp();
    const { endSession, SIGN_OUT_STEP_MS } = await import("@/providers/endSession");
    try {
      vi.setSystemTime(Date.now() + 61_000);
      const out = await run(endSession({ auth: supabase.auth, asMember: pushRows(supabase), forgetStored: forgetStoredSession }), 60_000);
      expect(out.done).toBe(true);
      // The member's rows are waited for a few seconds, and no longer.
      expect(out.took).toBeGreaterThanOrEqual(SIGN_OUT_STEP_MS);
      expect(out.took).toBeLessThan(2 * SIGN_OUT_STEP_MS);
      expect(h.keychain.has(KEY)).toBe(false);
      expect(events).toContain("SIGNED_OUT");
      // The refresh still out when the session went gets through once the
      // signal is back, and is not let put the session back.
      h.online = true;
      await run(new Promise(() => undefined), 40_000);
      expect(h.sent.some((r) => r.path.startsWith("/auth/v1/token") && r.online)).toBe(true);
      expect(events).not.toContain("TOKEN_REFRESHED");
      expect((await run(supabase.auth.getSession(), 1000)).value?.data.session).toBeNull();
      expect(h.keychain.has(KEY)).toBe(false);
    } finally {
      stop();
    }
  });

  it("takes the session off the phone while the app is still opening on it, with no signal", async () => {
    // Opened a moment ago: auth's own start is still trying the refresh, and answers nothing until it stops.
    const { supabase, forgetStoredSession, events, stop } = await openApp({ settle: false });
    const { endSession, SIGN_OUT_STEP_MS, SIGN_OUT_HERE_MS } = await import("@/providers/endSession");
    try {
      const out = await run(endSession({ auth: supabase.auth, asMember: pushRows(supabase), forgetStored: forgetStoredSession }), 60_000);
      expect(out.done).toBe(true);
      expect(out.took).toBeLessThanOrEqual(SIGN_OUT_STEP_MS + SIGN_OUT_HERE_MS + 100);
      expect(h.keychain.has(KEY)).toBe(false);
      // The signal comes back while auth is still opening: its refresh
      // goes through, and is not let put the session back. Once auth has
      // finished opening, it says SIGNED_OUT, and nobody is signed in.
      h.online = true;
      await run(new Promise(() => undefined), 40_000);
      expect(h.sent.some((r) => r.path.startsWith("/auth/v1/token") && r.online)).toBe(true);
      expect(events).not.toContain("TOKEN_REFRESHED");
      expect(events).toContain("SIGNED_OUT");
      expect((await run(supabase.auth.getSession(), 1000)).value?.data.session).toBeNull();
      expect(h.keychain.has(KEY)).toBe(false);
    } finally {
      stop();
    }
  });

  it("with a signal: the rows as the member, then this phone, then everywhere with the member's own token", async () => {
    h.online = true;
    const { supabase, forgetStoredSession, events, stop } = await openApp();
    const { endSession } = await import("@/providers/endSession");
    try {
      // Opened online: auth refreshed the token as it opened.
      expect(JSON.parse(h.keychain.get(KEY) ?? "{}").access_token).toBe("fresh");
      h.sent = [];
      const out = await run(endSession({ auth: supabase.auth, asMember: pushRows(supabase), forgetStored: forgetStoredSession }), 10_000);
      expect(out.done).toBe(true);
      expect(h.sent.map((r) => `${r.method} ${r.path.split("?")[0]} ${r.auth}`)).toEqual([
        "DELETE /rest/v1/push_tokens Bearer fresh",
        "POST /auth/v1/logout Bearer fresh",
      ]);
      expect(h.sent[1].path).toBe("/auth/v1/logout?scope=global");
      expect(h.keychain.has(KEY)).toBe(false);
      expect(events.filter((e) => e === "SIGNED_OUT")).toHaveLength(1);
      expect(h.signedOutHeard).toBe(1);
    } finally {
      stop();
    }
  });
});

describe("Sign out, on a slow network", () => {
  it("does not wait for the member's other phones: this phone has let go, and the request is sent", async () => {
    h.online = true;
    const { supabase, forgetStoredSession, events, stop } = await openApp();
    const { endSession, SIGN_OUT_HERE_MS } = await import("@/providers/endSession");
    try {
      h.logoutHangs = true;
      h.sent = [];
      const out = await run(endSession({ auth: supabase.auth, asMember: pushRows(supabase), forgetStored: forgetStoredSession }), 10_000);
      expect(out.done).toBe(true);
      // Storage, and the push rows that answered: nothing near the step's
      // few seconds, which it used to wait again for the other phones.
      expect(out.took).toBeLessThan(SIGN_OUT_HERE_MS);
      expect(h.keychain.has(KEY)).toBe(false);
      expect(events.filter((e) => e === "SIGNED_OUT")).toHaveLength(1);
      // The sign-out everywhere went out all the same, with the member's own token, after this phone let go.
      expect(h.sent.map((r) => `${r.method} ${r.path.split("?")[0]} ${r.auth}`)).toEqual([
        "DELETE /rest/v1/push_tokens Bearer fresh",
        "POST /auth/v1/logout Bearer fresh",
      ]);
    } finally {
      stop();
    }
  });
});

describe("the session provider", () => {
  const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");
  const provider = read("src/providers/SessionProvider.tsx");

  it("signs out through endSession, with the push rows as the member and the keychain's copy taken by hand", () => {
    expect(provider).toMatch(
      /await endSession\(\{\s*auth: supabase\.auth,\s*asMember: \(\) => forgetPushTokensEverywhere\(currentUser\.current\),\s*forgetStored: forgetStoredSession,\s*\}\);/,
    );
    // Auth is asked to sign out nowhere else in it.
    expect(provider).not.toMatch(/supabase\.auth\.signOut\(/);
  });

  it("forgets the member itself before showing the door, whether or not auth has said SIGNED_OUT", () => {
    const from = provider.indexOf("const signOut = useCallback(");
    const signOut = provider.slice(from, provider.indexOf("const value = useMemo<SessionState>", from));
    expect(signOut).toMatch(
      /await endSession\([\s\S]*?\);\s*(\/\/[^\n]*\n\s*)*currentUser\.current = null;\s*setSession\(null\);\s*setProfile\(null\);/,
    );
    expect(signOut.indexOf("setSession(null)")).toBeLessThan(signOut.indexOf("await leaveToLanding()"));
  });

  it("Settings' and the waiting room's Sign out show they are at work, and a second tap asks nothing more", () => {
    const settings = read("app/settings.tsx");
    expect(settings).toMatch(
      /const leave = async \(\) => \{\s*if \(leaving\.current\) return;\s*leaving\.current = true;\s*setSigningOut\(true\);\s*try \{\s*await signOut\(\);\s*\} finally \{\s*leaving\.current = false;\s*setSigningOut\(false\);\s*\}\s*\};/,
    );
    expect(settings).toMatch(
      /<Button\s+title="Sign out"\s+variant="secondary"\s+loading=\{signingOut\}\s+disabled=\{deleting\}\s+onPress=\{\(\) =>\s*showAlert\("Sign out\?", undefined, \[\s*\{ text: "Sign out", style: "destructive", onPress: leave \},/,
    );
    expect(settings).not.toMatch(/onPress: signOut \}/);
    const pending = read("app/(gate)/pending.tsx");
    expect(pending).toMatch(
      /const leave = async \(\) => \{\s*if \(leaving\.current\) return;\s*leaving\.current = true;\s*setSigningOut\(true\);\s*try \{\s*await signOut\(\);\s*\} finally \{\s*leaving\.current = false;\s*setSigningOut\(false\);\s*\}\s*\};/,
    );
    expect(pending).toMatch(/<GateButton title="Sign out" variant="quiet" onPress=\{leave\} loading=\{signingOut\} disabled=\{deleting\}/);
    expect(pending).toMatch(/<GateButton title="Delete my account" variant="quiet" onPress=\{confirmDelete\} loading=\{deleting\} disabled=\{signingOut\}/);
    // Its hooks above the redirect, as every hook of that screen is.
    expect(pending.indexOf("const [signingOut, setSigningOut]")).toBeLessThan(pending.indexOf("if (session === null) return <Redirect"));
  });

  it("forgets the photographs kept from the member's threads wherever the session ends", () => {
    // Read under the member's rights and kept a few minutes (src/api/messages.ts):
    // the next member on the phone was shown what only the last one could see.
    expect(provider).toMatch(/import \{ forgetSharedPosts \} from "@\/api\/messages";/);
    const from = provider.indexOf("const signOut = useCallback(");
    const signOut = provider.slice(from, provider.indexOf("const value = useMemo<SessionState>", from));
    expect(signOut).toMatch(/forgetSharedPosts\(\);\s*queryClient\.clear\(\);/);
    expect(provider).toMatch(/if \(event === "SIGNED_OUT"\) \{[^}]*queryClient\.clear\(\);[^}]*forgetSharedPosts\(\);\s*\}/);
    // Not where the client is made: messages.ts imports that module.
    expect(read("src/lib/supabase.ts")).not.toMatch(/@\/api\/messages/);
  });

  it("the helper removes the client's own key, on the phone and on the web", () => {
    const client = read("src/lib/supabase.ts");
    expect(client).toMatch(/export async function forgetStoredSession\(\): Promise<void> \{\s*if \(isDemoMode\(\) \|\| !sessionKey\) return;/);
    expect(client).toMatch(/localStorage\.removeItem\(sessionKey\)/);
    expect(client).toMatch(/await SecureStore\.deleteItemAsync\(sessionKey\);/);
  });
});
