import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signing out stops this phone being told about the member who left: the
 * token's row is removed, the one this launch filed or the one an earlier
 * launch kept; and where it cannot be, the phone stops receiving.
 */

const h = vi.hoisted(() => ({
  disk: new Map<string, unknown>(),
  permission: "granted" as string,
  token: "ExponentPushToken[phone]" as string | null,
  tokenFails: false,
  fileFails: false,
  deleteFails: false,
  /** Rows a delete of the token removes: 0 when the row is another member's (RLS removes nothing and says nothing). */
  rowsRemoved: 1,
  filed: [] as string[],
  deleted: [] as string[],
  /** The members every row of whom was removed (signing out everywhere). */
  deletedAllOf: [] as string[],
  deleteAllFails: false,
  unregistered: 0,
  // The keychain auth keeps the session in, and what the auth server says to a refresh.
  keychain: new Map<string, string>(),
  refresh: "refused" as "refused" | "online",
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  // In the background, so the client starts no refresh timer of its own here.
  AppState: { currentState: "background", addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock("expo-router", () => ({ useRouter: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}), onlineManager: { isOnline: () => true } }));
vi.mock("expo-device", () => ({ isDevice: true, manufacturer: "Apple", modelName: "iPhone" }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: { eas: { projectId: "project" } } } } }));
vi.mock("@/lib/env", () => ({
  isDemoMode: () => false,
  requireEnv: () => ({ supabaseUrl: "https://vintage.invalid", supabaseAnonKey: "anon" }),
}));
// The app's own client module (src/lib/supabase.ts), with the auth client
// the app ships inside it, on a keychain and an auth server of our own.
vi.mock("react-native-url-polyfill/auto", () => ({}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("@/darkroom/forget", () => ({ forgetDarkroom: () => undefined }));
vi.mock("@/utils/searchHistory", () => ({ clearRecent: () => undefined }));
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@supabase/supabase-js")>();
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  return {
    ...real,
    createClient: () => ({
      auth: new real.AuthClient({
        url: "https://vintage.invalid/auth/v1",
        storageKey: KEYCHAIN_KEY,
        storage: {
          getItem: async (k: string) => h.keychain.get(k) ?? null,
          setItem: async (k: string, v: string) => void h.keychain.set(k, v),
          removeItem: async (k: string) => void h.keychain.delete(k),
        },
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        fetch: async () =>
          h.refresh === "refused"
            ? json(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" })
            : json(200, {
                ...expiredSession(),
                access_token: "new",
                refresh_token: "r2",
                expires_at: Math.floor(Date.now() / 1000) + 3600,
              }),
      }),
    }),
  };
});
const KEYCHAIN_KEY = "sb-test-auth-token";

/** The session on the phone after it was closed for three hours: the access token has run out, the refresh token has not. */
function expiredSession() {
  return {
    access_token: "old",
    refresh_token: "r1",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) - 3 * 3600,
    user: { id: "a", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
  };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
}
vi.mock("expo-notifications", () => ({
  setNotificationHandler: () => undefined,
  getPermissionsAsync: async () => ({ status: h.permission }),
  requestPermissionsAsync: async () => ({ status: h.permission }),
  getExpoPushTokenAsync: async () => {
    if (h.tokenFails) throw new Error("no signal");
    return { data: h.token };
  },
  unregisterForNotificationsAsync: async () => {
    h.unregistered += 1;
  },
}));
vi.mock("@/api/notifications", () => ({
  registerPushToken: async (_user: string, token: string) => {
    if (h.fileFails) throw new Error("no signal");
    h.filed.push(token);
  },
  unregisterPushToken: async (token: string) => {
    if (h.deleteFails) throw new Error("no signal");
    if (h.rowsRemoved > 0) h.deleted.push(token);
    return h.rowsRemoved;
  },
  // Every row of the member's goes, and the tokens that went come back:
  // this phone's among them unless its row is another member's (rowsRemoved 0).
  unregisterAllPushTokens: async (userId: string) => {
    if (h.deleteAllFails) throw new Error("no signal");
    h.deletedAllOf.push(userId);
    return [...(h.rowsRemoved > 0 && h.token ? [h.token] : []), "ExponentPushToken[their-other-phone]"];
  },
}));
// The phone's cache folder, kept across launches here.
vi.mock("@/utils/diskCache", () => ({
  readDiskCache: (file: string, _key: string, parse: (raw: unknown) => unknown) => {
    const raw = h.disk.get(file);
    return raw === undefined ? null : parse(JSON.parse(JSON.stringify(raw)));
  },
  writeDiskCache: (file: string, _key: string, value: unknown) => void h.disk.set(file, value),
  deleteDiskCache: (file: string) => void h.disk.delete(file),
}));

/** A fresh launch of the app: the module's own memory starts empty, the phone's folder does not. */
async function launch() {
  vi.resetModules();
  return import("@/utils/push");
}

beforeEach(() => {
  h.keychain.clear();
  h.refresh = "refused";
  h.disk.clear();
  h.permission = "granted";
  h.token = "ExponentPushToken[phone]";
  h.tokenFails = false;
  h.fileFails = false;
  h.deleteFails = false;
  h.rowsRemoved = 1;
  h.filed = [];
  h.deleted = [];
  h.deletedAllOf = [];
  h.deleteAllFails = false;
  h.unregistered = 0;
});

describe("signing out on this phone", () => {
  it("removes the token this launch filed", async () => {
    const push = await launch();
    expect(await push.registerForPush("u1")).toBe("ExponentPushToken[phone]");
    await push.forgetPushToken();
    expect(h.deleted).toEqual(["ExponentPushToken[phone]"]);
    expect(h.unregistered).toBe(0);
  });

  it("removes the token an earlier launch filed, when this launch could not get one", async () => {
    const first = await launch();
    await first.registerForPush("u1");
    // The next launch opens with no signal: no token from Expo.
    h.tokenFails = true;
    const second = await launch();
    expect(await second.registerForPush("u1")).toBeNull();
    await second.forgetPushToken();
    expect(h.deleted).toEqual(["ExponentPushToken[phone]"]);
    expect(h.unregistered).toBe(0);
    // Taken away: the launch after that has nothing left to remove.
    const third = await launch();
    await third.forgetPushToken();
    expect(h.deleted).toHaveLength(1);
  });

  it("removes a token whose filing failed, as it may have landed", async () => {
    h.fileFails = true;
    const push = await launch();
    expect(await push.registerForPush("u1")).toBeNull();
    const later = await launch();
    await later.forgetPushToken();
    expect(h.deleted).toEqual(["ExponentPushToken[phone]"]);
  });

  it("stops the phone receiving when the row cannot be removed", async () => {
    const push = await launch();
    await push.registerForPush("u1");
    h.deleteFails = true;
    await push.forgetPushToken();
    expect(h.deleted).toEqual([]);
    expect(h.unregistered).toBe(1);
    // And no word of the token is left for anyone to act on.
    expect(h.disk.size).toBe(0);
  });

  it("stops the phone receiving when the removal takes nothing: the row is another member's, or gone", async () => {
    const push = await launch();
    await push.registerForPush("u1");
    // Row-level security lets a member remove only their own row, and a
    // delete of anyone else's removes nothing and says nothing.
    h.rowsRemoved = 0;
    await push.forgetPushToken();
    expect(h.deleted).toEqual([]);
    expect(h.unregistered).toBe(1);
    expect(h.disk.size).toBe(0);
  });

  it("stops the phone receiving when no token is known but it may receive, and not otherwise", async () => {
    const push = await launch();
    await push.forgetPushToken();
    expect(h.unregistered).toBe(1);
    h.permission = "denied";
    const again = await launch();
    await again.forgetPushToken();
    expect(h.unregistered).toBe(1);
    expect(h.deleted).toEqual([]);
  });
});

describe("a session that ended elsewhere", () => {
  it("stops the phone receiving if a token filed from it was never taken away", async () => {
    const push = await launch();
    await push.registerForPush("u1");
    await push.pushAfterSignedOut();
    expect(h.unregistered).toBe(1);
    expect(h.disk.size).toBe(0);
  });

  it("does nothing after a sign-out that already removed it", async () => {
    const push = await launch();
    await push.registerForPush("u1");
    await push.forgetPushToken();
    await push.pushAfterSignedOut();
    expect(h.unregistered).toBe(0);
  });

  it("is heard as the app opens, before the session provider is listening", async () => {
    // An earlier launch filed this phone's token for member a.
    const earlier = await launch();
    await earlier.registerForPush("a");
    expect(h.disk.size).toBe(1);

    // This launch opens on a session whose refresh token the server
    // refuses: a sign-out, or a new password, on another device.
    h.keychain.set(KEYCHAIN_KEY, JSON.stringify(expiredSession()));
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await launch();
    const { supabase } = await import("@/lib/supabase");
    try {
      // The client's own listener hears it: the phone stops receiving, and
      // nothing of the token is left.
      await until(() => h.unregistered === 1);
      expect(h.keychain.has(KEYCHAIN_KEY)).toBe(false);
      expect(h.unregistered).toBe(1);
      expect(h.disk.size).toBe(0);
      expect(h.deleted).toEqual([]);

      // A listener that subscribes after that, as the session provider does
      // once it has drawn, is told only that nobody is signed in: a
      // SIGNED_OUT said during launch is said once.
      const late: string[] = [];
      const { data } = supabase.auth.onAuthStateChange((event) => void late.push(event));
      await until(() => late.length > 0);
      data.subscription.unsubscribe();
      expect(late).toEqual(["INITIAL_SESSION"]);
    } finally {
      quiet.mockRestore();
      await supabase.auth.stopAutoRefresh();
    }
  });

  it("is not a sign-out when the refresh goes through", async () => {
    const earlier = await launch();
    await earlier.registerForPush("a");
    h.refresh = "online";
    h.keychain.set(KEYCHAIN_KEY, JSON.stringify(expiredSession()));
    await launch();
    const { supabase } = await import("@/lib/supabase");
    try {
      const { data } = await supabase.auth.getSession();
      expect(data.session?.user.id).toBe("a");
      await new Promise((r) => setTimeout(r, 20));
      expect(h.unregistered).toBe(0);
      expect(h.disk.size).toBe(1);
    } finally {
      await supabase.auth.stopAutoRefresh();
    }
  });

  it("sign-out removes the tokens while still signed in, before auth lets go", () => {
    const provider = readFileSync(path.resolve(import.meta.dirname, "..", "src/providers/SessionProvider.tsx"), "utf8");
    expect(provider).toMatch(/await forgetPushTokensEverywhere\(currentUser\.current\);[\s\S]*?const \{ error \} = await supabase\.auth\.signOut\(\);/);
    // The sign-out is everywhere (the default scope) unless that cannot
    // be done: then this phone only, whose other phones keep their rows.
    expect(provider).toMatch(/const \{ error \} = await supabase\.auth\.signOut\(\);\s+if \(error\) await supabase\.auth\.signOut\(\{ scope: "local" \}\);/);
  });
});

describe("signing out everywhere", () => {
  it("removes every row of the member's, this phone's with them, in one request", async () => {
    const push = await launch();
    await push.registerForPush("u1");
    await push.forgetPushTokensEverywhere("u1");
    expect(h.deletedAllOf).toEqual(["u1"]);
    // Not a second removal of this phone's row on its own, one after the other.
    expect(h.deleted).toEqual([]);
    // Its row was among them: the phone is not let go, the token is done with.
    expect(h.unregistered).toBe(0);
    expect(h.disk.size).toBe(0);
  });

  it("stops this phone receiving when its row was not among the member's (another member's)", async () => {
    const push = await launch();
    await push.registerForPush("u1");
    h.rowsRemoved = 0;
    await push.forgetPushTokensEverywhere("u1");
    expect(h.deletedAllOf).toEqual(["u1"]);
    expect(h.unregistered).toBe(1);
    expect(h.disk.size).toBe(0);
  });

  it("takes the token an earlier launch kept, when this launch filed none", async () => {
    const first = await launch();
    await first.registerForPush("u1");
    const push = await launch();
    await push.forgetPushTokensEverywhere("u1");
    expect(h.deletedAllOf).toEqual(["u1"]);
    expect(h.unregistered).toBe(0);
    expect(h.disk.size).toBe(0);
  });

  it("without a signal, this phone stops receiving and the other phones' rows stay", async () => {
    const push = await launch();
    await push.registerForPush("u1");
    h.deleteFails = true;
    h.deleteAllFails = true;
    await expect(push.forgetPushTokensEverywhere("u1")).resolves.toBeUndefined();
    expect(h.unregistered).toBe(1);
    expect(h.deletedAllOf).toEqual([]);
  });

  it("with nobody known, does only what signing out on this phone does", async () => {
    const push = await launch();
    await push.registerForPush("u1");
    await push.forgetPushTokensEverywhere(null);
    expect(h.deleted).toEqual(["ExponentPushToken[phone]"]);
    expect(h.deletedAllOf).toEqual([]);
  });
});

describe("the token kept on the phone", () => {
  it("is read back only in its own shape", async () => {
    const { parseKeptToken } = await launch();
    expect(parseKeptToken({ v: 1, token: "t" })).toEqual({ v: 1, token: "t" });
    expect(parseKeptToken({ v: 2, token: "t" })).toBeNull();
    expect(parseKeptToken({ v: 1, token: "" })).toBeNull();
    expect(parseKeptToken(["t"])).toBeNull();
    expect(parseKeptToken(null)).toBeNull();
  });
});
