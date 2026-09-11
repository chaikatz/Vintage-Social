import { describe, expect, it } from "vitest";
import { coverUV } from "@/filters/coverFit";

/**
 * Getting this wrong is what made On This Day photographs come in warped:
 * a 3:4 portrait drawn edge to edge into a 4:5 frame is squashed, not
 * cropped. The frame should show all of the picture's width and a centred
 * band of its height — or the reverse for a landscape.
 */
describe("cover fit", () => {
  it("shows a centred band of a taller picture", () => {
    // 3:4 picture in a 4:5 frame: full width, 0.9375 of the height.
    const fit = coverUV(3000, 4000, 800, 1000);
    expect(fit.scale[0]).toBe(1);
    expect(fit.scale[1]).toBeCloseTo(0.9375, 5);
    expect(fit.offset[0]).toBe(0);
    expect(fit.offset[1]).toBeCloseTo((1 - 0.9375) / 2, 5);
  });

  it("shows a centred band of a wider picture", () => {
    // 16:9 picture in a square frame: full height, 9/16 of the width.
    const fit = coverUV(1920, 1080, 500, 500);
    expect(fit.scale[1]).toBe(1);
    expect(fit.scale[0]).toBeCloseTo(9 / 16, 5);
    expect(fit.offset[0]).toBeCloseTo((1 - 9 / 16) / 2, 5);
  });

  it("passes a picture that already matches straight through", () => {
    expect(coverUV(1600, 2000, 800, 1000)).toEqual({ scale: [1, 1], offset: [0, 0] });
  });

  it("assumes a match when the size is unknown, rather than guessing", () => {
    expect(coverUV(null, null, 800, 1000)).toEqual({ scale: [1, 1], offset: [0, 0] });
    expect(coverUV(0, 0, 800, 1000)).toEqual({ scale: [1, 1], offset: [0, 0] });
  });

  it("always covers: nothing of the frame is left unfilled", () => {
    for (const [w, h] of [[1, 3], [3, 1], [4, 5], [9, 16], [2, 1]]) {
      const fit = coverUV(w, h, 4, 5);
      expect(fit.scale[0]).toBeLessThanOrEqual(1);
      expect(fit.scale[1]).toBeLessThanOrEqual(1);
      expect(Math.max(fit.scale[0], fit.scale[1])).toBe(1);
      expect(fit.offset[0] + fit.scale[0]).toBeLessThanOrEqual(1 + 1e-9);
      expect(fit.offset[1] + fit.scale[1]).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
