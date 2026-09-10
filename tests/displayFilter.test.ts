import { describe, expect, it } from "vitest";
import { needsDisplayFilter } from "@/utils/displayFilter";
import { DEMO_PREFIX } from "@/demo/photos";

/**
 * Getting this wrong is invisible in one direction and ugly in the other:
 * miss a case and a photograph claims a film stock it isn't wearing; match
 * one too many and the filter is applied twice.
 */
describe("which media still needs filtering on screen", () => {
  it("leaves a real upload alone — it was baked at compose time", () => {
    expect(
      needsDisplayFilter({
        media_type: "photo",
        media_path: "2bfbe266-9e1d-40b7-bafa-186377062ad9/a1b2c3.jpg",
      }),
    ).toBe(false);
  });

  it("filters video that was uploaded as recorded", () => {
    expect(
      needsDisplayFilter({ media_type: "video", media_path: "uid/clip.mp4", filter_baked: false }),
    ).toBe(true);
    // Every clip from before the column existed reads as unbaked.
    expect(needsDisplayFilter({ media_type: "video", media_path: "uid/clip.mov" })).toBe(true);
  });

  it("plays a baked video as it is — the film is already in the file", () => {
    expect(
      needsDisplayFilter({ media_type: "video", media_path: "uid/clip.mp4", filter_baked: true }),
    ).toBe(false);
  });

  it("filters the bundled demo library", () => {
    expect(
      needsDisplayFilter({ media_type: "photo", media_path: `${DEMO_PREFIX}dunes` }),
    ).toBe(true);
  });

  it("filters a house photograph referenced by url", () => {
    expect(
      needsDisplayFilter({
        media_type: "photo",
        media_path: "https://thumb.wikimedia.org/wikipedia/commons/thumb/x/y.jpg",
      }),
    ).toBe(true);
  });

  it("does not double-filter a photograph baked in demo mode", () => {
    // Demo mode keeps the baked file locally: file: on a device, blob: in a
    // browser. Both are already filtered.
    expect(
      needsDisplayFilter({ media_type: "photo", media_path: "file:///var/tmp/baked.jpg" }),
    ).toBe(false);
    expect(
      needsDisplayFilter({ media_type: "photo", media_path: "blob:http://localhost/abc" }),
    ).toBe(false);
  });
});
