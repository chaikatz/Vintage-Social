import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => true }));

const { routeForNotification, tapFollower, tokenFiler } = await import("@/utils/pushRoute");
const { parsePrefs, DEFAULT_PREFS } = await import("@/api/notifications");

describe("where a tapped notice lands", () => {
  it("prefers the route the function named", () => {
    expect(routeForNotification({ kind: "tag", postId: "p1", route: "/(tabs)/activity" })).toBe("/(tabs)/activity");
    expect(routeForNotification({ kind: "memory", postId: "p1", route: "/memories" })).toBe("/memories");
  });

  it("opens the post a like, comment or new photograph is about", () => {
    expect(routeForNotification({ kind: "like", postId: "p1" })).toBe("/post/p1");
    expect(routeForNotification({ kind: "post", postId: "p2" })).toBe("/post/p2");
  });

  it("opens the member who followed", () => {
    expect(routeForNotification({ kind: "follow", username: "ansel" })).toBe("/user/ansel");
    expect(routeForNotification({ kind: "follow_request" })).toBe("/requests");
  });

  it("falls back by kind and ignores rubbish", () => {
    expect(routeForNotification({ kind: "message" })).toBe("/messages");
    expect(routeForNotification({ kind: "comment" })).toBe("/(tabs)/activity");
    expect(routeForNotification({ route: "https://elsewhere.example" })).toBeNull();
    expect(routeForNotification({ kind: 42 })).toBeNull();
    expect(routeForNotification(null)).toBeNull();
  });
});

describe("what a member wants to hear about", () => {
  it("means everything when nothing has been said", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({})).toEqual(DEFAULT_PREFS);
  });

  it("reads only booleans and leaves the rest on", () => {
    const prefs = parsePrefs({ likes: false, posts: "no", memories: 0, user_id: "u1" });
    expect(prefs.likes).toBe(false);
    expect(prefs.posts).toBe(true);
    expect(prefs.memories).toBe(true);
    expect("user_id" in prefs).toBe(false);
  });
});

describe("a tapped notice, followed", () => {
  const notice = (id: string, data: Record<string, unknown>, action = "expo.modules.notifications.actions.DEFAULT") => ({
    actionIdentifier: action,
    notification: { request: { identifier: id, content: { data } } },
  });

  it("goes where it points once, though a cold start hears it twice", () => {
    const navigate = vi.fn();
    const clear = vi.fn();
    const follow = tapFollower({ navigate, clear });
    const tap = notice("n1", { kind: "like", postId: "p1" });
    follow(tap); // the response the launch asked for
    follow(tap); // the same tap, from the listener
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/post/p1");
    // Cleared once followed, so it is not the last response any more.
    expect(clear).toHaveBeenCalledTimes(1);
    // Another notice is another tap.
    follow(notice("n2", { kind: "message" }));
    expect(navigate).toHaveBeenLastCalledWith("/messages");
  });

  it("waits for the navigator rather than losing a tap heard before it is up", () => {
    const pending: (() => void)[] = [];
    let ready = false;
    const navigate = vi.fn(() => {
      if (!ready) throw new Error("Attempted to navigate before mounting the Root Layout component.");
    });
    const follow = tapFollower({ navigate, clear: () => undefined, later: (run) => void pending.push(run) });
    follow(notice("n1", { kind: "follow", username: "ansel" }));
    expect(navigate).toHaveBeenCalledTimes(1);
    pending.shift()!();
    expect(navigate).toHaveBeenCalledTimes(2);
    ready = true;
    pending.shift()!();
    expect(navigate).toHaveBeenCalledTimes(3);
    expect(navigate).toHaveBeenLastCalledWith("/user/ansel");
    expect(pending).toHaveLength(0);
  });

  it("gives up after its waits, and never throws to the listener", () => {
    const pending: (() => void)[] = [];
    const navigate = vi.fn(() => {
      throw new Error("not ready");
    });
    const follow = tapFollower({ navigate, clear: () => undefined, later: (run) => void pending.push(run), waits: [1, 1] });
    expect(() => follow(notice("n1", { kind: "message" }))).not.toThrow();
    while (pending.length) pending.shift()!();
    expect(navigate).toHaveBeenCalledTimes(3);
  });

  it("follows nothing for a notice with nowhere to go, or no notice at all", () => {
    const navigate = vi.fn();
    const clear = vi.fn(() => {
      throw new Error("unavailable");
    });
    const follow = tapFollower({ navigate, clear });
    follow(notice("n1", { kind: "unknown" }));
    follow(null);
    follow(undefined);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("is the one follower the app uses, for the launch's response and the listener alike", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(path.resolve(import.meta.dirname, "..", "src/utils/push.ts"), "utf8");
    expect(src).toMatch(/const go = \(follow \?\?= tapFollower\(\{/);
    expect(src).toMatch(/clear: \(\) => Notifications\.clearLastNotificationResponse\(\)/);
    expect(src).toMatch(/addNotificationResponseReceivedListener\(go\)/);
    expect(src).not.toMatch(/router\.push\(route as never\);\s*\};/);
  });
});

describe("the phone's push token, filed under the member", () => {
  /** A registration the test answers by hand: each call waits for `answer`. */
  function registrations() {
    const calls: { userId: string; answer: (token: string | null) => void; fail: (e: unknown) => void }[] = [];
    const register = vi.fn(
      (userId: string) =>
        new Promise<string | null>((answer, fail) => {
          calls.push({ userId, answer, fail });
        }),
    );
    return { register, calls };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("is tried again after a launch where filing failed, and not once it has worked", async () => {
    const { register, calls } = registrations();
    const file = tokenFiler(register);
    file("u1"); // the member arrives: no signal, or a token that had run out
    calls[0].answer(null);
    await flush();
    file("u1"); // back to the app
    expect(register).toHaveBeenCalledTimes(2);
    calls[1].fail(new Error("Network request failed"));
    await flush();
    file("u1");
    expect(register).toHaveBeenCalledTimes(3);
    calls[2].answer("ExponentPushToken[x]");
    await flush();
    file("u1");
    file("u1");
    expect(register).toHaveBeenCalledTimes(3);
  });

  it("never stacks a second try behind one still on its way", async () => {
    const { register, calls } = registrations();
    const file = tokenFiler(register);
    file("u1");
    file("u1");
    expect(register).toHaveBeenCalledTimes(1);
    calls[0].answer("ExponentPushToken[x]");
    await flush();
    file("u1");
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("files for whoever is signed in", async () => {
    const { register, calls } = registrations();
    const file = tokenFiler(register);
    file("u1");
    calls[0].answer("ExponentPushToken[x]");
    await flush();
    file("u2");
    expect(calls.map((c) => c.userId)).toEqual(["u1", "u2"]);
  });

  it("the app tries on arrival and on each return to the app, and knows the token before filing it", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(path.resolve(import.meta.dirname, "..", "src/utils/push.ts"), "utf8");
    expect(src).toMatch(/file\.current \?\?= tokenFiler\(registerForPush\);/);
    expect(src).toMatch(/const want = \(\) => file\.current\?\.\(userId\);\s*want\(\);\s*return onReturnFromBackground\(want\);/);
    // Signing out can take the token away even when this launch's filing
    // failed, or a later launch could not get one (tests/push-token.test.ts).
    expect(src).toMatch(/noteToken\(token\);\s*await registerPushToken\(userId, token, platform, device\);/);
  });
});
