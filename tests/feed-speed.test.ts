import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Photographs that come in at once, and new posts that come to Home, read
 * from the source: what is drawn without a dissolve, what is fetched
 * first and ahead, and how Home is wired to its new posts. The behaviour
 * itself is run in tests/newPosts.test.ts, tests/new-posts-home.test.ts
 * and tests/prefetchPlan.test.ts.
 */

/** The source without its comments. */
function code(file: string): string {
  return readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const images = (source: string) => source.match(/<Image\b[\s\S]*?\/>/g) ?? [];

describe("a picture already on the phone", () => {
  it("is drawn at once, never dissolved in as if it were loading: the feed, the gallery, a post, grids, the timeline, faces", () => {
    // The image view dissolves whatever it is given, a picture in memory
    // too (expo-image's ImageView.swift, renderSourceImage).
    const swift = readFileSync(path.resolve(import.meta.dirname, "..", "node_modules/expo-image/ios/ImageView.swift"), "utf8");
    expect(swift).toMatch(/if let transition = transition, transition\.duration > 0 \{/);
    const photo = images(code("src/components/PostMedia.tsx")).find((tag) => /source=\{inFrame\}/.test(tag)) ?? "";
    expect(photo).toMatch(/transition=\{0\}/);
    for (const file of ["src/components/PhotoGrid.tsx", "src/components/Avatar.tsx", "src/components/Timeline.tsx"]) {
      const tags = images(code(file));
      expect(tags.length, file).toBeGreaterThan(0);
      for (const tag of tags) expect(tag, file).toMatch(/transition=\{0\}/);
    }
    const inspector = images(code("src/components/PhotoInspector.tsx")).find((tag) => /priority="high"/.test(tag)) ?? "";
    expect(inspector).toMatch(/transition=\{0\}/);
  });

  it("stands on its small copy while the full frame comes, kept in memory and on disk", () => {
    const media = code("src/components/PostMedia.tsx");
    const photo = images(media).find((tag) => /source=\{inFrame\}/.test(tag)) ?? "";
    expect(photo).toMatch(/placeholder=\{thumb && thumb !== inFrame \? thumb : undefined\}/);
    expect(photo).toMatch(/priority=\{priority\}/);
    expect(photo).toMatch(/recyclingKey=\{pictureKey\}/);
    expect(media).toMatch(/cachePolicy = "memory-disk",/);
  });

  it("is fetched first on a grid's first screen", () => {
    const grid = code("src/components/PhotoGrid.tsx");
    expect(grid).toMatch(/priority=\{index < GRID_FIRST_SCREEN \? "high" : "normal"\}/);
    expect(Number(grid.match(/export const GRID_FIRST_SCREEN = (\d+);/)?.[1])).toBe(12);
    const tile = images(grid.slice(grid.indexOf("export function PhotoTile(")))[0];
    expect(tile).toMatch(/priority=\{priority\}/);
    expect(grid).toMatch(/priority = "normal",/);
  });
});

describe("Home fetching ahead", () => {
  const home = code("app/(tabs)/index.tsx");

  it("fetches the next posts' pictures from the card on screen, only while Home is in front", () => {
    expect(home).toMatch(
      /useEffect\(\(\) => \{\s*if \(focused\) prefetchAhead\(posts, Math\.max\(seenIndex, FIRST_SCREEN - 1\)\);\s*\}, \[posts, seenIndex, focused\]\);/,
    );
  });

  it("onto the disk, each address once, never into memory", () => {
    const prefetch = code("src/media/prefetch.ts");
    expect(prefetch).toMatch(/Image\.prefetch\(out, "disk"\)/);
    expect(prefetch).not.toMatch(/"memory-disk"|"memory"/);
    expect(prefetch).toMatch(/const fresh = askedOnce\(\);/);
  });
});

describe("Home's new posts", () => {
  const home = code("app/(tabs)/index.tsx");
  const hook = code("src/hooks/useNewPosts.ts");

  it("are looked for while Home is in front and its feed has loaded, and shown with the tag over the list", () => {
    expect(home).toMatch(/const newPosts = useNewPosts\(\{ userId, posts, focused, hasFeed: feed\.data != null, atTop, toTop \}\);/);
    expect(home).toMatch(/\{newPosts\.waiting \? <NewPostsTag onPress=\{newPosts\.showNew\} \/> : null\}/);
    // Over the list, not in it: nothing in the list moves when it comes or goes.
    const list = home.slice(home.indexOf("<FlatList"), home.indexOf("/>", home.indexOf("onMomentumScrollEnd={onMomentumScrollEnd}")));
    expect(list).not.toMatch(/NewPostsTag/);
    expect(hook).toMatch(/const watching = Boolean\(userId\) && focused && appFront && online && hasFeed;/);
  });

  it("go in without a word only at the very top with no finger on the list", () => {
    expect(home).toMatch(/\(\) => scrollY\.current <= AT_TOP_PX && !dragging\.current && !gliding\.current/);
    for (const handler of ["onScroll", "onScrollBeginDrag", "onScrollEndDrag", "onMomentumScrollBegin", "onMomentumScrollEnd"]) {
      expect(home).toMatch(new RegExp(`${handler}=\\{${handler}\\}`));
    }
    // The handlers write down where the list is; none of them draws Home again.
    const handlers = home.slice(home.indexOf("const onScroll = useCallback"), home.indexOf("const atTop = useCallback"));
    expect(handlers).not.toMatch(/set[A-Z]\w*\(/);
  });

  it("are read in two small steps, never by reading every page held again", () => {
    expect(hook).toMatch(/await fetchFeedHead\(me, FEED_HEAD_SIZE\)/);
    expect(hook).toMatch(/fetchFeedPage\(me, null\)/);
    expect(hook).not.toMatch(/invalidateQueries|refetchQueries|\.refetch\(/);
    expect(hook).toMatch(/if \(queryClient\.getQueryState\(key\)\?\.fetchStatus !== "idle"\) return;/);
  });

  it("are said plainly, as a button", () => {
    const tag = readFileSync(path.resolve(import.meta.dirname, "..", "src/components/NewPostsTag.tsx"), "utf8");
    expect(tag).toMatch(/>New posts</);
    expect(tag).toMatch(/accessibilityRole="button"/);
    expect(tag).toMatch(/accessibilityLabel="New posts"/);
    expect(tag).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("leave the member's own post to the outbox, which puts it on Home only once the server has it", () => {
    const outbox = code("src/uploads/outbox.ts");
    const insert = outbox.slice(outbox.indexOf("async function insertStep("), outbox.indexOf("function confirm("));
    expect(insert.indexOf("await createPost(")).toBeGreaterThan(-1);
    expect(insert.indexOf("confirm(live)")).toBeGreaterThan(insert.indexOf("await createPost("));
    expect(code("src/media/newPosts.ts")).toMatch(/head\.filter\(\(p\) => p\.author_id !== me &&/);
  });
});
