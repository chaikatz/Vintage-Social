import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unreadFrom } from "@/utils/messageText";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

describe("opening a thread marks it read", () => {
  const me = "me";
  const msg = (sender_id: string, read_at: string | null) => ({ sender_id, read_at });

  it("only when something of theirs is unread", () => {
    expect(unreadFrom(undefined, me)).toBe(false);
    expect(unreadFrom([], me)).toBe(false);
    // My own messages are never mine to mark, read or not.
    expect(unreadFrom([msg(me, null), msg(me, null)], me)).toBe(false);
    expect(unreadFrom([msg("them", "2026-01-01")], me)).toBe(false);
    expect(unreadFrom([msg("them", "2026-01-01"), msg("them", null)], me)).toBe(true);
    // No reader, nothing to mark.
    expect(unreadFrom([msg("them", null)], "")).toBe(false);
  });

  it("writes only then, and a write that fails is left for the next one", () => {
    const thread = read("app/messages/[id].tsx");
    expect(thread).toMatch(/const unreadFromPeer = useMemo\(\(\) => unreadFrom\(messagesQ\.data, userId\), \[messagesQ\.data, userId\]\);/);
    expect(thread).toMatch(/if \(!id \|\| !userId \|\| !unreadFromPeer\) return;\s*markConversationRead\(id, userId\)/);
    expect(thread).toMatch(/\}, \[id, userId, unreadFromPeer, queryClient\]\);/);
    expect(thread).toMatch(/\.catch\(\(\) => undefined\);\s*\}, \[id, userId, unreadFromPeer/);
  });
});

describe("Activity marks its notices read", () => {
  it("and a mark that fails is left for the next visit, not thrown away unhandled", () => {
    expect(read("app/(tabs)/activity.tsx")).toMatch(
      /markActivityRead\(userId\)\s*\.then\([^\n]*\)\s*\/\/[^\n]*\n\s*\.catch\(\(\) => undefined\);/,
    );
  });
});

describe("typing below a list leaves its rows as they are", () => {
  it("a thread's bubbles", () => {
    const thread = read("app/messages/[id].tsx");
    expect(thread).toMatch(/const Bubble = React\.memo\(function Bubble\(/);
    expect(thread).toMatch(/renderItem=\{renderBubble\}/);
    expect(thread).toMatch(/const renderBubble = useCallback\(/);
    expect(thread).toMatch(/const openPost = useCallback\(/);
    // Each bubble's age keeps time by the app's clock instead.
    expect(thread).toMatch(/postAge\(message\.created_at, now\)/);
  });

  it("a photograph's comments", () => {
    const comments = read("app/comments.tsx");
    expect(comments).toMatch(/const CommentRow = React\.memo\(function CommentRow\(/);
    expect(comments).toMatch(/renderItem=\{renderComment\}/);
    expect(comments).toMatch(/const onCommentLongPress = useCallback\(/);
    expect(comments).toMatch(/postAge\(comment\.created_at, now\)/);
  });
});

describe("a comment posted or removed", () => {
  const comments = read("app/comments.tsx");

  it("moves the count where the post is shown, without reading every page of the feed again", () => {
    expect(comments).not.toMatch(/invalidateQueries\(\{ queryKey: \["feed"\] \}\)/);
    expect(comments).toMatch(/invalidateQueries\(\{ queryKey: \["feed"\], refetchType: "none" \}\)/);
    expect(comments.match(/countComment\(1\);/g)).toHaveLength(1);
    expect(comments.match(/countComment\(-1\);/g)).toHaveLength(1);
  });

  it("says what went wrong in our words, never as an object printed", () => {
    expect(comments).not.toMatch(/err instanceof Error \? err\.message : String\(err\)/);
    expect(comments.match(/errorMessage\(err, /g)).toHaveLength(2);
  });
});

describe("a row whose member the reader may not see", () => {
  it("is drawn without the name, or left out, rather than breaking the page", () => {
    const comments = read("app/comments.tsx");
    expect(comments).toMatch(/const comments = useMemo\(\(\) => \(commentsQ\.data \?\? \[\]\)\.filter\(\(c\) => c\.author != null\), \[commentsQ\.data\]\);/);
    expect(comments).toMatch(/data=\{comments\}/);
    expect(comments).toMatch(/post\.caption && post\.author \? \(/);
    const thread = read("app/messages/[id].tsx");
    expect(thread).toMatch(/\{shared\.author \? \(\s*<Text style=\{\[styles\.sharedCaption/);
  });
});
