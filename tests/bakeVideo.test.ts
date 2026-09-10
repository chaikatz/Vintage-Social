import { describe, expect, it, vi } from "vitest";

// No native module under node: the point here is what the JS asks it for.
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));

const { BAKED_VIDEO_MAX, bakeOptionsFor, bakeVideo, canBakeVideo } = await import("@/filters/bakeVideo");
const { FILTERS } = await import("@/filters/presets");
const { buildColorMatrix } = await import("@/filters/colorMatrix");

describe("baking a filter into video", () => {
  it("hands the native side exactly the shader's numbers", () => {
    const film = FILTERS.find((f) => f.id === "seventy")!;
    const options = bakeOptionsFor(film);
    expect(options.matrix).toEqual(buildColorMatrix(film.adjustments, film.monochrome));
    expect(options.matrix).toHaveLength(20);
    expect(options.fade).toBe(film.artifacts.fade);
    expect(options.fadeColor).toEqual([...film.artifacts.fadeColor]);
    expect(options.vignette).toBe(film.artifacts.vignette);
    expect(options.grain).toBe(film.artifacts.grain);
    expect(options.maxDimension).toBe(BAKED_VIDEO_MAX);
  });

  it("desaturates for the monochrome film, the way the still bake does", () => {
    const archive = FILTERS.find((f) => f.id === "archive-bw")!;
    const m = bakeOptionsFor(archive).matrix;
    // Every output channel reads the same luma mix of the input — no colour survives.
    for (const row of [0, 5, 10]) {
      expect(m[row] / m[row + 1]).toBeCloseTo(0.299 / 0.587, 5);
      expect(m[row + 2] / m[row + 1]).toBeCloseTo(0.114 / 0.587, 5);
    }
  });

  it("reports honestly when the build cannot bake, and refuses rather than pretending", async () => {
    expect(canBakeVideo()).toBe(false);
    await expect(bakeVideo("file:///clip.mov", FILTERS[0])).rejects.toThrow(/not available/);
  });
});
