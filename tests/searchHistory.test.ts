import { readFileSync } from "node:fs";
import path from "node:path";
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

/**
 * Who a member looked for is theirs alone: the next member to sign in on
 * the same phone opens Search to an empty list. Forgotten at "Sign out",
 * in the demo too, and whenever auth says the session has left the phone
 * (a refresh token refused, a sign-out made on another device), heard
 * where the client is made so that one said during launch is not missed.
 */
describe("recent searches and the session", () => {
  const source = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

  it("go with the member at sign-out, in both providers", () => {
    const provider = source("src/providers/SessionProvider.tsx");
    expect(provider).toMatch(/import \{ clearRecent \} from "@\/utils\/searchHistory";/);
    // The demo: what was read for them goes as well, as it does against Supabase.
    expect(provider).toMatch(/demoSignOut\(\);[\s\S]*?queryClient\.clear\(\);\s*clearRecent\(\);\s*await leaveToLanding\(\);/);
    expect(provider).toMatch(
      /queryClient\.clear\(\);\s*forgetDarkroom\(\);\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*clearRecent\(\);\s*forgetOutbox\(\);\s*forgetMember\(\);\s*await leaveToLanding\(\);\s*\}, \[\]\);/,
    );
    expect(provider.match(/clearRecent\(\);/g)).toHaveLength(2);
  });

  it("go when auth says the session has left the phone", () => {
    const client = source("src/lib/supabase.ts");
    expect(client).toMatch(
      /onAuthStateChange\(\(event\) => \{\s*if \(event === "SIGNED_OUT"\) forgetDarkroom\(\);\s*if \(event === "SIGNED_OUT"\) clearRecent\(\);[^}]*\}\);/,
    );
  });

  it("are read afresh each time Search is drawn for a member", () => {
    expect(source("app/(tabs)/search.tsx")).toMatch(/useEffect\(\(\) => \{\s*setRecent\(loadRecent\(\)\);\s*\}, \[\]\);/);
  });
});
