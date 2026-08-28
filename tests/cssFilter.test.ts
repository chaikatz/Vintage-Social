import { describe, expect, it } from "vitest";
import { cssFilterFor } from "@/filters/cssFilter";
import { FILTERS, getFilter } from "@/filters/presets";

describe("web CSS filter approximation", () => {
  it("produces a filter string for every preset", () => {
    for (const f of FILTERS) {
      const web = cssFilterFor(f);
      expect(web.filter.length).toBeGreaterThan(0);
    }
  });

  it("archive-bw becomes grayscale", () => {
    const web = cssFilterFor(getFilter("archive-bw"));
    expect(web.filter).toContain("grayscale(1)");
    expect(web.filter).not.toContain("sepia");
  });

  it("warm filters get a sepia pass, cool filters get a tint overlay", () => {
    const warm = cssFilterFor(getFilter("seventy"));
    expect(warm.filter).toContain("sepia(");
    expect(warm.tintOverlay).toBeNull();

    const cool = cssFilterFor(getFilter("alpine"));
    expect(cool.filter).not.toContain("sepia");
    expect(cool.tintOverlay).toMatch(/^rgba\(/);
  });

  it("fade maps to a paper-colored overlay", () => {
    const faded = cssFilterFor(getFilter("instant")); // fade 0.45
    expect(faded.fadeOverlay).toMatch(/^rgba\(/);
    // Instant's fade color is warm paper: red channel ≥ blue channel.
    const [r, , b] = faded.fadeOverlay!.match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThanOrEqual(b);
  });

  it("vignette maps to an inset box-shadow scaled by strength", () => {
    const strong = cssFilterFor(getFilter("ninety-eight")); // vignette 0.42
    const gentle = cssFilterFor(getFilter("riviera")); // vignette 0.1
    expect(strong.vignetteBoxShadow).toContain("inset");
    const radius = (s: string) => Number(s.match(/inset 0 0 (\d+)px/)![1]);
    expect(radius(strong.vignetteBoxShadow!)).toBeGreaterThan(radius(gentle.vignetteBoxShadow!));
  });
});
