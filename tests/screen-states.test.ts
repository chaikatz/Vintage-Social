import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readState, type ReadLike } from "@/components/readState";

/**
 * Honest screen states: a read that failed says it could not load, with a
 * way to try again, and is never taken for a screen with nothing on it; a
 * read that fails again after it has answered leaves its answer on screen.
 */

const root = path.resolve(import.meta.dirname, "..");
/** A file's code without its comments, so a guard reads what runs. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** A react-query result as it stands at each moment that matters. */
const read = {
  /** Asked, nothing back yet. */
  waiting: { isError: false, isFetched: false, data: undefined },
  /** Answered, with nothing in it. */
  answeredEmpty: { isError: false, isFetched: true, data: [] },
  /** Answered, with rows. */
  answered: { isError: false, isFetched: true, data: [{ id: "a" }] },
  /** Failed before it brought anything back: a timeout, a 5xx. A failed read counts as fetched. */
  failed: { isError: true, isFetched: true, data: undefined },
  /** The first read with no signal: failed, and not counted as an answer (showOfflineFirstReadsAsFailed). */
  failedOffline: { isError: true, isFetched: false, data: undefined },
  /** Answered with rows, then a re-read in the background failed. */
  failedAgain: { isError: true, isFetched: true, data: [{ id: "a" }] },
  /** Answered with nothing, then a re-read failed. */
  failedAgainEmpty: { isError: true, isFetched: true, data: [] },
  /** Answered that there is no such thing (a post read by id). */
  answeredNull: { isError: false, isFetched: true, data: null },
  /** Not asked at all (the query is not enabled). */
  idle: { isError: false, isFetched: false, data: undefined },
} satisfies Record<string, ReadLike>;

describe("what a screen draws where its rows would be", () => {
  it("says a read that failed could not load, never that there is nothing", () => {
    expect(readState(read.failed)).toBe("failed");
  });

  it("says so for a first read made with no signal, rather than waiting for good", () => {
    expect(readState(read.failedOffline)).toBe("failed");
  });

  it("says empty only for a read that answered with nothing", () => {
    expect(readState(read.answeredEmpty)).toBe("empty");
    expect(readState(read.answeredNull)).toBe("empty");
  });

  it("waits while the read is on its way, or not yet asked", () => {
    expect(readState(read.waiting)).toBe("waiting");
    expect(readState(read.idle)).toBe("waiting");
  });

  it("keeps the last answer when a re-read fails", () => {
    expect(readState(read.failedAgain)).not.toBe("failed");
    expect(readState(read.failedAgainEmpty)).toBe("empty");
  });

  it("is failed when any of several reads drawn as one failed, and empty only once all have answered", () => {
    expect(readState(read.answeredEmpty, read.failed)).toBe("failed");
    expect(readState(read.failedOffline, read.answered)).toBe("failed");
    expect(readState(read.answeredEmpty, read.waiting)).toBe("waiting");
    expect(readState(read.answeredEmpty, read.answeredEmpty)).toBe("empty");
    expect(readState(read.answered, read.failedAgain)).toBe("empty");
  });
});

describe("the screens that draw a read", () => {
  it("your profile's grid: a failed read is not 'No photographs yet'", () => {
    const src = code("app/(tabs)/profile.tsx");
    expect(src).toMatch(/const gridRead = readState\(posts, tagged\);/);
    expect(src).toMatch(
      /empty=\{\s*gridRead === "failed" \? \(\s*<LoadFailed\s+what="your photographs"\s+onRetry=\{\(\) => \{\s*posts\.refetch\(\);\s*tagged\.refetch\(\);\s*\}\}\s*\/>\s*\) : gridRead === "empty" \? \(\s*<EmptyState title="No photographs yet"/,
    );
    expect(src).not.toMatch(/posts\.isFetched \? \(\s*<EmptyState/);
  });

  it("a member's grid: the same, and nothing at all while it is locked", () => {
    const src = code("app/user/[username].tsx");
    expect(src).toMatch(/const gridRead = readState\(postsQ, taggedQ\);/);
    expect(src).toMatch(
      /empty=\{\s*locked \? null : gridRead === "failed" \? \(\s*<LoadFailed\s+what="their photographs"\s+onRetry=\{\(\) => \{\s*postsQ\.refetch\(\);\s*taggedQ\.refetch\(\);\s*\}\}\s*\/>\s*\) : gridRead === "empty" \? \(\s*<EmptyState title="No photographs yet" \/>/,
    );
  });

  it("a private member whose follow could not be read: said, not 'Ask to follow'", () => {
    const src = code("app/user/[username].tsx");
    expect(src).toMatch(/const followRead = readState\(followQ\);/);
    expect(src).toMatch(/const standingUnread = Boolean\(profile\?\.is_private\) && !isMe && !blocked && followRead === "failed";/);
    expect(src).toMatch(
      /\) : standingUnread \? \(\s*<LoadFailed what="their photographs" onRetry=\{\(\) => followQ\.refetch\(\)\} \/>\s*\) : locked \? \(/,
    );
  });

  it("a member's follow button offers a follow only once it is known you don't follow them", () => {
    const src = code("app/user/[username].tsx");
    const button = src.match(/<Button\s+title=\{followRead[\s\S]*?\/>/)?.[0] ?? "";
    // Could not be read: "Try again", which reads it again, never "Follow", which sent a second follow.
    expect(button).toMatch(/title=\{followRead === "failed" \? "Try again" : followLabel\}/);
    expect(button).toMatch(/variant=\{status \|\| followRead === "failed" \? "secondary" : "primary"\}/);
    expect(button).toMatch(
      /onPress=\{\(\) => \(followRead === "empty" \? toggleFollow\.mutate\(status === null\) : void followQ\.refetch\(\)\)\}/,
    );
    // On its way: the button waits with it, rather than offering "Follow" to a member who may already follow.
    expect(button).toMatch(/loading=\{toggleFollow\.isPending \|\| \(followRead !== "empty" && followQ\.isFetching\)\}/);
    expect(src.match(/toggleFollow\.mutate\(/g)).toHaveLength(1);
  });

  it("Likes: a re-read that fails leaves the likers on screen", () => {
    const src = code("app/likes.tsx");
    expect(src).toMatch(/\) : readState\(likers\) === "failed" \? \(\s*<LoadFailed what="the likes"/);
    expect(src).not.toMatch(/\) : likers\.isError \? \(/);
  });

  it("the library picker: a library that could not be read is not 'Nothing from then'", () => {
    const src = code("app/library-picker.tsx");
    expect(src).toMatch(
      /ListEmptyComponent=\{\s*readState\(photos\) === "failed" \? \(\s*<LoadFailed what="your photographs" body="Try again in a moment\." onRetry=\{\(\) => photos\.refetch\(\)\} \/>\s*\) : photos\.isFetched \? \(\s*<EmptyState\s+title="Nothing from then"/,
    );
  });

  it("the gallery: a read that failed is not 'This member hasn’t posted a photograph', nor a skeleton for good", () => {
    const src = code("app/gallery.tsx");
    expect(src).toMatch(/const read = era \? readState\(postsQ, authorQ, eraEdits\) : readState\(postsQ, authorQ\);/);
    expect(src).toMatch(
      /ListEmptyComponent=\{\s*read === "failed" \? \(\s*<LoadFailed what="these photographs" onRetry=\{readAgain\} \/>\s*\) : loading \? \(/,
    );
    // A member who could not be found is not one with no photographs.
    expect(src).toMatch(/\) : !authorQ\.data \? \(\s*<EmptyState title="Member not found" \/>\s*\) : \(\s*<EmptyState title="Nothing here yet"/);
  });

  it("On this day: your posts that could not be read, or a library that could not be looked through, are not 'Nothing from this day yet'", () => {
    const src = code("app/memories.tsx");
    expect(src).toMatch(/const postsRead = readState\(posts\);/);
    expect(src).toMatch(/const libraryFailed = readState\(access\) === "failed" \|\| \(granted && readState\(library\) === "failed"\);/);
    expect(src).toMatch(/const nothing =\s*postsRead === "empty" &&[^;]*!libraryFailed &&/);
    expect(src).toMatch(
      /\{postsRead === "failed" \? \(\s*<LoadFailed what="your photographs" onRetry=\{\(\) => posts\.refetch\(\)\} \/>\s*\) : postsRead === "waiting" \? \(/,
    );
    expect(src).toMatch(/\) : libraryFailed && libraryTotal === 0 \? \([\s\S]*?onPress=\{lookThroughAgain\}[\s\S]*?>Try again</);
  });

  it("Share outside: a photograph that could not be read is said, not an empty frame", () => {
    const src = code("app/export.tsx");
    expect(src).toMatch(
      /\) : readState\(postQ\) === "failed" \? \(\s*<LoadFailed what="this photograph" onRetry=\{\(\) => postQ\.refetch\(\)\} \/>\s*\) : readState\(postQ\) === "empty" \? \(\s*<EmptyState title="This photograph is gone" \/>/,
    );
  });

  it("LoadFailed says to check the connection unless the screen has words of its own", () => {
    const src = code("src/components/LoadFailed.tsx");
    expect(src).toMatch(/body = "Check your connection and try again\.",/);
    expect(src).toMatch(/<Text style=\{styles\.body\}>\{body\}<\/Text>/);
  });
});
