import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Followers, Following, Send to and the tag sheet read who follows whom a
 * page at a time (fetchFollowPage: fifty rows, the newest follow first,
 * only what a row draws), ask for the next page as the list nears its end,
 * and say a read failed, with a way to try again, rather than calling the
 * list empty. They were one read of every follow with every column of
 * every profile, cut off without a word at PostgREST's thousand rows.
 * What the reads ask for is in api-query-shapes.test.ts; this is what the
 * screens do with them, read from the source.
 */

const root = path.resolve(import.meta.dirname, "..");
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Search", () => {
  const src = code("app/(tabs)/search.tsx");

  it("ranks results by where the member stands with them, read for the results only, not the whole lists", () => {
    // The whole lists stop at PostgREST's thousand: past that, some of
    // the members followed were ranked as strangers.
    expect(src).not.toMatch(/fetchFollowers|fetchFollowing\b/);
    expect(src).toMatch(/const followsAmongKey = \(userId: string, ids: string\[\]\) => \["follows", userId, "among", ids\.join\(","\)\] as const;/);
    // Read with the results, so they are drawn in their order at once.
    expect(src).toMatch(
      /const ranking = queryClient\.prefetchQuery\(\{\s*queryKey: followsAmongKey\(userId, ids\),\s*queryFn: \(\) => fetchFollowsAmong\(userId, ids\),/,
    );
    // For a moment at most: a ranking read that hangs on a slow connection
    // does not hold the results back; they come unranked and take their
    // order when it lands.
    expect(src).toMatch(/const FOLLOWS_AMONG_WAIT_MS = (\d+);/);
    expect(Number(src.match(/const FOLLOWS_AMONG_WAIT_MS = (\d+);/)![1])).toBeLessThanOrEqual(1500);
    expect(src).toMatch(
      /await Promise\.race\(\[ranking, new Promise<void>\(\(done\) => \(timer = setTimeout\(done, FOLLOWS_AMONG_WAIT_MS\)\)\)\]\);\s*clearTimeout\(timer\);/,
    );
    expect(src).not.toMatch(/await queryClient\.prefetchQuery/);
    expect(src).toMatch(/queryKey: followsAmongKey\(userId, resultIds\),\s*queryFn: \(\) => fetchFollowsAmong\(userId, resultIds\),/);
    expect(src).toMatch(/followingIds: new Set\(circleQ\.data\?\.following \?\? \[\]\),\s*followerIds: new Set\(circleQ\.data\?\.followers \?\? \[\]\),/);
  });
});

describe("Followers and Following", () => {
  const src = code("app/follows.tsx");

  it("reads a page at a time, and the next as the reader nears the end", () => {
    expect(src).toMatch(/const list = useInfiniteQuery\(\{/);
    expect(src).toMatch(/fetchFollowPage\(followers \? "followers" : "following", userId \?\? "", pageParam\)/);
    expect(src).toMatch(/getNextPageParam: \(last\) => last\.next,/);
    expect(src).toMatch(/onEndReached=\{\(\) => \{\s*if \(list\.hasNextPage && !list\.isFetchingNextPage && !list\.isFetchNextPageError\) list\.fetchNextPage\(\);/);
    expect(src).not.toMatch(/fetchFollowers|fetchFollowing\b/);
  });

  it("knows where the reader stands with each row from the rows on the page, not every follow they made", () => {
    expect(src).toMatch(/await fetchFollowStates\(myId, page\.members\.map\(\(m\) => m\.id\)\)/);
    expect(src).toMatch(/p\.id in decided \? decided\[p\.id\] : standing\[p\.id\] \?\? null/);
  });

  it("says when the next page could not be read, with a way to try again", () => {
    expect(src).toMatch(/list\.isFetchNextPageError \? \(\s*<LoadFailed what="the rest" onRetry=\{\(\) => list\.fetchNextPage\(\)\} \/>/);
  });
});

describe("Send to", () => {
  const src = code("app/share.tsx");

  it("lists everyone the member follows, a page at a time", () => {
    expect(src).toMatch(/const peopleQ = useInfiniteQuery\(\{/);
    expect(src).toMatch(/fetchFollowPage\("following", userId, pageParam\)/);
    expect(src).toMatch(/onEndReached=\{\(\) => \{\s*if \(peopleQ\.hasNextPage && !peopleQ\.isFetchingNextPage && !peopleQ\.isFetchNextPageError\) peopleQ\.fetchNextPage\(\);/);
    expect(src).toMatch(/peopleQ\.isFetchNextPageError \? <LoadFailed what="the rest" onRetry=\{\(\) => peopleQ\.fetchNextPage\(\)\} \/> : null/);
  });
});

describe("Who was there (the tag sheet)", () => {
  const src = code("src/components/TagPicker.tsx");

  it("lists who the member follows a page at a time; anyone further is a search away", () => {
    expect(src).toMatch(/const following = useInfiniteQuery\(\{/);
    expect(src).toMatch(/fetchFollowPage\("following", myId, pageParam\)/);
    expect(src).toMatch(/if \(!searching && following\.hasNextPage && !following\.isFetchingNextPage && !following\.isFetchNextPageError\) \{\s*following\.fetchNextPage\(\);/);
  });

  it("says a failed read failed, rather than that nobody is there", () => {
    expect(src).toMatch(
      /searching && results\.isError \? \(\s*<LoadFailed what="the search" onRetry=\{\(\) => results\.refetch\(\)\} \/>\s*\) : !searching && following\.isError \? \(\s*<LoadFailed what="who you follow" onRetry=\{\(\) => following\.refetch\(\)\} \/>/,
    );
    // The empty words come only after those.
    expect(src.indexOf("following.isError")).toBeLessThan(src.indexOf("Follow a few members and they will be listed here."));
    expect(src.indexOf("results.isError")).toBeLessThan(src.indexOf("Nobody by that name."));
  });
});
