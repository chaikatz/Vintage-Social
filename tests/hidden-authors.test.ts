import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { authorShown, withAuthors, withMembers } from "@/components/hiddenAuthors";

/**
 * A post, a comment or a tag whose member row-level security keeps back
 * comes back naming nobody. Drawing `post.author.username` threw, and the
 * feed, a gallery or a photograph's page gave way to the recover page.
 * Production has none today; a member who leaves good standing makes one.
 */

const root = path.resolve(import.meta.dirname, "..");
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const elena = { id: "e", username: "elena", avatar_url: null };

describe("rows that name a member the reader may not see", () => {
  it("know whether the author came back with the row", () => {
    expect(authorShown({ author: elena })).toBe(true);
    expect(authorShown({ author: null })).toBe(false);
    expect(authorShown({ author: undefined })).toBe(false);
    expect(authorShown({})).toBe(false);
  });

  it("leave out the comments and tags that name nobody, and keep the rest in order", () => {
    const comments = [
      { id: "1", author: elena },
      { id: "2", author: null },
      { id: "3", author: elena },
    ];
    expect(withAuthors(comments).map((c) => c.id)).toEqual(["1", "3"]);
    const tags = [
      { user_id: "a", member: null },
      { user_id: "b", member: elena },
    ];
    expect(withMembers(tags).map((t) => t.user_id)).toEqual(["b"]);
    expect(withAuthors([])).toEqual([]);
  });
});

describe("the card and the photograph's page", () => {
  it("the card draws nothing for a post naming nobody, before it reads a name", () => {
    const card = code("src/components/PostCard.tsx");
    const body = card.slice(card.indexOf("export const PostCard"));
    const guard = body.indexOf("if (!authorShown(post)) return null;");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf("post.author."));
    // No hook stands after the early return: the card has none of its own.
    expect(body.slice(0, body.indexOf("export function PostedTime"))).not.toMatch(/\buse[A-Z]\w*\(/);
    expect(card).toMatch(/const preview = withAuthors\(comments \?\? \[\]\)\.slice\(-INLINE_COMMENTS\);/);
  });

  it("the page says the photograph is gone, and leaves out comments and tags naming nobody", () => {
    const page = code("app/post/[id].tsx");
    expect(page).toMatch(/if \(!post \|\| !authorShown\(post\)\) \{\s*return \([\s\S]*?<EmptyState title="This photograph is gone" \/>/);
    // Every hook is above that return.
    const at = page.indexOf("if (!post || !authorShown(post))");
    expect(page.slice(at)).not.toMatch(/\buse(Query|Mutation|Memo|State|Effect|PostActions|IsFocused|Router)\(/);
    expect(page).toMatch(/const preview = withAuthors\(commentsFor\(post\)\)\.slice\(-INLINE_COMMENTS\);/);
    expect(page).toMatch(/const shownTags = withMembers\(tagsQ\.data \?\? \[\]\)\.filter\(/);
  });

  it("Share outside draws no print for a post naming nobody: its label names the member", () => {
    const sheet = code("app/export.tsx");
    expect(sheet).toMatch(/const postRow = postQ\.data;\s*const post = postRow && authorShown\(postRow\) \? postRow : undefined;/);
    // The row as read is used for nothing else: every print, label and share goes through `post`.
    expect(sheet.match(/\bpostRow\b/g)).toHaveLength(4);
    // Then it is gone, as on its own page.
    expect(sheet).toMatch(/\) : readState\(postQ\) === "empty" \? \(\s*<EmptyState title="This photograph is gone" \/>/);
  });
});
