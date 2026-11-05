import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError, type Session } from "@supabase/supabase-js";

// The remembered profile lives in the browser's storage here, as in the web build.
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-file-system", () => ({ File: class {}, Paths: {} }));

import { parseStoredSession } from "@/lib/storedSession";
import { openSession, type HeldSession } from "@/providers/launchSession";
import { forgetMember, parseRemembered, recallMember, rememberMember } from "@/providers/rememberedMember";
import type { ProfileRow } from "@/types/db";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

function session(id: string, token = "t"): Session {
  return {
    access_token: token,
    refresh_token: "r",
    expires_at: 1,
    expires_in: 3600,
    token_type: "bearer",
    user: { id, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
  } as Session;
}

/** A promise and its resolvers, to answer in whatever order a test needs. */
function later<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The provider's state, as React would keep it from functional updates. */
function holder() {
  let held: HeldSession = undefined;
  return {
    set: (update: (now: HeldSession) => HeldSession) => {
      held = update(held);
    },
    get: () => held,
    /** An event from auth, as the provider's listener sets it. */
    event: (next: Session | null) => {
      held = next;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the session the phone keeps, read back", () => {
  it("is taken as auth wrote it, and nothing else is", () => {
    const s = session("u1");
    expect(parseStoredSession(JSON.stringify(s))?.user.id).toBe("u1");
    expect(parseStoredSession(null)).toBeNull();
    expect(parseStoredSession("")).toBeNull();
    expect(parseStoredSession("not json")).toBeNull();
    expect(parseStoredSession("[]")).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...s, access_token: "" }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...s, refresh_token: undefined }))).toBeNull();
    const { expires_at: _gone, ...noExpiry } = s;
    expect(parseStoredSession(JSON.stringify(noExpiry))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...s, user: undefined }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...s, user: { id: "" } }))).toBeNull();
  });
});

describe("opening the app on who is signed in", () => {
  it("opens for the phone's own copy at once, while auth is still refreshing", async () => {
    const h = holder();
    const auth = later<{ data: { session: Session | null }; error: unknown }>();
    openSession({ getSession: () => auth.promise }, async () => session("u1", "old"), h.set);
    await flush();
    // Auth has not answered (a refresh out on a slow network): the member is in.
    expect(h.get()?.user.id).toBe("u1");
    auth.resolve({ data: { session: session("u1", "new") }, error: null });
    await flush();
    expect(h.get()?.access_token).toBe("new");
  });

  it("keeps the member when the refresh could not reach the server", async () => {
    const h = holder();
    openSession(
      {
        getSession: async () => ({ data: { session: null }, error: new AuthRetryableFetchError("Network request failed", 0) }),
      },
      async () => session("u1"),
      h.set,
    );
    await flush();
    await flush();
    expect(h.get()?.user.id).toBe("u1");
  });

  it("still lets the member in when auth's network failure comes before the keychain read", async () => {
    const h = holder();
    const stored = later<Session | null>();
    openSession(
      {
        getSession: async () => ({ data: { session: null }, error: new AuthRetryableFetchError("Load failed", 0) }),
      },
      () => stored.promise,
      h.set,
    );
    await flush();
    expect(h.get()).toBeUndefined();
    stored.resolve(session("u1"));
    await flush();
    expect(h.get()?.user.id).toBe("u1");
  });

  it("shows the door when nobody is signed in, or the server refused the session", async () => {
    const nobody = holder();
    openSession({ getSession: async () => ({ data: { session: null }, error: null }) }, async () => null, nobody.set);
    await flush();
    await flush();
    expect(nobody.get()).toBeNull();

    // A refused refresh token: auth has already removed the session, whatever the copy said a moment ago.
    const refused = holder();
    openSession(
      {
        getSession: async () => ({
          data: { session: null },
          error: new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found"),
        }),
      },
      async () => session("u1"),
      refused.set,
    );
    await flush();
    await flush();
    expect(refused.get()).toBeNull();
  });

  it("never brings back a member auth signed out meanwhile", async () => {
    const h = holder();
    const stored = later<Session | null>();
    openSession(
      {
        getSession: async () => ({ data: { session: null }, error: new AuthRetryableFetchError("offline", 0) }),
      },
      () => stored.promise,
      h.set,
    );
    await flush();
    h.event(null); // SIGNED_OUT
    stored.resolve(session("u1"));
    await flush();
    expect(h.get()).toBeNull();
  });

  it("an answer that comes after the provider has gone changes nothing", async () => {
    const h = holder();
    const auth = later<{ data: { session: Session | null }; error: unknown }>();
    const stop = openSession({ getSession: () => auth.promise }, async () => session("u1"), h.set);
    stop();
    auth.resolve({ data: { session: session("u2") }, error: null });
    await flush();
    expect(h.get()).toBeUndefined();
  });

  it("a getSession that throws leaves the launch on the phone's copy, not on the splash", async () => {
    const h = holder();
    openSession({ getSession: async () => Promise.reject(new Error("boom")) }, async () => null, h.set);
    await flush();
    await flush();
    expect(h.get()).toBeNull();
  });
});

function profile(id: string, extra: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id,
    username: `m-${id}`,
    full_name: null,
    bio: "",
    avatar_url: null,
    city: null,
    social_handle: null,
    role: "member",
    status: "approved",
    invite_quota: 0,
    member_no: 1,
    invited_by: null,
    is_private: false,
    post_count: 3,
    follower_count: 0,
    following_count: 0,
    created_at: "",
    approved_at: null,
    ...extra,
  };
}

describe("the profile remembered for the next launch", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    forgetMember();
  });

  it("is given back for the same member only", () => {
    expect(recallMember("u1")).toBeNull();
    rememberMember(profile("u1"));
    expect(recallMember("u1")?.username).toBe("m-u1");
    expect(recallMember("u2")).toBeNull();
    expect(recallMember("")).toBeNull();
  });

  it("follows the latest read, and is gone once forgotten", () => {
    rememberMember(profile("u1"));
    rememberMember(profile("u1", { status: "suspended" }));
    expect(recallMember("u1")?.status).toBe("suspended");
    forgetMember();
    expect(recallMember("u1")).toBeNull();
    expect(localStorage.getItem("vintage.member")).toBeNull();
  });

  it("is not written again when the read brought nothing new", () => {
    const setItem = vi.spyOn(localStorage, "setItem");
    rememberMember(profile("u1"));
    rememberMember(profile("u1"));
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("reads a file that is not ours, or no longer fits, as nothing", () => {
    expect(parseRemembered(null)).toBeNull();
    expect(parseRemembered({ v: 2, id: "u1", profile: profile("u1") })).toBeNull();
    expect(parseRemembered({ v: 1, id: "u1", profile: profile("u2") })).toBeNull();
    expect(parseRemembered({ v: 1, id: "u1", profile: { id: "u1" } })).toBeNull();
    expect(parseRemembered({ v: 1, id: "u1", profile: profile("u1") })?.profile.id).toBe("u1");
    localStorage.setItem("vintage.member", "{not json");
    expect(recallMember("u1")).toBeNull();
  });
});

describe("the session provider", () => {
  const provider = read("src/providers/SessionProvider.tsx");

  it("opens on the phone's copy and on the remembered profile, without waiting on the network", () => {
    expect(provider).toMatch(/openSession\(supabase\.auth, readStoredSession, setSession\)/);
    // A first answer of nobody from auth is not a sign-out.
    expect(provider).toMatch(/if \(event === "INITIAL_SESSION" && !next\) return;/);
    // The remembered profile, for this member only, before the read.
    expect(provider).toMatch(/const known = userId \? recallMember\(userId\) : null;\s*if \(known\) \{\s*setProfile\(known\);\s*setProfileLoaded\(true\);/);
    // Every read that lands is kept for the next launch.
    expect(provider).toMatch(/if \(data\) rememberMember\(data\);\s*else forgetMember\(\);/);
  });

  it("forgets the remembered profile wherever the session ends", () => {
    expect(provider).toMatch(/if \(event === "SIGNED_OUT"\) \{\s*forgetOutbox\(\);\s*forgetMember\(\);/);
    expect(provider).toMatch(/forgetOutbox\(\);\s*forgetMember\(\);\s*await leaveToLanding\(\);/);
    // A read for a member who has since left is neither shown nor kept.
    expect(provider).toMatch(/if \(currentUser\.current !== userId\) return false;\s*setProfile\(data\);/);
  });
});
