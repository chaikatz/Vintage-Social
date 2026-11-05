import { describe, expect, it } from "vitest";
import { PICTURES_AHEAD, PICTURES_BEHIND, pictureWindow } from "@/media/cardWindow";
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
