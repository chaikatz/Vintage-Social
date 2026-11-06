import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THUMB_LONG_MAX, THUMB_LONG_UNKNOWN, THUMB_SHORT, thumbLongSide } from "@/uploads/thumbSize";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

/** What the preparer makes for a long side asked: never enlarged (src/media/nativeMedia.ts `fit`, VintageLibraryModule.swift). */
function made(width: number, height: number, longSide: number): { width: number; height: number } {
  const scale = Math.min(1, longSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** The widest phone in points, and its scale: an iPhone Pro Max at 3x. */
const PHONE = 440;
const SCALE = 3;

describe("a photograph's thumbnail", () => {
  it("has its short side at 540, whatever the photograph's shape", () => {
    expect(THUMB_SHORT).toBe(540);
    // 3:2 and 3:4, the two shapes most posted, and the rest.
    expect(made(4032, 2688, thumbLongSide(4032, 2688))).toEqual({ width: 810, height: 540 });
    expect(made(3024, 4032, thumbLongSide(3024, 4032))).toEqual({ width: 540, height: 720 });
    expect(made(4032, 3024, thumbLongSide(4032, 3024))).toEqual({ width: 720, height: 540 });
    expect(made(3000, 3000, thumbLongSide(3000, 3000))).toEqual({ width: 540, height: 540 });
    expect(made(1920, 1080, thumbLongSide(1920, 1080))).toEqual({ width: 960, height: 540 });
    // Prepared for the feed first (1440 on the long side), then cut: the same.
    expect(made(1440, 960, thumbLongSide(1440, 960))).toEqual({ width: 810, height: 540 });
    for (let w = 600; w <= 6000; w += 37) {
      for (const ratio of [1, 1.25, 4 / 3, 1.5, 16 / 9, 2]) {
        const h = Math.round(w / ratio);
        const t = made(w, h, thumbLongSide(w, h));
        // Never under 540 on the short side for a photograph that has it.
        if (Math.min(w, h) >= THUMB_SHORT) expect(Math.min(t.width, t.height)).toBeGreaterThanOrEqual(THUMB_SHORT);
        expect(Math.min(t.width, t.height)).toBeLessThanOrEqual(THUMB_SHORT + 1);
      }
    }
  });

  it("never larger than the photograph, and a panorama's long side stops at twice the short", () => {
    expect(made(600, 400, thumbLongSide(600, 400))).toEqual({ width: 600, height: 400 });
    expect(thumbLongSide(6000, 2000)).toBe(THUMB_LONG_MAX);
    expect(made(6000, 2000, thumbLongSide(6000, 2000))).toEqual({ width: 1080, height: 360 });
    // A photograph whose size is not known: cut as a 3:2 would be.
    expect(thumbLongSide(null, 1000)).toBe(THUMB_LONG_UNKNOWN);
    expect(thumbLongSide(Number.NaN, Number.NaN)).toBe(810);
    expect(thumbLongSide(0, 0)).toBe(810);
  });

  it("is sharp everywhere it is shown at its own size on the widest phone at 3x", () => {
    // A photograph sent in a thread: a square, filled by the short side.
    const thread = read("app/messages/[id].tsx");
    const shared = /sharedImage: \{\s*width: (\d+),\s*height: (\d+),/.exec(thread);
    expect(shared).not.toBeNull();
    expect(Number(shared![1]) * SCALE).toBeLessThanOrEqual(THUMB_SHORT);
    // A grid square (profile, a member, Explore, Places): three across.
    expect(read("src/components/PhotoGrid.tsx")).toMatch(/const size = \(Dimensions\.get\("window"\)\.width - GRID_GAP \* 2\) \/ 3;/);
    expect(read("src/components/PhotoGrid.tsx")).toMatch(/export const GRID_GAP = 2;/);
    expect(((PHONE - 2 * 2) / 3) * SCALE).toBeLessThanOrEqual(THUMB_SHORT);
    // A Timeline frame: most of half the page, across; a portrait's short side.
    const timeline = read("src/components/Timeline.tsx");
    expect(timeline).toMatch(/const half = width \/ 2 - spacing\.lg;\s*const frame = Math\.round\(half \* 0\.86\);/);
    expect(Math.round((PHONE / 2 - 16) * 0.86) * SCALE).toBeLessThanOrEqual(THUMB_SHORT);
    // An Activity row.
    expect(read("app/(tabs)/activity.tsx")).toMatch(/thumb: \{ width: 40, height: 40,/);
  });

  it("is the only size changed in the pipeline: the feed's photograph and its quality stay as they were", () => {
    const outbox = read("src/uploads/outbox.ts");
    expect(outbox).toMatch(/const FEED_MAX = 1440;/);
    expect(outbox).toMatch(/const PHOTO_QUALITY = 0\.9;/);
    expect(outbox).toMatch(/const POSTER_QUALITY = 0\.85;/);
    expect(outbox).toMatch(/thumbSide: thumbLongSide\(d\.sourceWidth, d\.sourceHeight\),/);
    expect(outbox).toMatch(/prepareImage\(out\.uri, \{ maxSide: thumbLongSide\(out\.width, out\.height\), quality: 0\.8 \}\)/);
    expect(outbox).not.toMatch(/THUMB_SIDE/);
  });
});
