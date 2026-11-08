import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => true }));

const { isTabRoute, openNoticeRoute, routeForNotification, tapFollower, tokenFiler } = await import("@/utils/pushRoute");
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
    // Each tap opened as its route asks: a tab gone back to, never pushed.
    expect(src).toMatch(/navigate: \(route\) =>\s*openNoticeRoute\(\s*\{\s*canDismiss: \(\) => router\.canDismiss\(\),\s*dismissTo: \(to\) => router\.dismissTo\(to as never\),\s*navigate: \(to\) => router\.navigate\(to as never\),\s*push: \(to\) => router\.push\(to as never\),\s*\},\s*route,\s*\),/);
  });
});

describe("a tapped notice that points to a tab", () => {
  /** expo-router as the tap finds it: a screen open over the tabs, or none. */
  function routerWith(screenOpen: boolean) {
    const calls: string[] = [];
    return {
      calls,
      router: {
        canDismiss: () => screenOpen,
        dismissTo: (route: string) => void calls.push(`dismissTo ${route}`),
        navigate: (route: string) => void calls.push(`navigate ${route}`),
        push: (route: string) => void calls.push(`push ${route}`),
      },
    };
  }

  it("is never pushed over the screen open: the tabs already there are gone back to, on that tab", () => {
    // A tag, or "Someone joined VINTAGE on your invitation.", while a
    // photograph, a thread or Invitations is open.
    const { router, calls } = routerWith(true);
    openNoticeRoute(router, "/(tabs)/activity");
    expect(calls).toEqual(["dismissTo /(tabs)/activity"]);
  });

  it("with nothing open over the tabs, only changes tab", () => {
    const { router, calls } = routerWith(false);
    openNoticeRoute(router, "/(tabs)/activity");
    expect(calls).toEqual(["navigate /(tabs)/activity"]);
  });

  it("every route a notice can name that is a tab, whatever is open", () => {
    const routes = [
      routeForNotification({ kind: "tag", postId: "p1", route: "/(tabs)/activity" }),
      routeForNotification({ kind: "moderation", route: "/(tabs)/activity" }),
      routeForNotification({ kind: "comment" }),
      routeForNotification({ kind: "moderation" }),
      "/(tabs)",
    ];
    for (const route of routes) {
      expect(isTabRoute(route!)).toBe(true);
      for (const open of [true, false]) {
        const { router, calls } = routerWith(open);
        openNoticeRoute(router, route!);
        expect(calls.some((c) => c.startsWith("push "))).toBe(false);
      }
    }
  });

  it("a screen of its own is pushed over whatever is open, as before", () => {
    for (const route of ["/post/p1", "/user/ansel", "/requests", "/messages", "/memories", "/tabsish"]) {
      expect(isTabRoute(route)).toBe(false);
      const { router, calls } = routerWith(true);
      openNoticeRoute(router, route);
      expect(calls).toEqual([`push ${route}`]);
    }
  });

  it("going back to the tabs leaves one set of them, on the tab named; a push would have made a second", async () => {
    // The root stack as React Navigation keeps it, with Invitations open
    // over the tabs, and the two actions expo-router makes of the tap.
    const { StackRouter } = await import("@react-navigation/routers");
    const stack = StackRouter({});
    const routeNames = ["index", "(tabs)", "post/[id]", "invites"];
    const state = {
      stale: false as const,
      type: "stack" as const,
      key: "root",
      index: 1,
      routeNames,
      preloadedRoutes: [],
      routes: [
        { key: "(tabs)-1", name: "(tabs)" },
        { key: "invites-1", name: "invites" },
      ],
    };
    const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
    const payload = { name: "(tabs)", params: { screen: "activity", params: {} } };
    const back = stack.getStateForAction(state, { type: "POP_TO", payload }, options);
    expect(back?.routes.map((r) => r.key)).toEqual(["(tabs)-1"]);
    expect(back?.routes[0].params).toEqual({ screen: "activity", params: {} });
    const pushed = stack.getStateForAction(state, { type: "PUSH", payload }, options);
    expect(pushed?.routes.filter((r) => r.name === "(tabs)")).toHaveLength(2);
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
