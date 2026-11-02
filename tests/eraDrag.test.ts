import { describe, expect, it } from "vitest";
import {
  EDGE,
  EDGE_SPEED,
  LIFT_MS,
  LIFT_SCALE,
  STEP_MS,
  barInView,
  chapterUnder,
  dropLabel,
  dropTarget,
  edgeSpeed,
  eraUnderFinger,
  scrolledTo,
  type ChapterBox,
  type DragPage,
} from "@/components/eraDrag";

/**
 * Dragging a print to another era: which era is under the finger, and how
 * fast the page runs on near its edges. The component that uses them is
 * guarded in era-editing.test.ts, and walked in the launch test.
 */

// Three chapters one under the next, below a header and the bar, as EraList lays them out.
const chapters: ChapterBox[] = [
  { key: "Lisbon 2023", top: 400, height: 600 },
  { key: "Summer 2022", top: 1000, height: 300 },
  { key: "~made000001", top: 1300, height: 500 },
];
// The bar lies just above the first chapter, 100 tall.
const bar = { top: 300, height: 100 };
const page = (offset: number, over: Partial<DragPage> = {}): DragPage => ({ chapters, bar, offset, height: 700, ...over });

describe("the lift", () => {
  it("is a beat past a tap, and a little larger", () => {
    expect(LIFT_MS).toBe(250);
    expect(LIFT_SCALE).toBeGreaterThan(1);
    expect(LIFT_SCALE).toBeLessThan(1.1);
  });
});

describe("chapterUnder", () => {
  it("finds the chapter holding a place on the page, its top in and its foot out", () => {
    expect(chapterUnder(chapters, 400)).toBe("Lisbon 2023");
    expect(chapterUnder(chapters, 999.5)).toBe("Lisbon 2023");
    expect(chapterUnder(chapters, 1000)).toBe("Summer 2022");
    expect(chapterUnder(chapters, 1799)).toBe("~made000001");
  });

  it("finds none above the first, below the last, or in a gap between", () => {
    expect(chapterUnder(chapters, 399)).toBeNull();
    expect(chapterUnder(chapters, 1800)).toBeNull();
    expect(chapterUnder([chapters[0], { key: "later", top: 1100, height: 100 }], 1050)).toBeNull();
    expect(chapterUnder([], 500)).toBeNull();
  });
});

describe("barInView", () => {
  it("is in its place on the page until the page scrolls past it, then held to the top", () => {
    expect(barInView(bar, 0)).toEqual({ top: 300, bottom: 400 });
    expect(barInView(bar, 120)).toEqual({ top: 180, bottom: 280 });
    expect(barInView(bar, 300)).toEqual({ top: 0, bottom: 100 });
    expect(barInView(bar, 2000)).toEqual({ top: 0, bottom: 100 });
  });
});

describe("eraUnderFinger", () => {
  it("reads the finger's place in the view as a place on the page, by how far it is scrolled", () => {
    // At the top: the finger 450 down the view is 450 down the page.
    expect(eraUnderFinger(page(0), 450)).toBe("Lisbon 2023");
    // Scrolled 700: the same finger is 1150 down the page.
    expect(eraUnderFinger(page(700), 450)).toBe("Summer 2022");
    expect(eraUnderFinger(page(700), 650)).toBe("~made000001");
  });

  it("finds none over the bar, which hides the chapter under it, held to the top or not", () => {
    // Scrolled 700, the bar is held over the first 100 of the view, where Lisbon 2023 runs on beneath it.
    expect(eraUnderFinger(page(700), 50)).toBeNull();
    expect(eraUnderFinger(page(700), 99)).toBeNull();
    expect(eraUnderFinger(page(700), 100)).toBe("Lisbon 2023");
    // At the top, the bar is in its place, under the header.
    expect(eraUnderFinger(page(0), 350)).toBeNull();
    expect(eraUnderFinger(page(0), 250)).toBeNull();
  });

  it("finds none outside the view: above it, at or below its foot, or where the finger cannot be read", () => {
    expect(eraUnderFinger(page(700), -1)).toBeNull();
    expect(eraUnderFinger(page(700), 700)).toBeNull();
    expect(eraUnderFinger(page(700), 900)).toBeNull();
    expect(eraUnderFinger(page(700), Number.NaN)).toBeNull();
  });

  it("finds only the chapters measured so far, and over no bar before it is measured", () => {
    expect(eraUnderFinger(page(0, { chapters: [] }), 450)).toBeNull();
    expect(eraUnderFinger(page(700, { bar: null }), 50)).toBe("Lisbon 2023");
  });
});

describe("dropTarget", () => {
  it("is the era under the finger, unless it is the print's own, or there is none", () => {
    expect(dropTarget("Lisbon 2023", "Summer 2022")).toBe("Summer 2022");
    expect(dropTarget("Lisbon 2023", "Lisbon 2023")).toBeNull();
    expect(dropTarget("Lisbon 2023", null)).toBeNull();
  });
});

describe("edgeSpeed", () => {
  // A view 700 tall, under a bar 100 tall.
  const view = { top: 100, bottom: 700 };

  it("is still between the edges", () => {
    expect(edgeSpeed(100 + EDGE, view)).toBe(0);
    expect(edgeSpeed(400, view)).toBe(0);
    expect(edgeSpeed(700 - EDGE, view)).toBe(0);
  });

  it("runs up near the top, under the bar, faster the deeper the finger is into the edge", () => {
    expect(edgeSpeed(100 + EDGE / 2, view)).toBeCloseTo(-EDGE_SPEED / 2);
    expect(edgeSpeed(100 + EDGE * 0.75, view)).toBeCloseTo(-EDGE_SPEED / 4);
    expect(edgeSpeed(100, view)).toBe(-EDGE_SPEED);
    // Over the bar, or above the view, at the most.
    expect(edgeSpeed(40, view)).toBe(-EDGE_SPEED);
    expect(edgeSpeed(-200, view)).toBe(-EDGE_SPEED);
  });

  it("runs down near the foot, in proportion, and at the most at the foot or past it", () => {
    expect(edgeSpeed(700 - EDGE / 2, view)).toBeCloseTo(EDGE_SPEED / 2);
    expect(edgeSpeed(700 - EDGE / 4, view)).toBeCloseTo((EDGE_SPEED * 3) / 4);
    expect(edgeSpeed(700, view)).toBe(EDGE_SPEED);
    expect(edgeSpeed(760, view)).toBe(EDGE_SPEED);
  });

  it("gives each edge half of a view too short for two", () => {
    const short = { top: 0, bottom: 100 };
    expect(edgeSpeed(50, short)).toBe(0);
    expect(edgeSpeed(25, short)).toBeCloseTo(-EDGE_SPEED / 2);
    expect(edgeSpeed(75, short)).toBeCloseTo(EDGE_SPEED / 2);
    // Never both: above the middle it only ever runs up, below it only down.
    for (let y = -10; y <= 110; y += 5) {
      if (y < 50) expect(edgeSpeed(y, short)).toBeLessThan(0);
      if (y > 50) expect(edgeSpeed(y, short)).toBeGreaterThan(0);
    }
  });

  it("takes its edge and its speed as given", () => {
    expect(edgeSpeed(150, view, 100, 1000)).toBeCloseTo(-500);
    expect(edgeSpeed(650, view, 100, 1000)).toBeCloseTo(500);
  });
});

describe("scrolledTo", () => {
  it("runs on at the speed for the time, a frame at a time", () => {
    expect(scrolledTo(500, 1000, 16, 2000)).toBeCloseTo(516);
    expect(scrolledTo(500, -1000, 16, 2000)).toBeCloseTo(484);
    expect(scrolledTo(500, 0, 16, 2000)).toBe(500);
  });

  it("takes no more than STEP_MS at once, so a slow frame never throws the page on", () => {
    expect(scrolledTo(500, 1000, 400, 2000)).toBeCloseTo(500 + STEP_MS);
    expect(scrolledTo(500, 1000, -16, 2000)).toBe(500);
  });

  it("stops at the top and at the foot", () => {
    expect(scrolledTo(10, -1000, 48, 2000)).toBe(0);
    expect(scrolledTo(0, -1000, 16, 2000)).toBe(0);
    expect(scrolledTo(1990, 1000, 48, 2000)).toBe(2000);
    expect(scrolledTo(2000, 1000, 16, 2000)).toBe(2000);
    // A page shorter than its view scrolls nowhere.
    expect(scrolledTo(0, 1000, 16, -120)).toBe(0);
  });

  it("never pulls the page back from past an end, so a page just grown shorter does not jump", () => {
    expect(scrolledTo(2100, 1000, 16, 2000)).toBe(2100);
    expect(scrolledTo(-20, -1000, 16, 2000)).toBe(-20);
    // Running the other way from there, it moves as it would.
    expect(scrolledTo(2100, -1000, 16, 2000)).toBeCloseTo(2084);
  });
});

describe("the words", () => {
  it("name where the print would go, as the sheet heads it", () => {
    expect(dropLabel("Lisbon 2023")).toBe("Move to Lisbon 2023");
  });
});
