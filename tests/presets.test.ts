import { describe, expect, it } from "vitest";
import { FILTERS, filterSupportsDateStamp, getFilter } from "@/filters/presets";
import { applyMatrix, buildColorMatrix } from "@/filters/colorMatrix";

describe("VINTAGE filter presets", () => {
  it("ships exactly eight filters", () => {
    expect(FILTERS).toHaveLength(8);
  });

  it("has unique, stable ids", () => {
    const ids = FILTERS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Ids are stored on posts — renaming any of these is a breaking change.
    expect(ids).toEqual([
      "archive-bw",
      "seventy",
      "alpine",
      "riviera",
      "ninety-eight",
      "instant",
      "chrome-64",
      "neutral-aged",
    ]);
  });

  it("keeps every parameter inside its documented range", () => {
    for (const f of FILTERS) {
      expect(f.adjustments.brightness).toBeGreaterThanOrEqual(-1);
      expect(f.adjustments.brightness).toBeLessThanOrEqual(1);
      expect(f.adjustments.contrast).toBeGreaterThanOrEqual(0);
      expect(f.adjustments.contrast).toBeLessThanOrEqual(2);
      expect(f.adjustments.saturation).toBeGreaterThanOrEqual(0);
      expect(f.adjustments.saturation).toBeLessThanOrEqual(2);
      expect(Math.abs(f.adjustments.temperature)).toBeLessThanOrEqual(1);
      expect(Math.abs(f.adjustments.tint)).toBeLessThanOrEqual(1);
      expect(f.artifacts.fade).toBeGreaterThanOrEqual(0);
      expect(f.artifacts.fade).toBeLessThanOrEqual(1);
      expect(f.artifacts.vignette).toBeGreaterThanOrEqual(0);
      expect(f.artifacts.vignette).toBeLessThanOrEqual(1);
      expect(f.artifacts.grain).toBeGreaterThanOrEqual(0);
      expect(f.artifacts.grain).toBeLessThanOrEqual(1);
      f.artifacts.fadeColor.forEach((c) => {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      });
    }
  });

  it("archive-bw fully desaturates", () => {
    const spec = getFilter("archive-bw");
    const m = buildColorMatrix(spec.adjustments, spec.monochrome);
    const [r, g, b] = applyMatrix(m, [0.8, 0.2, 0.4, 1]);
    // Channels may be toned slightly, but must be near-equal (monochrome).
    expect(Math.abs(r - g)).toBeLessThan(0.03);
    expect(Math.abs(g - b)).toBeLessThan(0.03);
  });

  it("warm filters actually warm the image", () => {
    for (const id of ["seventy", "riviera"]) {
      const spec = getFilter(id);
      const m = buildColorMatrix(spec.adjustments, spec.monochrome);
      const [r, , b] = applyMatrix(m, [0.5, 0.5, 0.5, 1]);
      expect(r).toBeGreaterThan(b);
    }
  });

  it("alpine cools the image", () => {
    const spec = getFilter("alpine");
    const m = buildColorMatrix(spec.adjustments, spec.monochrome);
    const [r, , b] = applyMatrix(m, [0.5, 0.5, 0.5, 1]);
    expect(b).toBeGreaterThan(r);
  });

  it("date stamps only exist on filters that declare them", () => {
    expect(filterSupportsDateStamp("riviera")).toBe(true);
    expect(filterSupportsDateStamp("ninety-eight")).toBe(true);
    expect(filterSupportsDateStamp("instant")).toBe(false);
    expect(filterSupportsDateStamp("alpine")).toBe(false);
  });

  it("falls back to the neutral filter for unknown ids", () => {
    expect(getFilter("does-not-exist").id).toBe("neutral-aged");
  });
});
