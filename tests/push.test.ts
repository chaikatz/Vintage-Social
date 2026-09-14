import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => true }));

const { routeForNotification } = await import("@/utils/pushRoute");
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
