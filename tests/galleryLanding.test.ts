import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GIVE_UP_MS,
  LANDING_STEP_MS,
  STALL_MS,
  STILL_LOOKS,
  approachOffset,
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

describe("when the landing gives up", () => {
  it("does not while the list is still drawing its way down", () => {
    let landing = startLanding(0);
    for (let now = 0, measured = 80; now < STALL_MS * 3; now += LANDING_STEP_MS, measured += 1) {
      const next = nextLanding(landing, look({ index: 140, top: null, measured, now }));
      expect(next.step.kind).toBe("approach");
      landing = next.landing;
    }
  });

  it("shows the top, not wherever the list was left, when nothing more is drawn and the card never was", () => {
    let landing = startLanding(0);
    let step = nextLanding(landing, look({ top: null, measured: 80 })).step;
    for (let now = 0; step.kind === "approach"; now += LANDING_STEP_MS) {
      const next = nextLanding(landing, look({ top: null, measured: 80, now }));
      landing = next.landing;
      step = next.step;
      expect(now).toBeLessThanOrEqual(STALL_MS);
    }
    expect(step).toEqual({ kind: "show", offset: 0 });
  });

  it("shows where the card was last seen, if it was", () => {
    let landing = nextLanding(startLanding(0), look({ top: 6000, measured: 80 })).landing;
    const next = nextLanding(landing, look({ top: null, measured: 80, now: STALL_MS }));
    landing = next.landing;
    expect(next.step).toEqual({ kind: "show", offset: 6000 });
  });

  it("puts the list at the card before it shows, when it is late and the card has moved", () => {
    const landing = nextLanding(startLanding(0), look({ top: 6000, measured: 80 })).landing;
    expect(nextLanding(landing, look({ top: 6400, measured: 80, now: GIVE_UP_MS })).step).toEqual({ kind: "show", offset: 6400 });
  });

  it("shows by the cap however it is going", () => {
    let landing = startLanding(0);
    let shown = false;
    for (let now = 0, measured = 1; now <= GIVE_UP_MS; now += LANDING_STEP_MS, measured++) {
      const next = nextLanding(landing, look({ top: null, measured, now }));
      landing = next.landing;
      if (next.step.kind === "show") shown = true;
    }
    expect(shown).toBe(true);
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
 * is drawn draws the next few, as the list does when it is scrolled.
 */
function galleryList(heights: number[], { drawnAtOnce = 80, perScroll = 10, viewport = 760 } = {}) {
  let drawn = Math.min(drawnAtOnce, heights.length);
  let offset = 0;
  let said: number | null = null;
  const top = (i: number) => PADDING + heights.slice(0, i).reduce((a, b) => a + b, 0);
  const length = () => top(drawn) + (drawn === heights.length ? PADDING : 0);
  const atEnd = () => offset + viewport >= length() - 1;
  return {
    top,
    viewport,
    get offset() {
      return offset;
    },
    scrollTo(y: number) {
      const next = Math.min(Math.max(0, y), Math.max(0, length() - viewport));
      if (next !== offset) said = offset = next;
      if (atEnd()) drawn = Math.min(heights.length, drawn + perScroll);
    },
    look(index: number, now: number): Look {
      return {
        index,
        top: index < drawn ? top(index) : null,
        scrolled: said,
        end: said != null && atEnd() && drawn === heights.length,
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
      /nextLanding\(landing, \{\s*index: startIndex,\s*top,\s*scrolled: at\?\.offset \?\? null,\s*end,\s*measured: heights\.current\.size,\s*now: Date\.now\(\),\s*\}\)/,
    );
    expect(gallery).toMatch(/const end = Boolean\(at\?\.end\) && posts\.slice\(startIndex \+ 1\)\.every\(\(p\) => heights\.current\.has\(p\.id\)\);/);
    expect(gallery).toMatch(/end: contentOffset\.y \+ layoutMeasurement\.height >= contentSize\.height - 1,/);
    expect(gallery).toMatch(/onScroll=\{onScroll\}/);
    expect(gallery).toMatch(/scrollTo\(approachOffset\(posts\.slice\(0, startIndex\)\.map\(\(p\) => heights\.current\.get\(p\.id\)\), LIST_PADDING\)\);/);
    expect(gallery).toMatch(/\} else if \(step\.kind === "place"\) \{\s*scrollTo\(step\.offset\);/);
  });

  it("shows nothing until it has landed, and then in the frame after", () => {
    expect(gallery).toMatch(/style=\{ready \? undefined : styles\.hidden\}/);
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
