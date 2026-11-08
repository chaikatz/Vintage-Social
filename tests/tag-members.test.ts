import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tagging members in a post that is up: one member the database refuses
 * no longer keeps every other tag off it.
 *
 * "post_tags: author tags" (0023) takes a tag only of an approved member,
 * and "no tagging across a block" (0018) none across a block. One INSERT
 * of every tag is all or nothing, so a member suspended, or blocking the
 * author, between compose and the tags going on, left all of them off, and
 * the member was told to tag again later, which the app has no way to do.
 *
 * Supabase here answers as PostgREST would from a table that refuses the
 * members named in `refusing`, and holds the tags already in it.
 */

const h = vi.hoisted(() => ({
  inserts: [] as unknown[],
  refusing: new Set<string>(),
  stored: new Set<string>(),
  fails: null as null | { code: string; message: string },
}));

vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
vi.mock("@/demo/store", () => ({}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      insert: async (rows: { post_id: string; user_id: string } | { post_id: string; user_id: string }[]) => {
        expect(table).toBe("post_tags");
        h.inserts.push(rows);
        if (h.fails) return { error: h.fails };
        const all = Array.isArray(rows) ? rows : [rows];
        // One statement: the first row refused refuses them all.
        for (const row of all) {
          if (h.refusing.has(row.user_id)) {
            return { error: { code: "42501", message: 'new row violates row-level security policy for table "post_tags"' } };
          }
          if (h.stored.has(row.user_id)) {
            return { error: { code: "23505", message: 'duplicate key value violates unique constraint "post_tags_pkey"' } };
          }
        }
        for (const row of all) h.stored.add(row.user_id);
        return { error: null };
      },
    }),
  },
}));

const { tagMembers } = await import("@/api/tags");
const { tagFailureWords } = await import("@/uploads/words");

beforeEach(() => {
  h.inserts.length = 0;
  h.refusing.clear();
  h.stored.clear();
  h.fails = null;
});

describe("tagging the members named in a post", () => {
  it("sends them all in one request when the database takes them all", async () => {
    expect(await tagMembers("p1", "me", ["ansel", "tomas", "june"])).toEqual([]);
    expect(h.inserts).toHaveLength(1);
    expect([...h.stored].sort()).toEqual(["ansel", "june", "tomas"]);
  });

  it("keeps the others on when one is refused, and says which", async () => {
    h.refusing.add("tomas");
    expect(await tagMembers("p1", "me", ["ansel", "tomas", "june"])).toEqual(["tomas"]);
    expect([...h.stored].sort()).toEqual(["ansel", "june"]);
  });

  it("says every one refused when none can be tagged", async () => {
    h.refusing.add("ansel");
    h.refusing.add("tomas");
    expect(await tagMembers("p1", "me", ["ansel", "tomas"])).toEqual(["ansel", "tomas"]);
    expect(h.stored.size).toBe(0);
  });

  it("finishes a try that put some in already, refusing none of those", async () => {
    // An earlier try was cut off after two of three went in.
    h.stored.add("ansel");
    h.stored.add("tomas");
    expect(await tagMembers("p1", "me", ["ansel", "tomas", "june"])).toEqual([]);
    expect([...h.stored].sort()).toEqual(["ansel", "june", "tomas"]);
  });

  it("one member alone takes one request, refused or already in", async () => {
    h.refusing.add("tomas");
    expect(await tagMembers("p1", "me", ["tomas"])).toEqual(["tomas"]);
    h.stored.add("ansel");
    expect(await tagMembers("p1", "me", ["ansel"])).toEqual([]);
    expect(h.inserts).toHaveLength(2);
  });

  it("throws what is not a refusal, for the outbox to try again or say so", async () => {
    h.fails = { code: "", message: "TypeError: Network request failed" };
    await expect(tagMembers("p1", "me", ["ansel", "tomas"])).rejects.toMatchObject({ message: "TypeError: Network request failed" });
    expect(h.inserts).toHaveLength(1);
  });

  it("tags nobody twice, and never the author", async () => {
    expect(await tagMembers("p1", "me", ["ansel", "ansel", "me", ""])).toEqual([]);
    expect(h.inserts).toEqual([[{ post_id: "p1", user_id: "ansel", tagged_by: "me" }]]);
    expect(await tagMembers("p1", "me", ["me"])).toEqual([]);
    expect(h.inserts).toHaveLength(1);
  });
});

describe("what the member is told", () => {
  const photo = { kind: "photo" as const, tagIds: ["u2", "u3", "u4"], tagNames: { u2: "ansel", u3: "tomas", u4: "june" } };

  it("names the members who could not be tagged, and says the others are on", () => {
    expect(tagFailureWords(photo, ["u3"])).toEqual({
      title: "Posted, but not every tag took",
      body: "The photograph is up with your other tags. tomas couldn’t be tagged.",
    });
    expect(tagFailureWords(photo, ["u2", "u4"]).body).toBe("The photograph is up with your other tags. ansel and june couldn’t be tagged.");
  });

  it("says so plainly when none could be", () => {
    expect(tagFailureWords({ ...photo, kind: "video" }, ["u2", "u3", "u4"])).toEqual({
      title: "Posted, but the tags didn’t take",
      body: "The clip is up. ansel, tomas and june couldn’t be tagged.",
    });
  });

  it("counts the members it has no name for (a post kept from an older build)", () => {
    expect(tagFailureWords({ ...photo, tagNames: undefined }, ["u3"]).body).toBe(
      "The photograph is up with your other tags. One member you tagged couldn’t be tagged.",
    );
    expect(tagFailureWords({ ...photo, tagNames: { u2: "ansel" } }, ["u2", "u3"]).body).toBe(
      "The photograph is up with your other tags. ansel and one other member couldn’t be tagged.",
    );
    expect(tagFailureWords({ ...photo, tagNames: {} }, ["u2", "u3", "u4"]).body).toBe(
      "The photograph is up. 3 members you tagged couldn’t be tagged.",
    );
  });

  it("when the tags could not be sent at all, promises nothing the app cannot do", () => {
    const words = tagFailureWords(photo, null);
    expect(words).toEqual({ title: "Posted, but the tags didn’t take", body: "The photograph is up, but its tags may not all be on it." });
    // A post's tags cannot be changed once it is up.
    for (const refused of [null, ["u2"], ["u2", "u3", "u4"]]) {
      expect(tagFailureWords(photo, refused).body).not.toMatch(/again|later|try/i);
    }
  });
});
