import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { newestUnreadFrom } from "@/utils/messageText";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

describe("opening a thread marks it read", () => {
  const me = "me";
  let n = 0;
  const msg = (sender_id: string, read_at: string | null, id = `m${++n}`) => ({ id, sender_id, read_at });

  it("only when something of theirs is unread", () => {
    expect(newestUnreadFrom(undefined, me)).toBeNull();
    expect(newestUnreadFrom([], me)).toBeNull();
    // My own messages are never mine to mark, read or not.
    expect(newestUnreadFrom([msg(me, null), msg(me, null)], me)).toBeNull();
    expect(newestUnreadFrom([msg("them", "2026-01-01")], me)).toBeNull();
    expect(newestUnreadFrom([msg("them", "2026-01-01"), msg("them", null, "m-unread")], me)).toBe("m-unread");
    // No reader, nothing to mark.
    expect(newestUnreadFrom([msg("them", null)], "")).toBeNull();
  });

  it("again for a second message that arrives before the thread shows the first marked", () => {
    const first = msg("them", null, "first");
    const second = msg("them", null, "second");
    // Opened: the first is unread, and marked.
    const opened = newestUnreadFrom([first], me);
    expect(opened).toBe("first");
    // The next read of the thread still shows it unread (the mark had not
    // landed): the same key, so no second write.
    expect(newestUnreadFrom([first], me)).toBe(opened);
    // A second message arrives before a read shows the first marked: a
    // new key, so it is marked too. As a yes or no, the answer was yes
    // throughout, and the second stayed unread.
    expect(newestUnreadFrom([first, second], me)).toBe("second");
    expect(newestUnreadFrom([{ ...first, read_at: "2026-01-01" }, second], me)).toBe("second");
    // One of mine after it changes nothing.
    expect(newestUnreadFrom([first, second, msg(me, null)], me)).toBe("second");
  });

  it("writes only then, and a write that fails is left for the next one", () => {
    const thread = read("app/messages/[id].tsx");
    expect(thread).toMatch(/const newestUnread = useMemo\(\(\) => newestUnreadFrom\(messagesQ\.data, userId\), \[messagesQ\.data, userId\]\);/);
    // Nothing between the check and the write but taking note of what the
    // write is for (src/utils/threadPoll.ts unreadIds).
    expect(thread).toMatch(
      /if \(!id \|\| !userId \|\| !newestUnread\) return;(\s*\/\/[^\n]*)*\s*const marking = unreadIds\([^\n]*\);\s*markConversationRead\(id, userId\)/,
    );
    expect(thread).toMatch(/\.catch\(\(\) => undefined\);\s*\}, \[id, userId, newestUnread, queryClient\]\);/);
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

  it("is named in a post's options without reading a member that is not there", () => {
    // A throw in a tap handler closes the app in a release build; no
    // error boundary catches it.
    const actions = read("src/hooks/usePostActions.ts");
    expect(actions).toMatch(/const name = post\.author\?\.username \?\? "this member";\s*showAlert\(name, undefined, \[/);
    expect(actions).toMatch(/text: `Block \$\{name\}`/);
    expect(actions).not.toMatch(/post\.author\.username/);
  });
});

describe("a list whose read failed", () => {
  // A failed read counts as fetched; these lists used to take it for an
  // answer and say they were empty ("No messages", "Nothing yet").
  const lists: [file: string, query: string, what: string][] = [
    ["app/messages/index.tsx", "conversations", "your messages"],
    ["app/(tabs)/activity.tsx", "activity", "your activity"],
    ["app/comments.tsx", "commentsQ", "the comments"],
    ["app/(tabs)/search.tsx", "explore", "the latest photographs"],
  ];
  for (const [file, query, what] of lists) {
    it(`${file} says it could not load, not that it is empty`, () => {
      const source = read(file);
      const failed = new RegExp(
        `${query}\\.isError \\? \\(\\s*<LoadFailed what="${what}" onRetry=\\{\\(\\) => ${query}\\.refetch\\(\\)\\} />\\s*\\) : ${query}\\.isFetched \\? \\(\\s*<EmptyState`,
      );
      expect(source).toMatch(failed);
    });
  }

  it("app/messages/[id].tsx says a thread it could not read could not load, not that it is an empty conversation", () => {
    const thread = read("app/messages/[id].tsx");
    expect(thread).toMatch(
      /\{readState\(messagesQ\) === "failed" \? \([\s\S]*?<LoadFailed what="this conversation" onRetry=\{\(\) => messagesQ\.refetch\(\)\} \/>[\s\S]*?\) : \(\s*<FlatList\s+data=\{newestFirst\}/,
    );
    // The thread's menu (Report, Block) is drawn either way.
    expect(thread.indexOf("<Stack.Screen")).toBeLessThan(thread.indexOf('readState(messagesQ) === "failed"'));
  });

  it("and a search that failed is not 'Nobody by that name'", () => {
    expect(read("app/(tabs)/search.tsx")).toMatch(
      /results\.isError && settledQ\.trim\(\) === q\.trim\(\) \? \(\s*<LoadFailed what="the search" onRetry=\{\(\) => results\.refetch\(\)\} \/>\s*\) : results\.isFetched/,
    );
  });
});
