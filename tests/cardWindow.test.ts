import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_STRETCH,
  PICTURES_AHEAD,
  PICTURES_BEHIND,
  TIMELINE_AHEAD_SCREENS,
  TIMELINE_FIRST_ROWS,
  TIMELINE_REVEAL_STEP,
  idsAround,
  pictureWindow,
  rowTops,
  timelineReveal,
} from "@/media/cardWindow";
import { isWarm, warmWindow, type WarmWindow } from "@/utils/videoWindow";

/**
 * Which of the gallery's cards draw their photograph: the ones around the
 * reader. Every other card is its frame, at the same height, so the
 * landing measures the same and nothing moves when a picture arrives.
 */

const drawn = (w: WarmWindow, count: number) => Array.from({ length: count }, (_, i) => i).filter((i) => isWarm(i, w));

/** The gallery's measure cap (MEASURE_LIMIT in app/gallery.tsx). */
const MEASURE_LIMIT = 80;

describe("the gallery's pictures", () => {
  it("are two cards behind the reader and three ahead", () => {
    expect(PICTURES_BEHIND).toBe(2);
    expect(PICTURES_AHEAD).toBe(3);
  });

  it("are the tapped photograph and the cards around it while the gallery lands", () => {
    const w = pictureWindow({ ready: false, startIndex: 60, seenIndex: null, count: 157 });
    expect(drawn(w, 157)).toEqual([58, 59, 60, 61, 62, 63]);
  });

  it("ignore what the hidden list reports on screen while it lands", () => {
    const w = pictureWindow({ ready: false, startIndex: 60, seenIndex: 0, count: 157 });
    expect(drawn(w, 157)).toEqual([58, 59, 60, 61, 62, 63]);
  });

  it("follow the card on screen once the gallery shows", () => {
    expect(drawn(pictureWindow({ ready: true, startIndex: 60, seenIndex: 70, count: 157 }), 157)).toEqual([68, 69, 70, 71, 72, 73]);
    // Nothing reported yet: still the tapped card.
    expect(drawn(pictureWindow({ ready: true, startIndex: 60, seenIndex: null, count: 157 }), 157)).toEqual([58, 59, 60, 61, 62, 63]);
  });

  it("always include every clip that has a player, so a playing clip is never a bare frame", () => {
    for (const ready of [false, true]) {
      for (const seenIndex of [null, 0, 5, 40, 156]) {
        for (const startIndex of [0, 1, 39, 156]) {
          const warm = warmWindow({ ready, startIndex, seenIndex, count: 157 });
          const pictures = pictureWindow({ ready, startIndex, seenIndex, count: 157 });
          for (const i of drawn(warm, 157)) expect(isWarm(i, pictures)).toBe(true);
        }
      }
    }
  });

  it("stop at the ends of the list, and are none for an empty one", () => {
    expect(drawn(pictureWindow({ ready: true, startIndex: 0, seenIndex: null, count: 10 }), 10)).toEqual([0, 1, 2, 3]);
    expect(drawn(pictureWindow({ ready: true, startIndex: 9, seenIndex: 9, count: 10 }), 10)).toEqual([7, 8, 9]);
    const none = pictureWindow({ ready: false, startIndex: 0, seenIndex: null, count: 0 });
    expect(none.last).toBeLessThan(none.first);
  });

  it("keep a landing deep in a long history to six photographs, however many cards it draws to measure", () => {
    // The first draw holds min(tapped + 3, MEASURE_LIMIT) cards (initialNumToRender
    // in app/gallery.tsx); every one of them used to fetch its photograph.
    for (const [count, tapped] of [
      [157, 60], // the longest history on production today
      [1000, 79],
      [1000, 500],
    ] as const) {
      const firstDraw = Math.min(tapped + 3, MEASURE_LIMIT);
      const pictures = drawn(pictureWindow({ ready: false, startIndex: tapped, seenIndex: null, count }), count);
      expect(pictures).toContain(tapped);
      expect(pictures.length).toBe(PICTURES_BEHIND + 1 + PICTURES_AHEAD);
      expect(firstDraw - pictures.filter((i) => i < firstDraw).length).toBeGreaterThan(50);
    }
  });
});

const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

describe("the posts whose likes and comment previews are read", () => {
  it("come a feed page at a time", () => {
    expect(ACTION_STRETCH).toBe(12);
  });

  it("are the reader's stretch and one either side", () => {
    const all = ids(100);
    expect(idsAround(all, 0)).toEqual(all.slice(0, 24));
    expect(idsAround(all, 30)).toEqual(all.slice(12, 48));
    expect(idsAround(all, 99)).toEqual(all.slice(84, 100));
  });

  it("stay the same request until the reader crosses into another stretch", () => {
    const all = ids(100);
    const key = (focus: number) => idsAround(all, focus).join(",");
    for (let i = 24; i < 36; i++) expect(key(i)).toBe(key(24));
    expect(key(36)).not.toBe(key(35));
  });

  it("always hold the card on screen and its neighbours, whatever the stretch", () => {
    const all = ids(500);
    for (let focus = 0; focus < 500; focus++) {
      const read = new Set(idsAround(all, focus));
      for (const near of [focus - 2, focus - 1, focus, focus + 1, focus + 2]) {
        if (near >= 0 && near < 500) expect(read.has(all[near])).toBe(true);
      }
    }
  });

  it("never grow with the list: a thousand photographs is still three stretches", () => {
    const all = ids(1000);
    let longest = 0;
    for (let focus = 0; focus < 1000; focus++) longest = Math.max(longest, idsAround(all, focus).length);
    expect(longest).toBe(3 * ACTION_STRETCH);
    // The address the likes read makes: postgrest-js encodes each comma as %2C.
    const address = (list: string[]) => `post_id=in.(${list.join("%2C")})`.length;
    // The gateway refused 1,000 ids (431 at 37 kB, measured); 36 ids is under 1.5 kB.
    expect(address(all)).toBeGreaterThan(37_000);
    expect(address(idsAround(all, 500))).toBeLessThan(1_500);
  });

  it("are nothing for an empty list, and the start for a focus that is not a number", () => {
    expect(idsAround([], 5)).toEqual([]);
    expect(idsAround(ids(30), Number.NaN)).toEqual(ids(30).slice(0, 24));
    expect(idsAround(ids(30), -4)).toEqual(ids(30).slice(0, 24));
  });
});

/** The source without its comments. */
function code(file: string): string {
  return readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Home and the gallery", () => {
  it("read likes and comment previews for the cards around the reader only", () => {
    const home = code("app/(tabs)/index.tsx");
    expect(home).toMatch(/const actionIds = useMemo\(\(\) => idsAround\(postIds, Math\.max\(0, seenIndex\)\), \[postIds, seenIndex\]\);/);
    expect(home).toMatch(/usePostActions\(userId, actionIds\)/);
    expect(home).toMatch(/if \(id\) setSeenId\(id\);/);
    // The outbox still hears about every post the feed holds.
    expect(home).toMatch(/notePostsInFeed\(postIds\)/);

    const gallery = code("app/gallery.tsx");
    expect(gallery).toMatch(/idsAround\(postIds, videoFocus\(\{ ready, startIndex, seenIndex: seenIndex < 0 \? null : seenIndex \}\)\)/);
    expect(gallery).toMatch(/usePostActions\(userId, actionIds\)/);
    expect(gallery).not.toMatch(/usePostActions\(userId, postIds\)/);
    expect(home).not.toMatch(/usePostActions\(userId, postIds\)/);
  });
});

describe("the timeline's pictures", () => {
  // Rows of 230 points under a 350-point profile, in a 700-point view.
  const tops = Array.from({ length: 157 }, (_, i) => i * 230);
  const at = (scrollY: number, through = TIMELINE_FIRST_ROWS, more: Partial<{ scale: number; lift: number }> = {}) =>
    timelineReveal({ tops, through, scrollY, viewport: 700, blockTop: 350, scale: 1, lift: 0, ...more });

  it("are the first screens' rows when it opens, not every photograph", () => {
    expect(TIMELINE_FIRST_ROWS).toBe(8);
    expect(TIMELINE_AHEAD_SCREENS).toBe(2);
    // The first eight already reach three screens down here, so nothing more yet.
    expect(at(0)).toBe(TIMELINE_FIRST_ROWS);
    // From none: the rows whose top is within three screens of the top of the page, and a step more.
    expect(at(0, 0)).toBe(Math.floor((2100 - 350) / 230) + 1 + TIMELINE_REVEAL_STEP);
    expect(at(0, 0)).toBeLessThan(20);
  });

  it("come in a few screens ahead of the reader, and stay", () => {
    const down = at(5000);
    expect(tops[down - 1 - TIMELINE_REVEAL_STEP]).toBeLessThanOrEqual(5000 + 2100 - 350);
    expect(down).toBeGreaterThan(at(0));
    // Scrolling back up never takes a picture away.
    expect(at(0, down)).toBe(down);
  });

  it("reach further when the line is shrunk, and follow it when it is lifted", () => {
    expect(at(0, TIMELINE_FIRST_ROWS, { scale: 0.5 })).toBeGreaterThan(at(0));
    expect(at(0, TIMELINE_FIRST_ROWS, { lift: -2000 })).toBeGreaterThan(at(0));
  });

  it("wait for rows that have not said where they are", () => {
    const partial = [0, 230, undefined, 690];
    expect(timelineReveal({ tops: partial, through: 0, scrollY: 0, viewport: 700, blockTop: 0, scale: 1, lift: 0 })).toBe(
      Math.min(4, 2 + TIMELINE_REVEAL_STEP),
    );
    expect(timelineReveal({ tops: [], through: 3, scrollY: 0, viewport: 700, blockTop: 0, scale: 1, lift: 0 })).toBe(3);
  });

  it("keep coming in after the posts are read again, with every row where it was", () => {
    // Sixty rows laid out and reported once. A like, a comment, a refresh or
    // a return reads the profile's posts again: the same rows in a new
    // array. None of them moved, so none is laid out again, and none says
    // where it is a second time.
    const keys = Array.from({ length: 60 }, (_, i) => `post-${i}`);
    const known = new Map(keys.map((k, i) => [k, i * 230] as const));
    const again = rowTops([...keys], known);
    expect(again).toEqual(keys.map((_, i) => i * 230));
    // Scrolled to the end of the line after the reading: every row draws its picture.
    const reach = (tops: readonly (number | undefined)[]) =>
      timelineReveal({ tops, through: 14, scrollY: 12835, viewport: 844, blockTop: 350, scale: 1, lift: 0 });
    expect(reach(again)).toBe(60);
    // What the timeline used to have after a reading: no row placed, and no picture past the ones drawn.
    expect(reach(new Array<number | undefined>(60))).toBe(14);
  });

  it("place a row new to the line once it says where it is, and keep the others' places", () => {
    const known = new Map([
      ["a", 0],
      ["b", 230],
    ]);
    expect(rowTops(["new", "a", "b"], known)).toEqual([undefined, 0, 230]);
    expect(rowTops([], known)).toEqual([]);
  });

  it("are drawn only for the rows revealed, by a row that is a memo and reports its top", () => {
    const timeline = code("src/components/Timeline.tsx");
    expect(timeline).toMatch(/const Row = React\.memo\(function Row\(\{/);
    expect(timeline).toMatch(/drawn=\{i < through\}/);
    expect(timeline).toMatch(/\{url && drawn \? \(\s*<Image/);
    expect(timeline.match(/onLayout=\{onLayout\}/g)).toHaveLength(3);
    // The tops are kept by row across readings of the posts, and each row reports its own key.
    expect(timeline).toMatch(/const knownTops = useRef\(new Map<string, number>\(\)\)\.current;/);
    expect(timeline).toMatch(/const tops = useMemo\(\(\) => rowTops\(rows\.map\(\(r\) => r\.key\), knownTops\), \[rows, knownTops\]\);/);
    expect(timeline).toMatch(/knownTops\.set\(key, top\);/);
    expect(timeline).toMatch(/onTop\(index, row\.key, e\.nativeEvent\.layout\.y\)/);
    expect(timeline).not.toMatch(/new Array<number \| undefined>\(rows\.length\)/);
    expect(timeline).toMatch(/scrollY\.current = e\.nativeEvent\.contentOffset\.y;\s*reveal\(\);/);
    expect(timeline).toMatch(/const inspect = useCallback\(/);
  });
});
