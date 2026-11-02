import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AWAY_MS,
  GIVE_UP_MS,
  LANDING_STEP_MS,
  STALL_MS,
  STILL_LOOKS,
  approachOffset,
  atListEnd,
  nextLanding,
  startLanding,
  type Landing,
  type Look,
} from "@/utils/galleryLanding";

/**
 * The gallery opening on the photograph tapped in a grid.
 *
 * A member with a long history tapped an old photograph and the gallery
 * opened on another, the same one every time: the gallery scrolled to the
 * sum of the heights above the tapped card, and a list without fixed
 * heights will not scroll past what it has drawn, so every deep tap
 * stopped at the end of the first eighty cards. These hold the landing
 * that looks where the card really is, against a list that behaves the
 * way the gallery's does, and the lines in the gallery that use it.
 */

const root = path.resolve(import.meta.dirname, "..");

/** The source without its comments, so prose that names what is not done is not taken as doing it. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PADDING = 8;
const look = (over: Partial<Look> = {}): Look => ({
  index: 5,
  top: null,
  scrolled: null,
  end: false,
  measured: 0,
  now: 0,
  ...over,
});

describe("a step of the landing", () => {
  it("opens at the top when the photograph is the first, or is no longer there", () => {
    // galleryRows hands back index 0 for a photograph deleted meanwhile.
    for (const top of [null, 0, 900]) {
      expect(nextLanding(startLanding(0), look({ index: 0, top })).step).toEqual({ kind: "show", offset: 0 });
    }
  });

  it("sends the list towards a card that is not drawn yet", () => {
    expect(nextLanding(startLanding(0), look({ top: null, measured: 80 })).step).toEqual({ kind: "approach" });
  });

  it("puts the list at the card's top once it is drawn", () => {
    const { step, landing } = nextLanding(startLanding(0), look({ top: 4210.5, measured: 80 }));
    expect(step).toEqual({ kind: "place", offset: 4210.5 });
    expect(landing.placedAt).toBe(4210.5);
  });

  it("shows only once the card has stayed where it was put for a few looks", () => {
    let landing: Landing = nextLanding(startLanding(0), look({ top: 4210, measured: 80 })).landing;
    const steps: string[] = [];
    for (let i = 1; i <= STILL_LOOKS; i++) {
      const next = nextLanding(landing, look({ top: 4210, scrolled: 4210, measured: 80, now: i * LANDING_STEP_MS }));
      landing = next.landing;
      steps.push(next.step.kind);
    }
    expect(steps).toEqual([...Array(STILL_LOOKS - 1).fill("hold"), "show"]);
  });

  it("puts it again when the cards drawn above it push it down, and counts the stillness again", () => {
    let landing: Landing = nextLanding(startLanding(0), look({ top: 4210, measured: 80 })).landing;
    landing = nextLanding(landing, look({ top: 4210, scrolled: 4210, measured: 80, now: 50 })).landing;
    expect(landing.still).toBe(1);
    const moved = nextLanding(landing, look({ top: 4390, scrolled: 4210, measured: 90, now: 100 }));
    expect(moved.step).toEqual({ kind: "place", offset: 4390 });
    expect(moved.landing.still).toBe(0);
  });

  it("puts it again when the list stopped short, with too little drawn below the card", () => {
    let landing: Landing = nextLanding(startLanding(0), look({ top: 47_800, measured: 80 })).landing;
    // The list could only get to the end of what it had drawn.
    const short = nextLanding(landing, look({ top: 47_800, scrolled: 47_624, measured: 80, now: 50 }));
    expect(short.step).toEqual({ kind: "place", offset: 47_800 });
    landing = short.landing;
    // Not yet said where it is, after being put: not taken as there.
    expect(nextLanding(landing, look({ top: 47_800, scrolled: null, measured: 85, now: 100 })).step.kind).toBe("place");
  });

  it("takes one of the last cards as landed when the list can go no further", () => {
    const landing = nextLanding(startLanding(0), look({ top: 88_500, measured: 149 })).landing;
    const atEnd = nextLanding(landing, look({ top: 88_500, scrolled: 88_088, end: true, measured: 149, now: 50 }));
    expect(atEnd.step.kind).toBe("hold");
  });

  it("counts a pixel either way as there, for the browser's rounding", () => {
    const landing = nextLanding(startLanding(0), look({ top: 4210, measured: 80 })).landing;
    expect(nextLanding(landing, look({ top: 4211, scrolled: 4210, measured: 80, now: 50 })).step.kind).toBe("hold");
    expect(nextLanding(landing, look({ top: 4209.5, scrolled: 4210.4, measured: 80, now: 50 })).step.kind).toBe("hold");
    expect(nextLanding(landing, look({ top: 4212, scrolled: 4212, measured: 80, now: 50 })).step.kind).toBe("place");
  });

  it("never puts the list above its top", () => {
    expect(nextLanding(startLanding(0), look({ top: -3, measured: 10 })).step).toEqual({ kind: "place", offset: 0 });
  });
});

/**
 * Looks one after another, as the gallery takes them, from `from` up to
 * `to` ms at most, every `every` ms: until one shows, which is returned
 * with when it came.
 */
function lookUntilShown(
  landing: Landing,
  at: (now: number) => Partial<Look>,
  { from = 0, to, every = LANDING_STEP_MS }: { from?: number; to: number; every?: number },
) {
  for (let now = from; now <= to; now += every) {
    const next = nextLanding(landing, look({ now, ...at(now) }));
    landing = next.landing;
    if (next.step.kind === "show") return { step: next.step, now, landing };
  }
  return { step: null, now: null, landing };
}

describe("when the landing gives up", () => {
  it("does not while the list is still drawing its way down", () => {
    let landing = startLanding(0);
    for (let now = 0, measured = 80; now < STALL_MS * 3; now += LANDING_STEP_MS, measured += 1) {
      const next = nextLanding(landing, look({ index: 140, top: null, measured, now }));
      expect(next.step.kind).toBe("approach");
      landing = next.landing;
    }
  });

  it("does not by the cap while the list is still drawing its way down, however long that takes", () => {
    // A tap far down a long history on a slow phone: a card every look,
    // for longer than the cap, and the tapped card not drawn yet.
    const walk = lookUntilShown(startLanding(0), (now) => ({ index: 900, top: null, measured: 80 + now / LANDING_STEP_MS }), {
      to: GIVE_UP_MS * 2,
    });
    expect(walk.step).toBeNull();
    // Then it stops drawing, the card never drawn: the stall shows the top.
    const stopped = lookUntilShown(walk.landing, () => ({ index: 900, top: null, measured: 80 + (GIVE_UP_MS * 2) / LANDING_STEP_MS }), {
      from: GIVE_UP_MS * 2 + LANDING_STEP_MS,
      to: GIVE_UP_MS * 3,
    });
    expect(stopped.step).toEqual({ kind: "show", offset: 0 });
    expect(stopped.now! - GIVE_UP_MS * 2).toBeLessThanOrEqual(STALL_MS + LANDING_STEP_MS);
  });

  it("shows by the cap counted from when the tapped card was first drawn", () => {
    // Drawn at last after twenty seconds of drawing its way down, and then
    // pushed down by every look, so it never holds still.
    const drawnAt = 20_000;
    const shown = lookUntilShown(
      startLanding(0),
      (now) =>
        now < drawnAt
          ? { top: null, measured: 80 + now / LANDING_STEP_MS }
          : { top: 50_000 + (now - drawnAt), scrolled: 50_000, measured: 80 + now / LANDING_STEP_MS },
      { to: drawnAt + GIVE_UP_MS * 2 },
    );
    expect(shown.now).toBe(drawnAt + GIVE_UP_MS);
    expect(shown.step?.kind).toBe("show");
  });

  it("shows the top, not wherever the list was left, when nothing more is drawn and the card never was", () => {
    const shown = lookUntilShown(startLanding(0), () => ({ top: null, measured: 80 }), { to: STALL_MS * 2 });
    expect(shown.step).toEqual({ kind: "show", offset: 0 });
    expect(shown.now).toBeLessThanOrEqual(STALL_MS);
  });

  it("shows where the card was last seen, if it was", () => {
    const landing = nextLanding(startLanding(0), look({ top: 6000, measured: 80 })).landing;
    const shown = lookUntilShown(landing, () => ({ top: null, measured: 80 }), { from: LANDING_STEP_MS, to: STALL_MS * 2 });
    expect(shown.step).toEqual({ kind: "show", offset: 6000 });
  });

  it("puts the list at the card before it shows, when it is late and the card has moved", () => {
    const landing = nextLanding(startLanding(0), look({ top: 6000, measured: 80 })).landing;
    // Moving a little more at every look, and then once more on the look that is late.
    const shown = lookUntilShown(landing, (now) => ({ top: 6000 + now, scrolled: 6000, measured: 80 }), {
      from: LANDING_STEP_MS,
      to: GIVE_UP_MS * 2,
    });
    expect(shown.now).toBe(GIVE_UP_MS);
    expect(shown.step).toEqual({ kind: "show", offset: 6000 + GIVE_UP_MS });
  });
});

describe("a landing the app was away from", () => {
  it("goes on after a pause, rather than taking it for a stall", () => {
    // Drawing its way down; then the phone is locked for a while, the list
    // drawing nothing meanwhile.
    let landing = startLanding(0);
    for (let now = 0; now <= 1000; now += LANDING_STEP_MS) {
      landing = nextLanding(landing, look({ index: 200, top: null, measured: 80 + now / LANDING_STEP_MS, now })).landing;
    }
    for (const pause of [2_500, 20_000, 120_000]) {
      const back = nextLanding(landing, look({ index: 200, top: null, measured: 100, now: 1000 + pause }));
      expect(back.step, `${pause} ms away`).toEqual({ kind: "approach" });
    }
  });

  it("still gives up on a list that has stopped, once it is back", () => {
    let landing = startLanding(0);
    landing = nextLanding(landing, look({ top: null, measured: 80, now: 0 })).landing;
    landing = nextLanding(landing, look({ top: null, measured: 80, now: 30_000 })).landing;
    const shown = lookUntilShown(landing, () => ({ top: null, measured: 80 }), { from: 30_050, to: 40_000 });
    expect(shown.step).toEqual({ kind: "show", offset: 0 });
    expect(shown.now! - 30_000).toBeLessThanOrEqual(STALL_MS);
  });

  it("does not count a pause after the card is drawn towards the cap", () => {
    // Drawn at once, pushed down at every look; ten seconds in, the tab is
    // out of sight for a minute.
    const moving = (now: number) => ({ top: 4000 + now, scrolled: 4000, measured: 80 });
    let { landing } = lookUntilShown(startLanding(0), moving, { to: 10_000 });
    const back = nextLanding(landing, look({ ...moving(70_000), now: 70_000 }));
    expect(back.step.kind).toBe("place");
    landing = back.landing;
    const shown = lookUntilShown(landing, moving, { from: 70_050, to: 100_000 });
    // Fifteen seconds of looking in all: ten before the pause, five after it.
    expect(shown.now! - 70_000).toBeGreaterThan(GIVE_UP_MS - 10_000 - 2 * LANDING_STEP_MS);
    expect(shown.now! - 70_000).toBeLessThanOrEqual(GIVE_UP_MS - 10_000 + LANDING_STEP_MS);
  });

  it("still gets there on a phone too busy to look on time", () => {
    // Every look late, nothing new drawn: each counts as one ordinary look.
    const slow = AWAY_MS + 100;
    const shown = lookUntilShown(startLanding(0), () => ({ top: null, measured: 80 }), { every: slow, to: slow * 200 });
    expect(shown.step).toEqual({ kind: "show", offset: 0 });
    expect(shown.now! / slow).toBeLessThanOrEqual(STALL_MS / LANDING_STEP_MS + 1);
  });
});

describe("whether the list can go no further", () => {
  it("is where it last said it is, against how long it is now", () => {
    expect(atListEnd(88_088, 760, 88_848)).toBe(true);
    expect(atListEnd(88_088.4, 760, 88_849)).toBe(true); // the browser's rounding
    expect(atListEnd(88_088, 760, 88_850)).toBe(false);
  });

  it("is not, once more is drawn below, though it was when the list last said where it is", () => {
    // Stopped at the end of what was drawn; five more cards drawn since, and no word from the list.
    expect(atListEnd(88_088, 760, 88_848 + 5 * 540)).toBe(false);
  });

  it("is from the start for a list that fits on the screen, which never says where it is", () => {
    expect(atListEnd(null, 900, 766)).toBe(true);
    expect(atListEnd(null, 760, 4_000)).toBe(false);
  });

  it("is not before the list and its content have been laid out", () => {
    expect(atListEnd(null, 0, 0)).toBe(false);
    expect(atListEnd(null, 760, 0)).toBe(false);
    expect(atListEnd(0, 0, 766)).toBe(false);
  });
});

describe("where the list is sent before the card is drawn", () => {
  it("is the heights known so far, and their typical height for the rest", () => {
    expect(approachOffset([500, 300, undefined, undefined], PADDING)).toBe(PADDING + 800 + 2 * 400);
  });

  it("is the exact sum when every height is known", () => {
    expect(approachOffset([500.5, 300.25], PADDING)).toBe(PADDING + 800.75);
  });

  it("is the top of the list when nothing has been measured", () => {
    expect(approachOffset([undefined, undefined], PADDING)).toBe(PADDING);
    expect(approachOffset([], PADDING)).toBe(PADDING);
  });
});

/**
 * A list that behaves the way the gallery's does, on the phone and in the
 * browser: cards of their own heights, the first eighty drawn at once, and
 * no scrolling past what is drawn. A scroll that reaches the end of what
 * is drawn draws the next few after it, before the next look, as the
 * list does when it is scrolled; growing says nothing, so where the list
 * last said it is can be from before. A list that cannot move says
 * nothing either. Its end is read the way the gallery reads it.
 */
function galleryList(heights: number[], { drawnAtOnce = 80, perScroll = 10, viewport = 760 } = {}) {
  let drawn = Math.min(drawnAtOnce, heights.length);
  let drawMore = false;
  let offset = 0;
  let said: number | null = null;
  const top = (i: number) => PADDING + heights.slice(0, i).reduce((a, b) => a + b, 0);
  const length = () => top(drawn) + (drawn === heights.length ? PADDING : 0);
  return {
    top,
    viewport,
    /** The furthest the whole list, all of it drawn, can be scrolled. */
    furthest: () => Math.max(0, top(heights.length) + PADDING - viewport),
    get offset() {
      return offset;
    },
    scrollTo(y: number) {
      const next = Math.min(Math.max(0, y), Math.max(0, length() - viewport));
      if (next !== offset) said = offset = next;
      if (offset + viewport >= length() - 1) drawMore = true;
    },
    look(index: number, now: number): Look {
      if (drawMore) {
        drawn = Math.min(heights.length, drawn + perScroll);
        drawMore = false;
      }
      return {
        index,
        top: index < drawn ? top(index) : null,
        scrolled: said,
        end: atListEnd(said, viewport, length()) && drawn === heights.length,
        measured: drawn,
        now,
      };
    },
    heightsAbove: (index: number) => heights.slice(0, index).map((h, i) => (i < drawn ? h : undefined)),
  };
}

/** The gallery's loop: look, take the step, look again, until it shows. */
function land(list: ReturnType<typeof galleryList>, index: number) {
  let landing = startLanding(0);
  for (let now = 0; now <= GIVE_UP_MS; now += LANDING_STEP_MS) {
    const { step, landing: next } = nextLanding(landing, list.look(index, now));
    landing = next;
    if (step.kind === "show") {
      if (step.offset != null) list.scrollTo(step.offset);
      return { offset: list.offset, after: now };
    }
    if (step.kind === "approach") list.scrollTo(approachOffset(list.heightsAbove(index), PADDING));
    if (step.kind === "place") list.scrollTo(step.offset);
  }
  throw new Error("never showed");
}

// 149 cards of uneven, fractional heights: photographs, clips, captions and comments.
const HEIGHTS = Array.from({ length: 149 }, (_, i) => [652.4, 540.2, 470.7, 702.9, 333.3, 598.6][i % 6] + (i % 4) * 21.5);

describe("landing in a long history", () => {
  for (const index of [1, 10, 40, 76, 77, 78, 79, 80, 81, 100, 120, 140]) {
    it(`opens exactly on the photograph tapped, ${index} cards down`, () => {
      const list = galleryList(HEIGHTS);
      const { offset, after } = land(list, index);
      expect(offset).toBe(list.top(index));
      expect(after).toBeLessThan(STALL_MS);
    });
  }

  it("opens with one of the last photographs as high as it can be, wholly in view", () => {
    const list = galleryList(HEIGHTS);
    const { offset } = land(list, 148);
    expect(offset).toBeLessThan(list.top(148));
    expect(list.top(148) - offset + HEIGHTS[148]).toBeLessThanOrEqual(list.viewport);
  });

  it("opens one of the last photographs as high as it can be, however the list draws below it", () => {
    // The list put at the card, stopped at the end of what was drawn, and
    // the rest drawn below it after: where it last said it is was the end
    // then and is not now.
    for (const perScroll of [6, 8, 10, 12, 15]) {
      for (let index = 130; index < HEIGHTS.length; index++) {
        const list = galleryList(HEIGHTS, { perScroll });
        const { offset } = land(list, index);
        expect(offset, `card ${index}, ${perScroll} at a time`).toBe(Math.min(list.top(index), list.furthest()));
      }
    }
  });

  it("shows a gallery that fits on the screen at once, though the list never says where it is", () => {
    const list = galleryList([300.5, 250, 200.25], { viewport: 900 });
    const { offset, after } = land(list, 1);
    expect(offset).toBe(0);
    expect(after).toBeLessThanOrEqual(STILL_LOOKS * LANDING_STEP_MS);
  });

  it("does not open on the same card for different photographs", () => {
    const landed = [90, 110, 130].map((index) => {
      const list = galleryList(HEIGHTS);
      return land(list, index).offset;
    });
    expect(new Set(landed).size).toBe(3);
  });
});

describe("the gallery, read from the source", () => {
  const gallery = code("app/gallery.tsx");

  it("measures the tapped card within the list's content, never adds up heights to scroll to", () => {
    expect(gallery).toMatch(/ref=\{item\.id === postId \? tapped : undefined\}/);
    expect(gallery).toMatch(/measureTop\(tapped\.current, contentOf\(list\.current\), answer\)/);
    expect(gallery).toMatch(/card\.measureLayout\(content, \(_x, y\) => then\(y\), \(\) => then\(null\)\)/);
    // The phone measures a view only from one that holds it: the content, not a mark beside the cards.
    expect(gallery).toMatch(/getNativeScrollRef\(\) as \{ getInnerViewRef\?: \(\) => View \| null \}/);
    expect(gallery).toMatch(/return scroller\?\.getInnerViewRef\?\.\(\) \?\? null;/);
    expect(gallery).not.toMatch(/ListHeaderComponent/);
    expect(gallery).not.toMatch(/\bsettle\b|measuredSum|typical/);
  });

  it("takes each step from the landing, with where the list says it is", () => {
    expect(gallery).toMatch(
      /nextLanding\(landing, \{\s*index: startIndex,\s*top,\s*scrolled: at,\s*end,\s*measured: heights\.current\.size,\s*now: Date\.now\(\),\s*\}\)/,
    );
    expect(gallery).toMatch(/const at = scrolled\.current;/);
    expect(gallery).toMatch(/scrolled\.current = e\.nativeEvent\.contentOffset\.y;/);
    expect(gallery).toMatch(/onScroll=\{onScroll\}/);
    expect(gallery).toMatch(/scrollTo\(approachOffset\(posts\.slice\(0, startIndex\)\.map\(\(p\) => heights\.current\.get\(p\.id\)\), LIST_PADDING\)\);/);
    expect(gallery).toMatch(/\} else if \(step\.kind === "place"\) \{\s*scrollTo\(step\.offset\);/);
  });

  it("reads the end from the list as it is at each look, not from when it last moved", () => {
    expect(gallery).toMatch(
      /const end =\s*atListEnd\(at, viewport\.current, content\.current\) &&\s*posts\.slice\(startIndex \+ 1\)\.every\(\(p\) => heights\.current\.has\(p\.id\)\);/,
    );
    // Its height on screen and its content's, as each last reported them.
    expect(gallery).toMatch(/viewport\.current = e\.nativeEvent\.layout\.height;/);
    expect(gallery).toMatch(/const onContentSizeChange = useCallback\(\(_width: number, height: number\) => \{\s*content\.current = height;/);
    expect(gallery).toMatch(/onLayout=\{onListLayout\}\s*onContentSizeChange=\{onContentSizeChange\}/);
    // Not the end as a scroll event once said it.
    expect(gallery).not.toMatch(/contentSize\.height|layoutMeasurement/);
  });

  it("shows nothing until it has landed, and then in the frame after", () => {
    expect(gallery).toMatch(/style=\{ready \? undefined : styles\.hidden\}/);
    // Nor can it be tapped while hidden: the browser hit-tests a clear view.
    expect(gallery).toMatch(/hidden: \{ opacity: 0, pointerEvents: "none" \},/);
    expect(gallery).toMatch(/if \(step\.offset != null\) scrollTo\(step\.offset\);\s*requestAnimationFrame\(\(\) => setReady\(true\)\);/);
    expect(gallery).toMatch(/\{!ready && !loading && posts\.length > 0 \? \(\s*<View style=\{styles\.curtain\} pointerEvents="none">/);
  });

  it("goes on looking when a measure goes unanswered", () => {
    expect(gallery).toMatch(/timer = setTimeout\(\(\) => answer\(null\), LANDING_STEP_MS\);\s*measureTop\(/);
  });

  it("lands again whenever the photograph or the order changes", () => {
    expect(gallery).toMatch(/\}, \[posts, startIndex, postId, sort, era\]\);/);
  });
});

describe("the skeleton's breathing", () => {
  const skeleton = code("src/components/Skeleton.tsx");

  it("is not an interaction, so a list behind it can go on drawing", () => {
    expect(skeleton).toMatch(/const BREATH = \{[^}]*useNativeDriver: true, isInteraction: false \};/);
    expect(skeleton.match(/Animated\.timing\(pulse, \{ toValue: [\d.]+, \.\.\.BREATH \}\)/g)).toHaveLength(2);
  });
});
