import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PICTURE_WIDTH, THUMB_WIDTH, WIKIMEDIA_WIDTHS, commonsAt } from "../seed/wikimediaThumb.mjs";

/**
 * A regenerated seed keeps the house photographs' grid squares at a width
 * Wikimedia serves. seed/curate.mjs asked for 1400-pixel pictures and
 * rewrote "/1400px-" to "/480px-" for the square; Commons answers 1400
 * with its 1920 rendering and refuses 480, so the rewrite never matched
 * and the square was the full picture (repaired on production by 0034).
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const at = commonsAt as (url: string, width: number, originalWidth?: number) => string;

describe("Wikimedia's widths", () => {
  it("are the standard ones, and the seed asks only for those", () => {
    expect(WIKIMEDIA_WIDTHS).toEqual([20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840]);
    expect(WIKIMEDIA_WIDTHS).toContain(PICTURE_WIDTH);
    expect(WIKIMEDIA_WIDTHS).toContain(THUMB_WIDTH);
    // 0034 chose 500 for the squares on production; a regenerated seed agrees with it.
    expect(read("supabase/migrations/0034_seed_thumbnails_at_a_standard_width.sql")).toContain("/500px-");
    expect(THUMB_WIDTH).toBe(500);
    for (const refused of [400, 480, 501, 640, 800, 1024, 1400]) {
      expect(() => at("https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b5/A.jpg/1920px-A.jpg", refused)).toThrow(/no \d+px thumbnail/);
    }
  });
});

describe("a house photograph's grid square", () => {
  it("from Commons' rendering: the same file at 500", () => {
    expect(at("https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b5/Children_at_Kosciusko_pool.jpg/1920px-Children_at_Kosciusko_pool.jpg", 500, 4000)).toBe(
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b5/Children_at_Kosciusko_pool.jpg/500px-Children_at_Kosciusko_pool.jpg",
    );
  });

  it("from an original JPEG or PNG wider than 500: its thumbnail address, as 0034 wrote it", () => {
    expect(at("https://upload.wikimedia.org/wikipedia/commons/1/1b/RR3112_Swimming_a.jpg", 500, 1400)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/RR3112_Swimming_a.jpg/500px-RR3112_Swimming_a.jpg",
    );
    expect(at("https://upload.wikimedia.org/wikipedia/commons/a/ab/Pier.PNG", 500, 1600)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Pier.PNG/500px-Pier.PNG",
    );
  });

  it("left as it is where Commons would not render one: an original no wider, or a format it renames", () => {
    expect(at("https://upload.wikimedia.org/wikipedia/commons/1/1b/Small.jpg", 500, 480)).toBe("https://upload.wikimedia.org/wikipedia/commons/1/1b/Small.jpg");
    expect(at("https://upload.wikimedia.org/wikipedia/commons/1/1b/Moving.webp", 500, 1400)).toBe("https://upload.wikimedia.org/wikipedia/commons/1/1b/Moving.webp");
    expect(at("https://picsum.photos/id/764/1200/900", 500)).toBe("https://picsum.photos/id/764/1200/900");
  });

  it("for every Commons photograph the seed holds, at 500 or the file itself, never 480", () => {
    const { photos } = JSON.parse(read("seed/photos.json")) as { photos: { url: string; width: number }[] };
    const commons = photos.filter((p) => /wikimedia\.org/.test(p.url));
    expect(commons.length).toBeGreaterThan(1000);
    const squares = commons.map((p) => at(p.url, THUMB_WIDTH, p.width));
    for (const s of squares) expect(s).not.toMatch(/\/(480|1400)px-/);
    // All but the handful of WebP and GIF originals get a square of their own.
    expect(squares.filter((s, i) => s !== commons[i].url).length).toBeGreaterThan(commons.length - 10);
    for (const s of squares.filter((s, i) => s !== commons[i].url)) expect(s).toMatch(/\/500px-[^/]+$/);
  });
});

describe("seed/curate.mjs", () => {
  const src = read("seed/curate.mjs").replace(/\/\/.*$/gm, "");

  it("asks Commons for a width it serves, and makes the square with the helper", () => {
    expect(src).toContain("&iiurlwidth=${PICTURE_WIDTH}`");
    expect(src).toContain("thumb: commonsAt(clean(info.thumburl ?? info.url), THUMB_WIDTH, info.width),");
    expect(src).not.toMatch(/iiurlwidth=1400|\/1400px-|\/480px-/);
    expect(src).toContain('import { PICTURE_WIDTH, THUMB_WIDTH, commonsAt } from "./wikimediaThumb.mjs";');
  });
});
