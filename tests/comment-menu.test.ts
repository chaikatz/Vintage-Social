import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Press and hold on a comment opens its menu wherever the comment is
 * shown: Report comment for anyone else's, Delete for one's own.
 *
 * App Review is told "to report a comment, press and hold it". The
 * comments a reviewer sees first are the two under a photograph, in the
 * feed and on the photograph's own page, and there a press and hold only
 * opened the Comments screen on release (React Native runs onPress on
 * release when a Pressable has no onLongPress). The menu was the
 * Comments screen's alone.
 */

type Button = { text: string; style?: string; onPress?: () => unknown };
const h = vi.hoisted(() => ({
  alerts: [] as { title: string; message?: string; buttons?: Button[] }[],
  pushed: [] as unknown[],
  deleted: [] as string[],
  removed: [] as { id: string; note: string }[],
  fails: false,
}));

vi.mock("expo-router", () => ({ router: { push: (href: unknown) => void h.pushed.push(href) } }));
vi.mock("@/utils/alert", () => ({
  showAlert: (title: string, message?: string, buttons?: Button[]) => void h.alerts.push({ title, message, buttons }),
}));
vi.mock("@/api/posts", () => ({
  deleteOwnComment: async (id: string) => {
    if (h.fails) throw { code: "42501", message: "new row violates row-level security policy" };
    h.deleted.push(id);
  },
}));
vi.mock("@/api/moderation", () => ({
  removeComment: async (id: string, note: string) => void h.removed.push({ id, note }),
}));

const { showCommentMenu } = await import("@/utils/commentMenu");

const theirs = { id: "c1", author_id: "tomas" };
const mine = { id: "c2", author_id: "me" };
const press = (text: string) => h.alerts.at(-1)!.buttons!.find((b) => b.text === text)!.onPress!();

beforeEach(() => {
  h.alerts.length = 0;
  h.pushed.length = 0;
  h.deleted.length = 0;
  h.removed.length = 0;
  h.fails = false;
});

describe("the menu a comment has", () => {
  it("reports anyone else's, on the report screen, and removes nothing", () => {
    const removed = vi.fn();
    showCommentMenu(theirs, { userId: "me", isAdmin: false }, removed);
    expect(h.alerts.at(-1)!.buttons!.map((b) => b.text)).toEqual(["Report comment", "Cancel"]);
    press("Report comment");
    expect(h.pushed).toEqual([{ pathname: "/report", params: { targetType: "comment", commentId: "c1" } }]);
    expect(removed).not.toHaveBeenCalled();
  });

  it("deletes your own, then puts the screens right", async () => {
    const removed = vi.fn();
    showCommentMenu(mine, { userId: "me", isAdmin: false }, removed);
    expect(h.alerts.at(-1)!.buttons!.map((b) => b.text)).toEqual(["Delete comment", "Cancel"]);
    await press("Delete comment");
    expect(h.deleted).toEqual(["c2"]);
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it("lets an admin remove anyone's", async () => {
    const removed = vi.fn();
    showCommentMenu(theirs, { userId: "me", isAdmin: true }, removed);
    await press("Remove comment (admin)");
    expect(h.removed).toEqual([{ id: "c1", note: "Removed from the comments view" }]);
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it("says so in its own words when the removal is refused, and changes nothing on screen", async () => {
    h.fails = true;
    const removed = vi.fn();
    showCommentMenu(mine, { userId: "me", isAdmin: false }, removed);
    await press("Delete comment");
    expect(h.alerts.at(-1)!.title).toBe("Couldn’t remove the comment");
    expect(h.alerts.at(-1)!.message).not.toMatch(/\[object Object\]/);
    expect(removed).not.toHaveBeenCalled();
  });
});

describe("where a comment is shown, a press and hold opens it", () => {
  const code = (file: string) =>
    readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  /** Each preview under the caption, from its map to the Pressable it is drawn in closing. */
  const previews = (src: string) => src.match(/\{preview\.map\(\(c\) => \(\s*<Pressable\b[\s\S]*?<\/Pressable>/g) ?? [];

  it("the Comments screen", () => {
    const comments = code("app/comments.tsx");
    expect(comments).toMatch(/<Pressable style=\{styles\.comment\} onLongPress=\{\(\) => onLongPress\(comment\)\}>/);
    expect(comments).toMatch(/const onCommentLongPress = useCallback\(\s*\(comment: CommentWithAuthor\) =>\s*showCommentMenu\(comment, \{ userId, isAdmin \}, \(\) => \{/);
  });

  it("the previews under a photograph in the feed and a member's gallery (PostCard)", () => {
    const card = code("src/components/PostCard.tsx");
    const [preview] = previews(card);
    expect(previews(card)).toHaveLength(1);
    expect(preview).toMatch(/onPress=\{\(\) => onOpenComments\(post\)\}/);
    expect(preview).toMatch(/onLongPress=\{onCommentLongPress \? \(\) => onCommentLongPress\(c\) : undefined\}/);
    // Handed the same function by both screens that draw the card, so nothing is made fresh per draw.
    for (const screen of ["app/(tabs)/index.tsx", "app/gallery.tsx"]) {
      const src = code(screen);
      expect(src).toMatch(/onCommentLongPress, (onOpenLikes|onOpenPost)/);
      expect(src).toMatch(/<PostCard\b[\s\S]*?onCommentLongPress=\{onCommentLongPress\}[\s\S]*?\/>/);
    }
  });

  it("the previews on a photograph's own page", () => {
    const page = code("app/post/[id].tsx");
    const [preview] = previews(page);
    expect(previews(page)).toHaveLength(1);
    expect(preview).toMatch(/onPress=\{\(\) => onOpenComments\(post\)\}/);
    expect(preview).toMatch(/onLongPress=\{\(\) => onCommentLongPress\(c\)\}/);
  });

  it("the Editorial layout's card too, where the build has it", () => {
    // It takes PostCard's props (Home and the gallery hand either card the
    // same ones), and draws its own previews: they must take the menu too.
    const file = "src/components/feed/EditorialPostCard.tsx";
    if (!existsSync(path.resolve(import.meta.dirname, "..", file))) return;
    const card = code(file);
    for (const preview of previews(card)) {
      expect(preview).toMatch(/onLongPress=\{onCommentLongPress \? \(\) => onCommentLongPress\(c\) : undefined\}/);
    }
  });

  it("the menu is the post actions' for every card, and removing one moves its count and previews", () => {
    const actions = code("src/hooks/usePostActions.ts");
    expect(actions).toMatch(/const onCommentLongPress = useCallback\(\s*\(comment: CommentWithAuthor\) =>\s*showCommentMenu\(comment, \{ userId, isAdmin \}, \(\) => \{/);
    expect(actions).toMatch(/void rereadCommentPreviewsOf\(queryClient, postId\);/);
    expect(actions).toMatch(/comment_count: Math\.max\(0, p\.comment_count - 1\),/);
    expect(actions).toMatch(/onOpenComments,\s*onCommentLongPress,/);
  });
});
