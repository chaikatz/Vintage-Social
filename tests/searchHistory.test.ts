import { beforeEach, describe, expect, it, vi } from "vitest";

// The store keeps one small file on the phone; here it is a string.
let disk: string | null = null;
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system", () => ({
  Paths: { document: "/documents" },
  File: class {
    get exists() {
      return disk !== null;
    }
    create() {
      disk = disk ?? "";
    }
    textSync() {
      return disk ?? "";
    }
    write(content: string) {
      disk = content;
    }
  },
}));

const {
  RECENT_MAX,
  clearRecent,
  dropRecent,
  forgetRecent,
  loadRecent,
  parseRecent,
  pushRecent,
  rememberRecent,
} = await import("@/utils/searchHistory");

const member = (id: string) => ({ id, username: `user-${id}`, full_name: null, avatar_url: null });

describe("recent searches", () => {
  beforeEach(() => {
    disk = null;
  });

  it("puts the latest first and keeps each member once", () => {
    const list = pushRecent(pushRecent([member("a")], member("b")), member("a"));
    expect(list.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("stops at the limit, dropping the oldest", () => {
    let list = [] as ReturnType<typeof pushRecent>;
    for (let i = 0; i < RECENT_MAX + 5; i++) list = pushRecent(list, member(String(i)));
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].id).toBe(String(RECENT_MAX + 4));
  });

  it("forgets one", () => {
    expect(dropRecent([member("a"), member("b")], "a").map((m) => m.id)).toEqual(["b"]);
  });

  it("reads its own file back, and shrugs at anything else", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("not json")).toEqual([]);
    expect(parseRecent('{"id":"x"}')).toEqual([]);
    expect(parseRecent('[{"id":"a","username":"ann"},{"nope":1},{"id":3,"username":"bad"}]')).toEqual([
      { id: "a", username: "ann", full_name: null, avatar_url: null },
    ]);
  });

  it("persists across loads on the phone", () => {
    expect(loadRecent()).toEqual([]);
    rememberRecent(member("a"));
    rememberRecent(member("b"));
    expect(loadRecent().map((m) => m.id)).toEqual(["b", "a"]);
    forgetRecent("b");
    expect(loadRecent().map((m) => m.id)).toEqual(["a"]);
    clearRecent();
    expect(loadRecent()).toEqual([]);
  });
});
