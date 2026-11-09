import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("a photograph the admins removed", () => {
  it("offers no Edit caption to its author, since the database takes no change to it (0039)", () => {
    const actions = read("src/hooks/usePostActions.ts");
    expect(actions).toMatch(/\.\.\.\(post\.removed_at\s*\?\s*\[\]\s*:\s*\[\s*\{\s*text: "Edit caption",/);
    // And the database refuses it all the same.
    const sql = read("supabase/migrations/0039_writes_only_what_the_app_writes.sql");
    expect(sql).toMatch(/posts: a caption while live, by a member/);
  });
});

describe("Places, settling on its timer", () => {
  it("shows the names already waiting in the batches with the page", () => {
    const places = read("src/components/PlaceGroups.tsx");
    expect(places).toMatch(
      /const t = setTimeout\(\(\) => \{\s*pointBatch\.flush\(\);\s*labelBatch\.flush\(\);\s*setSettled\(true\);\s*\}, SETTLE_AFTER_MS\);/,
    );
  });
});
