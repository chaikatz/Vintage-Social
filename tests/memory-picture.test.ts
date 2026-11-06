import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHARP_MEMORIES, memoryPicture } from "@/utils/memoryPicture";
import { THUMB_SHORT } from "@/uploads/thumbSize";

/**
 * On this day draws each memory the width of the page. It drew them from
 * the grid's thumbnail, 540 px on its short side, across 1,170 to 1,320 px
 * of a 3x phone: soft whatever the photograph. Now from the photograph,
 * with the thumbnail standing in while it arrives.
 */

const url = (bucket: "media" | "thumbnails", p: string | null) => (p ? `https://cdn/${bucket}/${p}` : null);
const photo = { media_type: "photo" as const, media_path: "u/p.jpg", thumb_path: "u/p_t.jpg" };

describe("a memory's picture", () => {
  it("is the photograph itself, with its thumbnail standing in", () => {
    expect(memoryPicture(photo, 0, url)).toEqual({ source: "https://cdn/media/u/p.jpg", placeholder: "https://cdn/thumbnails/u/p_t.jpg" });
    // The thumbnail alone was too small for the page: its short side against a 3x phone's width.
    expect(THUMB_SHORT).toBeLessThan(1170);
  });

  it("is the photograph alone when there is no thumbnail to stand in", () => {
    expect(memoryPicture({ ...photo, thumb_path: null }, 0, url)).toEqual({ source: "https://cdn/media/u/p.jpg", placeholder: null });
  });

  it("is a film's poster frame, never its movie, with nothing standing in", () => {
    const film = { media_type: "video" as const, media_path: "u/v.mp4", thumb_path: "u/v_t.jpg" };
    expect(memoryPicture(film, 0, url)).toEqual({ source: "https://cdn/thumbnails/u/v_t.jpg", placeholder: null });
    // A film without a poster frame draws nothing rather than a movie an image cannot draw.
    expect(memoryPicture({ ...film, thumb_path: null }, 0, url)).toEqual({ source: null, placeholder: null });
  });

  it("asks for the photograph for the first few memories of the day only, which is every day anyone has now", () => {
    // The most any member has from one day on production is 6.
    expect(SHARP_MEMORIES).toBe(6);
    for (let i = 0; i < SHARP_MEMORIES; i += 1) expect(memoryPicture(photo, i, url).source).toBe("https://cdn/media/u/p.jpg");
    // After them, the thumbnail, as every memory was drawn before: a day of fifty costs six photographs more, not fifty.
    expect(memoryPicture(photo, SHARP_MEMORIES, url)).toEqual({ source: "https://cdn/thumbnails/u/p_t.jpg", placeholder: null });
    expect(memoryPicture({ ...photo, thumb_path: null }, 49, url)).toEqual({ source: "https://cdn/media/u/p.jpg", placeholder: null });
  });

  it("keeps demo photographs, which are bundled module ids, as they are", () => {
    const demo = (bucket: "media" | "thumbnails", p: string | null) => (p ? (bucket === "media" ? 101 : 102) : null);
    expect(memoryPicture(photo, 0, demo)).toEqual({ source: 101, placeholder: 102 });
    // The same picture for both is drawn once, not stood in for by itself.
    expect(memoryPicture(photo, 0, () => 7)).toEqual({ source: 7, placeholder: null });
  });
});

/** The source without its comments, so a guard reads what runs. */
function code(file: string): string {
  return readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("On this day's memories", () => {
  const page = code("app/memories.tsx");
  const head = page.slice(page.indexOf("{memories.map("), page.indexOf("{showLibrary ? ("));

  it("draw each memory's picture as memoryPicture gives it, by its place on the page", () => {
    expect(head).toMatch(/\{memories\.map\(\(m, i\) => \{\s*const picture = memoryPicture\(m\.post, i, mediaUrl\);/);
    // No other address for a memory's picture.
    expect(head).not.toMatch(/mediaUrl\("(media|thumbnails)"/);
    const image = head.match(/<Image\s[\s\S]*?\/>/g) ?? [];
    expect(image).toHaveLength(1);
    expect(image[0]).toMatch(/source=\{picture\.source\}/);
    expect(image[0]).toMatch(/placeholder=\{picture\.placeholder \?\? undefined\}/);
    // The thumbnail stands in at the same fit as the photograph, so nothing moves as it arrives.
    expect(image[0]).toMatch(/placeholderContentFit="cover"/);
    expect(image[0]).toMatch(/contentFit="cover"/);
    // Kept as the feed keeps its photographs: the same address, read once.
    expect(image[0]).toMatch(/cachePolicy="memory-disk"/);
    expect(image[0]).toMatch(/style=\{styles\.memoryImage\}/);
  });

  it("keep their place on the page: the page's width at 4:5", () => {
    expect(page).toMatch(/memoryImage: \{ width: "100%", aspectRatio: 4 \/ 5, backgroundColor: colors\.paperSunken \}/);
  });
});
