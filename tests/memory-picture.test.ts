import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHARP_MEMORIES, memoryPicture } from "@/utils/memoryPicture";
import { THUMB_SHORT } from "@/uploads/thumbSize";
import { getFilter } from "@/filters/presets";
import { DEMO_PREFIX } from "@/demo/photos";

/**
 * On this day draws each memory the width of the page. It drew them from
 * the grid's thumbnail, 540 px on its short side, across 1,170 to 1,320 px
 * of a 3x phone: soft whatever the photograph. Now from the photograph,
 * with the thumbnail standing in while it arrives.
 */

const url = (bucket: "media" | "thumbnails", p: string | null) => (p ? `https://cdn/${bucket}/${p}` : null);
// Posted through VINTAGE: the film is in the pixels.
const photo = {
  media_type: "photo" as const,
  media_path: "u/p.jpg",
  thumb_path: "u/p_t.jpg",
  filter_id: "chrome-64",
  filter_baked: true,
};
const film = { ...photo, media_type: "video" as const, media_path: "u/v.mp4", thumb_path: "u/v_t.jpg" };

describe("a memory's picture", () => {
  it("is the photograph itself, with its thumbnail standing in", () => {
    expect(memoryPicture(photo, 0, url)).toEqual({
      source: "https://cdn/media/u/p.jpg",
      placeholder: "https://cdn/thumbnails/u/p_t.jpg",
      look: null,
    });
    // The thumbnail alone was too small for the page: its short side against a 3x phone's width.
    expect(THUMB_SHORT).toBeLessThan(1170);
  });

  it("is the photograph alone when there is no thumbnail to stand in", () => {
    expect(memoryPicture({ ...photo, thumb_path: null }, 0, url)).toEqual({ source: "https://cdn/media/u/p.jpg", placeholder: null, look: null });
  });

  it("is a film's poster frame, never its movie, with nothing standing in", () => {
    expect(memoryPicture(film, 0, url)).toEqual({ source: "https://cdn/thumbnails/u/v_t.jpg", placeholder: null, look: null });
    // A film without a poster frame draws nothing rather than a movie an image cannot draw.
    expect(memoryPicture({ ...film, thumb_path: null }, 0, url)).toEqual({ source: null, placeholder: null, look: null });
  });

  it("asks for the photograph for the first few memories of the day only, which is every day anyone has now", () => {
    // The most any member has from one day on production is 6.
    expect(SHARP_MEMORIES).toBe(6);
    for (let i = 0; i < SHARP_MEMORIES; i += 1) expect(memoryPicture(photo, i, url).source).toBe("https://cdn/media/u/p.jpg");
    // After them, the thumbnail, as every memory was drawn before: a day of fifty costs six photographs more, not fifty.
    expect(memoryPicture(photo, SHARP_MEMORIES, url)).toEqual({ source: "https://cdn/thumbnails/u/p_t.jpg", placeholder: null, look: null });
    expect(memoryPicture({ ...photo, thumb_path: null }, 49, url)).toEqual({ source: "https://cdn/media/u/p.jpg", placeholder: null, look: null });
  });

  it("keeps demo photographs, which are bundled module ids, as they are", () => {
    const demo = (bucket: "media" | "thumbnails", p: string | null) => (p ? (bucket === "media" ? 101 : 102) : null);
    expect(memoryPicture(photo, 0, demo)).toMatchObject({ source: 101, placeholder: 102 });
    // The same picture for both is drawn once, not stood in for by itself.
    expect(memoryPicture(photo, 0, () => 7)).toMatchObject({ source: 7, placeholder: null });
  });
});

/**
 * A picture that was not baked with its film showed bare on On this day,
 * while the feed, the grid and the photograph's own page lay the film's
 * look over it: tapping the memory opened a different-looking photograph.
 */
describe("a memory's film", () => {
  it("is laid over a photograph the darkroom could not bake, whichever picture is drawn", () => {
    const plain = { ...photo, filter_id: "archive-bw", filter_baked: false };
    expect(memoryPicture(plain, 0, url).look).toEqual(getFilter("archive-bw"));
    // Past the first few, on its thumbnail, the same film.
    expect(memoryPicture(plain, SHARP_MEMORIES, url).look).toEqual(getFilter("archive-bw"));
    expect(memoryPicture(plain, 0, url).look?.monochrome).toBe(true);
  });

  it("is laid over a film's poster frame when the film was not baked", () => {
    expect(memoryPicture({ ...film, filter_id: "seventy", filter_baked: false }, 0, url)).toEqual({
      source: "https://cdn/thumbnails/u/v_t.jpg",
      placeholder: null,
      look: getFilter("seventy"),
    });
  });

  it("is laid over the demo's and the house's photographs, which were never baked", () => {
    expect(memoryPicture({ ...photo, media_path: `${DEMO_PREFIX}milan-nebbia`, filter_id: "archive-bw" }, 0, url).look).toEqual(
      getFilter("archive-bw"),
    );
    expect(memoryPicture({ ...photo, media_path: "https://images.example/house.jpg", filter_id: "alpine" }, 0, url).look).toEqual(
      getFilter("alpine"),
    );
  });

  it("is left off a picture that has it in its pixels already, so it is never doubled", () => {
    expect(memoryPicture(photo, 0, url).look).toBeNull();
    expect(memoryPicture(film, 0, url).look).toBeNull();
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
  const print = page.slice(page.indexOf("const MemoryPrint = React.memo("), page.indexOf("function SectionLabel("));

  it("draw each memory's picture as memoryPicture gives it, by its place on the page", () => {
    expect(head).toMatch(
      /\{memories\.map\(\(m, i\) => \(\s*<Pressable key=\{m\.post\.id\} style=\{styles\.memory\} onPress=\{\(\) => openPost\(m\.post\)\}>\s*<MemoryPrint post=\{m\.post\} index=\{i\} \/>/,
    );
    expect(print).toMatch(/const picture = memoryPicture\(post, index, mediaUrl\);/);
    // No other address for a memory's picture.
    expect(head).not.toMatch(/mediaUrl\(|<Image\b/);
    expect(print).not.toMatch(/mediaUrl\("(media|thumbnails)"/);
    const image = print.match(/<Image\s[\s\S]*?\/>/g) ?? [];
    expect(image).toHaveLength(1);
    expect(image[0]).toMatch(/source=\{picture\.source\}/);
    expect(image[0]).toMatch(/placeholder=\{picture\.placeholder \?\? undefined\}/);
    // The thumbnail stands in at the same fit as the photograph, so nothing moves as it arrives.
    expect(image[0]).toMatch(/placeholderContentFit="cover"/);
    expect(image[0]).toMatch(/contentFit="cover"/);
    // Kept as the feed keeps its photographs: the same address, read once.
    expect(image[0]).toMatch(/cachePolicy="memory-disk"/);
    // Nothing to draw, nothing drawn: no empty frame for a film without its poster.
    expect(print).toMatch(/if \(picture\.source == null\) return null;/);
  });

  it("ask again for a picture that failed to load, as the feed and the grid do", () => {
    expect(page).toMatch(/^import \{ useImageRetry \} from "@\/media\/imageRetry";$/m);
    expect(print).toMatch(/const retry = useImageRetry\(picture\.source\);\s*if \(picture\.source == null\) return null;/);
    const image = print.match(/<Image\s[\s\S]*?\/>/)?.[0] ?? "";
    expect(image).toMatch(/key=\{retry\.attempt\}/);
    expect(image).toMatch(/onError=\{retry\.onError\}/);
  });

  it("wear the film's look where the picture was not baked with it, as the photograph's own page does", () => {
    // The filter where the platform draws it, and the blended layers over it where it does not
    // (iOS draws a filter's brightness alone: src/components/FilterOverlay.tsx).
    const image = print.match(/<Image\s[\s\S]*?\/>/)?.[0] ?? "";
    expect(image).toMatch(
      /style=\{\[StyleSheet\.absoluteFill, picture\.look \? \(\{ filter: cssFilterFor\(picture\.look\)\.filter \} as object\) : null\]\}/,
    );
    expect(print).toMatch(/\/>\s*\{picture\.look \? <FilterOverlay filter=\{picture\.look\} \/> : null\}\s*<\/View>/);
    expect(page).toMatch(/^import \{ FilterOverlay \} from "@\/components\/FilterOverlay";$/m);
    expect(page).toMatch(/^import \{ cssFilterFor \} from "@\/filters\/cssFilter";$/m);
  });

  it("keep their place on the page: the page's width at 4:5", () => {
    // The frame holds the picture and its film's layers, the size the picture alone was.
    expect(print).toMatch(/return \(\s*<View style=\{styles\.memoryImage\}>\s*<Image/);
    expect(page).toMatch(/memoryImage: \{ width: "100%", aspectRatio: 4 \/ 5, backgroundColor: colors\.paperSunken \}/);
  });
});
