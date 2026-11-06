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
  filed: [] as string[],
  deleted: [] as string[],
  unregistered: 0,
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-router", () => ({ useRouter: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("expo-device", () => ({ isDevice: true, manufacturer: "Apple", modelName: "iPhone" }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: { eas: { projectId: "project" } } } } }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
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
    h.deleted.push(token);
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
  h.disk.clear();
  h.permission = "granted";
  h.token = "ExponentPushToken[phone]";
  h.tokenFails = false;
  h.fileFails = false;
  h.deleteFails = false;
  h.filed = [];
  h.deleted = [];
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

  it("is heard by the session provider", () => {
    const provider = readFileSync(path.resolve(import.meta.dirname, "..", "src/providers/SessionProvider.tsx"), "utf8");
    expect(provider).toMatch(/if \(event === "SIGNED_OUT"\) \{\s*forgetOutbox\(\);\s*forgetMember\(\);[\s\S]*?void pushAfterSignedOut\(\);\s*\}/);
    // Sign-out removes the token while still signed in, before auth lets go.
    expect(provider).toMatch(/await forgetPushToken\(\);[\s\S]*?const \{ error \} = await supabase\.auth\.signOut\(\);/);
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
