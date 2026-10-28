import { describe, expect, it } from "vitest";
import { WARM_AHEAD, WARM_BEHIND, isWarm, videoFocus, warmWindow, type WarmWindow } from "@/utils/videoWindow";

/**
 * Which of the gallery's clips have a player: the tapped one alone while
 * the gallery measures its way there, then the card on screen and one
 * either side. Every other card is its poster.
 */

const warmIndexes = (w: WarmWindow, count: number) => Array.from({ length: count }, (_, i) => i).filter((i) => isWarm(i, w));

/** The gallery's measure cap (MEASURE_LIMIT in app/gallery.tsx): a first render draws at most this many cards. */
const MEASURE_LIMIT = 80;

describe("the gallery's warm clips", () => {
  it("start one either side, because the stored clips are heavy", () => {
    expect(WARM_BEHIND).toBe(1);
    expect(WARM_AHEAD).toBe(1);
  });

  it("are the tapped clip alone while the gallery is still measuring", () => {
    const w = warmWindow({ ready: false, startIndex: 20, seenIndex: null, count: 60 });
    expect(warmIndexes(w, 60)).toEqual([20]);
  });

  it("ignore what was reported on screen before the gallery was showing", () => {
    // Hidden at the top while it measures, the list can report its first card.
    const w = warmWindow({ ready: false, startIndex: 20, seenIndex: 0, count: 60 });
    expect(warmIndexes(w, 60)).toEqual([20]);
  });

  it("are the tapped card and its neighbours once the gallery is showing", () => {
    const w = warmWindow({ ready: true, startIndex: 20, seenIndex: null, count: 60 });
    expect(warmIndexes(w, 60)).toEqual([19, 20, 21]);
  });

  it("follow the card on screen", () => {
    const w = warmWindow({ ready: true, startIndex: 20, seenIndex: 24, count: 60 });
    expect(warmIndexes(w, 60)).toEqual([23, 24, 25]);
  });

  it("keep the last card seen when nothing is on screen between two", () => {
    // The gallery passes the last card reported on screen; a null report
    // does not clear it, so the window stays put rather than emptying.
    expect(videoFocus({ ready: true, startIndex: 20, seenIndex: 24 })).toBe(24);
    expect(videoFocus({ ready: true, startIndex: 20, seenIndex: null })).toBe(20);
  });

  it("stop at the ends of the list", () => {
    expect(warmIndexes(warmWindow({ ready: true, startIndex: 0, seenIndex: null, count: 10 }), 10)).toEqual([0, 1]);
    expect(warmIndexes(warmWindow({ ready: true, startIndex: 9, seenIndex: 9, count: 10 }), 10)).toEqual([8, 9]);
    expect(warmIndexes(warmWindow({ ready: true, startIndex: 0, seenIndex: null, count: 1 }), 1)).toEqual([0]);
  });

  it("are none for an empty list", () => {
    const w = warmWindow({ ready: false, startIndex: 0, seenIndex: null, count: 0 });
    expect(w.last).toBeLessThan(w.first);
    expect(isWarm(0, w)).toBe(false);
  });

  it("fall back to the top when the tapped photograph is not in the list, as the landing does", () => {
    // startIndex is 0 when the post id was not found.
    expect(warmIndexes(warmWindow({ ready: false, startIndex: 0, seenIndex: null, count: 5 }), 5)).toEqual([0]);
  });

  it("give none of the cards drawn to measure a player on a deep tap", () => {
    // Past the measure cap the tapped card is not in the first render at
    // all: it is drawn, and makes its player, once the list is in place.
    const count = 133;
    const before = warmWindow({ ready: false, startIndex: 114, seenIndex: null, count });
    for (let i = 0; i < MEASURE_LIMIT; i++) expect(isWarm(i, before)).toBe(false);
    expect(warmIndexes(before, count)).toEqual([114]);
    const after = warmWindow({ ready: true, startIndex: 114, seenIndex: null, count });
    expect(warmIndexes(after, count)).toEqual([113, 114, 115]);
  });

  it("never hold more than three players, however long the history", () => {
    for (const startIndex of [0, 5, 35, 77, 79, 93, 101, 114, 132]) {
      for (const seenIndex of [null, 0, startIndex, 132]) {
        expect(warmIndexes(warmWindow({ ready: true, startIndex, seenIndex, count: 133 }), 133).length).toBeLessThanOrEqual(3);
      }
    }
  });
});
