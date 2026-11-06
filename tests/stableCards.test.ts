import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NO_COMMENTS, commentsOrNone, likeCounted } from "@/media/stableCards";
import type { CommentWithAuthor, PostWithAuthor } from "@/types/db";

/**
 * The feed card is drawn again only when something it is given changes,
 * and the screens hand it the same objects while nothing has. Without
 * that, Home drew every card it held again each time a different card
 * came on screen.
 */

const row = (id: string, likes = 0) =>
  ({ id, like_count: likes, author: { id: "a", username: "a", full_name: null, avatar_url: null } }) as unknown as PostWithAuthor;

describe("a card's post", () => {
  it("is the same object while the row and its count are the same", () => {
    const counted = likeCounted();
    const a = row("p1", 3);
    expect(counted(a, 3)).toBe(a);
    const liked = counted(a, 4);
    expect(liked).not.toBe(a);
    expect(liked.like_count).toBe(4);
    expect(counted(a, 4)).toBe(liked);
  });

  it("follows a new row from the server, and a count that goes back", () => {
    const counted = likeCounted();
    const a = row("p1", 3);
    const first = counted(a, 4);
    const refetched = row("p1", 4);
    expect(counted(refetched, 4)).toBe(refetched);
    expect(counted(a, 3)).toBe(a);
    expect(first.like_count).toBe(4);
  });

  it("keeps each post apart", () => {
    const counted = likeCounted();
    const a = row("p1", 1);
    const b = row("p2", 1);
    const a2 = counted(a, 2);
    const b2 = counted(b, 2);
    expect(counted(a, 2)).toBe(a2);
    expect(counted(b, 2)).toBe(b2);
    expect(a2.id).toBe("p1");
    expect(b2.id).toBe("p2");
  });
});

describe("a card's comments", () => {
  it("are one shared empty list for every card with none", () => {
    expect(commentsOrNone([])).toBe(NO_COMMENTS);
    expect(commentsOrNone(undefined)).toBe(NO_COMMENTS);
    expect(commentsOrNone([])).toBe(commentsOrNone([]));
    expect(Object.isFrozen(NO_COMMENTS)).toBe(true);
  });

  it("are the list itself when there are some", () => {
    const list = [{ id: "c1" }] as unknown as CommentWithAuthor[];
    expect(commentsOrNone(list)).toBe(list);
  });
});

/** The source without its comments. */
function code(file: string): string {
  return readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every `<Tag … />` in a file. */
function tags(source: string, tag: string): string[] {
  return source.match(new RegExp(`<${tag}\\b[\\s\\S]*?\\/>`, "g")) ?? [];
}

describe("the feed card in a list", () => {
  it("is a memo", () => {
    expect(code("src/components/PostCard.tsx")).toMatch(/export const PostCard = React\.memo\(function PostCard\(\{/);
  });

  for (const file of ["app/(tabs)/index.tsx", "app/gallery.tsx"]) {
    it(`is handed the same objects while nothing has changed, in ${file}`, () => {
      const screen = code(file);
      const cards = tags(screen, "PostCard");
      expect(cards).toHaveLength(1);
      const card = cards[0] ?? "";
      expect(card).toMatch(/post=\{counted\(item, likeCountFor\(item\)\)\}/);
      expect(card).toMatch(/comments=\{commentsOrNone\(commentsFor\(item\)\)\}/);
      expect(card).toMatch(/onOpenProfile=\{openProfile\}/);
      expect(card).toMatch(/onMore=\{more\}/);
      // Nothing made fresh for the card on every draw: no spread post, no arrows.
      expect(card).not.toMatch(/\{\s*\.\.\.item/);
      expect(card).not.toMatch(/=>/);
      expect(screen).toMatch(/const \[counted\] = useState\(likeCounted\);/);
      expect(screen).toMatch(/const openProfile = useCallback\(/);
      expect(screen).toMatch(/const more = useCallback\(/);
    });
  }
});
