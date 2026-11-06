import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_STRETCH,
  PICTURES_AHEAD,
  PICTURES_BEHIND,
  TIMELINE_FIRST_ROWS,
  TIMELINE_FIRST_WINDOW,
  TIMELINE_SCREENS,
  idsAround,
  pictureWindow,
  rowTops,
  STAND_INS_AROUND,
  STAND_IN_STEP,
  cardAtOffset,
  nextStandInFocus,
  standInWindow,
  timelineWindow,
  type RowWindow,
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

describe("the gallery's small copies standing in", () => {
  it("are none while the gallery lands, so the landing fetches what it did", () => {
    for (const startIndex of [0, 60, 156]) {
      expect(drawn(standInWindow({ ready: false, startIndex, seenIndex: null, count: 157 }), 157)).toEqual([]);
    }
  });

  it("are eight cards either side of the reader once it shows, around every card that draws its photograph", () => {
    expect(STAND_INS_AROUND).toBe(8);
    const w = standInWindow({ ready: true, startIndex: 60, seenIndex: 70, count: 157 });
    expect(drawn(w, 157)).toEqual(Array.from({ length: 17 }, (_, i) => 62 + i));
    for (const seenIndex of [null, 0, 5, 70, 156]) {
      const pictures = pictureWindow({ ready: true, startIndex: 60, seenIndex, count: 157 });
      const standIns = standInWindow({ ready: true, startIndex: 60, seenIndex, count: 157 });
      for (const i of drawn(pictures, 157)) expect(isWarm(i, standIns)).toBe(true);
    }
  });

  it("cover a quick scroll of a few cards before the window catches up", () => {
    // The reader was on card 70 and flicked on six; the window still sits on 70.
    const standIns = standInWindow({ ready: true, startIndex: 60, seenIndex: 70, count: 157 });
    const pictures = pictureWindow({ ready: true, startIndex: 60, seenIndex: 70, count: 157 });
    for (const landed of [76, 77]) {
      expect(isWarm(landed, pictures)).toBe(false);
      expect(isWarm(landed, standIns)).toBe(true);
    }
  });

  it("follow the scroll itself: a quick scroll of twelve cards finds them already there", () => {
    // Cards of 700 points under 8 of padding, in an 844-point view; the reader was on card 70.
    const heights = new Map(Array.from({ length: 157 }, (_, i) => [i, 700] as const));
    const heightOf = (i: number) => heights.get(i);
    const middleOf = (card: number) => 8 + card * 700 + 350;
    let focus: number | null = null;
    focus = nextStandInFocus(focus, cardAtOffset(middleOf(70), 157, heightOf, 8));
    expect(focus).toBe(70);
    // A twelve-card flick, read as the list scrolls (every 100 points).
    let moves = 0;
    for (let y = middleOf(70); y <= middleOf(82); y += 100) {
      const next = nextStandInFocus(focus, cardAtOffset(y, 157, heightOf, 8));
      if (next !== focus) moves++;
      focus = next;
    }
    // Moved every few cards on the way, not at every card.
    expect(moves).toBeLessThanOrEqual(12 / STAND_IN_STEP);
    const standIns = standInWindow({ ready: true, startIndex: 60, seenIndex: focus, count: 157 });
    // Where the flick came to rest, and the card below it, already hold their small copies,
    // though the card reported on screen is still 70 and its photographs stop at 73.
    for (const landed of [82, 83]) expect(isWarm(landed, standIns)).toBe(true);
    expect(isWarm(82, pictureWindow({ ready: true, startIndex: 60, seenIndex: 70, count: 157 }))).toBe(false);
  });

  it("find the card at a point of the list from the heights the cards gave, the rest at their average", () => {
    const given = [500, 700, undefined, 900];
    const heightOf = (i: number) => given[i];
    expect(STAND_IN_STEP).toBe(3);
    expect(cardAtOffset(0, 4, heightOf, 8)).toBe(0);
    expect(cardAtOffset(507, 4, heightOf, 8)).toBe(0);
    expect(cardAtOffset(508, 4, heightOf, 8)).toBe(1);
    // The third card is counted at the average of the others (700).
    expect(cardAtOffset(8 + 500 + 700 + 699, 4, heightOf, 8)).toBe(2);
    expect(cardAtOffset(8 + 500 + 700 + 700, 4, heightOf, 8)).toBe(3);
    expect(cardAtOffset(1e9, 4, heightOf, 8)).toBe(3);
    // Nothing measured, or nothing at all: the first card.
    expect(cardAtOffset(5000, 4, () => undefined, 8)).toBe(0);
    expect(cardAtOffset(5000, 0, heightOf, 8)).toBe(0);
    // Moved only a few cards on, either way.
    expect(nextStandInFocus(null, 9)).toBe(9);
    expect(nextStandInFocus(9, 11)).toBe(9);
    expect(nextStandInFocus(9, 12)).toBe(12);
    expect(nextStandInFocus(9, 6)).toBe(6);
  });

  it("stop at the ends of the list", () => {
    expect(drawn(standInWindow({ ready: true, startIndex: 0, seenIndex: 2, count: 5 }), 5)).toEqual([0, 1, 2, 3, 4]);
    const none = standInWindow({ ready: true, startIndex: 0, seenIndex: null, count: 0 });
    expect(none.last).toBeLessThan(none.first);
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

  it("still hold the cards a list keeps from its first draw, however far down the reader is", () => {
    const all = ids(500);
    // Home keeps its first four cards drawn for good. Two stretches down
    // (from card 24 on), the stretches alone no longer hold them.
    expect(idsAround(all, 24)).not.toContain(all[0]);
    for (const focus of [24, 30, 100, 499]) {
      const read = idsAround(all, focus, { keepFirst: 4 });
      for (const i of [0, 1, 2, 3]) expect(read).toContain(all[i]);
      // The stretches are as they were, after them, each id once.
      expect(read.slice(4)).toEqual(idsAround(all, focus));
      expect(new Set(read).size).toBe(read.length);
      expect(read.length).toBeLessThanOrEqual(3 * ACTION_STRETCH + 4);
    }
    // Near the top they are in the stretches already: the same request as without.
    for (let focus = 0; focus < 24; focus++) expect(idsAround(all, focus, { keepFirst: 4 })).toEqual(idsAround(all, focus));
    // One request per stretch still, so the likes are not read again on every card.
    expect(idsAround(all, 30, { keepFirst: 4 }).join(",")).toBe(idsAround(all, 35, { keepFirst: 4 }).join(","));
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
    expect(home).toMatch(
      /const actionIds = useMemo\(\s*\(\) => idsAround\(postIds, Math\.max\(0, seenIndex\), \{ keepFirst: HOME_FIRST_DRAW \}\),\s*\[postIds, seenIndex\],\s*\);/,
    );
    // The cards the list keeps for good are the ones its likes are kept for.
    expect(home).toMatch(/initialNumToRender=\{HOME_FIRST_DRAW\}/);
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
  const line = (n: number) => Array.from({ length: n }, (_, i) => i * 230);
  const tops = line(157);
  type More = Partial<{ scale: number; lift: number; viewport: number }>;
  const at = (scrollY: number, current: RowWindow = TIMELINE_FIRST_WINDOW, more: More = {}, all: readonly (number | undefined)[] = tops) =>
    timelineWindow({ tops: all, current, scrollY, viewport: 700, blockTop: 350, scale: 1, lift: 0, ...more });
  const NONE: RowWindow = { first: 0, end: 0 };
  /** The rows any part of which is in a 700-point view scrolled to `scrollY`. */
  const inView = (scrollY: number, all: readonly number[] = tops) =>
    all
      .map((_, i) => i)
      .filter((i) => 350 + all[i] < scrollY + 700 && 350 + (all[i + 1] ?? all[i] + 230) > scrollY);
  const holds = (w: RowWindow, i: number) => i >= w.first && i < w.end;

  it("are the first screens' rows when it opens, not every photograph", () => {
    expect(TIMELINE_FIRST_ROWS).toBe(8);
    expect(TIMELINE_FIRST_WINDOW).toEqual({ first: 0, end: TIMELINE_FIRST_ROWS });
    expect(TIMELINE_SCREENS).toEqual({ drawn: [1, 2], spare: [2, 4], kept: [4, 6] });
    // The first eight already reach two screens below the view here: the same window, so nothing is drawn again.
    expect(at(0)).toBe(TIMELINE_FIRST_WINDOW);
    // From none: the rows whose top is within four screens below the view, the window's spare included.
    expect(at(0, NONE)).toEqual({ first: 0, end: Math.floor((700 * 5 - 350) / 230) + 1 });
  });

  it("come in a few screens ahead of the reader, let go of the rows far behind, and come back", () => {
    const down = at(5000);
    for (const i of inView(5000)) expect(holds(down, i)).toBe(true);
    // Two screens below the view, and more, are drawn ahead of the reader.
    expect(350 + tops[down.end - 1]).toBeGreaterThan(5000 + 700 * 3 - 230);
    // The rows at the top of the line, more than four screens up, have let their pictures go.
    expect(down.first).toBeGreaterThan(0);
    expect(350 + tops[down.first + 1]).toBeGreaterThan(5000 - 4 * 700);
    // Scrolling back up draws them again.
    const back = at(0, down);
    expect(back.first).toBe(0);
    for (const i of inView(0)) expect(holds(back, i)).toBe(true);
  });

  it("hold a few dozen pictures at most, however long the line, and always the ones in view", () => {
    for (const n of [157, 1000]) {
      const all = line(n);
      const bottom = 350 + all[n - 1] + 230;
      let w = TIMELINE_FIRST_WINDOW;
      let changes = 0;
      let most = 0;
      const visit = (y: number) => {
        const next = at(y, w, {}, all);
        if (next !== w) changes++;
        w = next;
        most = Math.max(most, w.end - w.first);
        for (const i of inView(y, all)) expect(holds(w, i)).toBe(true);
      };
      for (let y = 0; y <= bottom; y += 40) visit(y);
      for (let y = bottom; y >= 0; y -= 40) visit(y);
      // Seven screens of rows at most (about twenty-three here), not the whole line.
      expect(most).toBeLessThanOrEqual(Math.ceil((7 * 700) / 230) + 2);
      // And the line is drawn again every screen or two, not on every scroll:
      // every two screens on the way down, every screen on the way back up.
      const screens = bottom / 700;
      expect(changes).toBeLessThanOrEqual(Math.ceil(screens / 2 + screens) + 2);
    }
  });

  it("reach further when the line is shrunk, and follow it when it is lifted", () => {
    expect(at(0, NONE, { scale: 0.5 }).end).toBeGreaterThan(at(0, NONE).end);
    expect(at(0, NONE, { lift: -2000 }).end).toBeGreaterThan(at(0, NONE).end);
    // Lifted past the first rows, those are let go, as rows scrolled past are.
    expect(at(0, at(0, NONE), { lift: -5000 }).first).toBeGreaterThan(0);
  });

  it("let go of the rows a magnified line has pushed far below the view", () => {
    // Shrunk to half, the view surveys twice the rows, and draws them.
    const shrunk = at(0, NONE, { scale: 0.5 });
    expect(shrunk.end).toBeGreaterThan(at(0, NONE).end * 1.8);
    // Pinched back out to two and a half times: the same rows are now
    // more than six screens below, and let their pictures go.
    const magnified = at(0, shrunk, { scale: 2.5 });
    expect(magnified.end).toBeLessThan(shrunk.end / 2);
    for (const i of [0, 1]) expect(holds(magnified, i)).toBe(true);
  });

  it("wait for rows that have not said where they are, and never let one of them go", () => {
    const partial = [0, 230, undefined, 690];
    expect(at(0, NONE, {}, partial)).toEqual({ first: 0, end: 2 });
    const some = { first: 0, end: 3 };
    expect(at(0, some, {}, [])).toBe(some);
    // No row placed yet, or the view not measured yet: as it was.
    expect(at(0, TIMELINE_FIRST_WINDOW, {}, new Array<number | undefined>(10))).toBe(TIMELINE_FIRST_WINDOW);
    expect(at(0, TIMELINE_FIRST_WINDOW, { viewport: 0 })).toBe(TIMELINE_FIRST_WINDOW);
    // Rows further down that have not reported are kept, whatever they hold.
    const half = [...line(40), ...new Array<number | undefined>(40)];
    expect(at(0, { first: 0, end: 80 }, {}, half)).toEqual({ first: 0, end: 80 });
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
    // Scrolled to the end of the line after the reading: the rows there draw their pictures.
    const drawnFrom = { first: 0, end: 14 };
    const reach = (all: readonly (number | undefined)[]) =>
      timelineWindow({ tops: all, current: drawnFrom, scrollY: 12835, viewport: 844, blockTop: 350, scale: 1, lift: 0 });
    const w = reach(again);
    expect(w.end).toBe(60);
    for (let i = 54; i < 60; i++) expect(holds(w, i)).toBe(true);
    // What the timeline used to have after a reading: no row placed, and no picture past the ones drawn.
    expect(reach(new Array<number | undefined>(60))).toBe(drawnFrom);
  });

  it("place a row new to the line once it says where it is, and keep the others' places", () => {
    const known = new Map([
      ["a", 0],
      ["b", 230],
    ]);
    expect(rowTops(["new", "a", "b"], known)).toEqual([undefined, 0, 230]);
    expect(rowTops([], known)).toEqual([]);
  });

  it("are drawn only for the rows in the window, by a row that is a memo and reports its top", () => {
    const timeline = code("src/components/Timeline.tsx");
    expect(timeline).toMatch(/const Row = React\.memo\(function Row\(\{/);
    expect(timeline).toMatch(/drawn=\{i >= drawnRows\.first && i < drawnRows\.end\}/);
    expect(timeline).toMatch(/current: drawnRef\.current,/);
    expect(timeline).toMatch(/if \(next !== drawnRef\.current\) \{\s*drawnRef\.current = next;\s*setDrawnRows\(next\);/);
    expect(timeline).toMatch(/\{url && drawn \? \(\s*<Image/);
    expect(timeline.match(/onLayout=\{onLayout\}/g)).toHaveLength(3);
    expect(timeline).toMatch(/scrollY\.current = e\.nativeEvent\.contentOffset\.y;\s*reveal\(\);/);
    expect(timeline).toMatch(/const inspect = useCallback\(/);
    // The tops are kept by row across readings of the posts, and each row reports its own key.
    expect(timeline).toMatch(/const knownTops = useRef\(new Map<string, number>\(\)\)\.current;/);
    expect(timeline).toMatch(/const tops = useMemo\(\(\) => rowTops\(rows\.map\(\(r\) => r\.key\), knownTops\), \[rows, knownTops\]\);/);
    expect(timeline).toMatch(/knownTops\.set\(key, top\);/);
    expect(timeline).toMatch(/onTop\(index, row\.key, e\.nativeEvent\.layout\.y\)/);
    expect(timeline).not.toMatch(/new Array<number \| undefined>\(rows\.length\)/);
  });
});
