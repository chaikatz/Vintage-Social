import { DEMO_POSTS } from "@/demo/fixtures";
import { PHOTOS } from "@/demo/photoAssets";
import { DEMO_PREFIX } from "@/demo/photos";
import { mulberry32 } from "@/utils/shuffle";
import type { LibrarySource, Page, PageRequest, Print } from "./types";

/**
 * A small library for the browser review build, which has no camera roll.
 *
 * The demo world's own bundled photographs, given capture dates spread
 * across seventeen years — six of them on today's date in earlier years,
 * so On This Day has something to show on any day it is opened. Built
 * once per load, deterministically, so a screenshot taken today and one
 * taken tomorrow differ only in which day is "today".
 */

const DAY_MS = 86_400_000;

function build(now: number): Print[] {
  const seen = new Set<string>();
  const shapes: { seed: string; width: number; height: number }[] = [];
  for (const p of DEMO_POSTS) {
    const seed = String(p.media_path).replace(/^demo:/, "");
    if (seen.has(seed) || !(seed in PHOTOS)) continue;
    seen.add(seed);
    // A film's poster frame is a photograph here, at the film's shape.
    shapes.push({ seed, width: p.width ?? 1200, height: p.height ?? 1500 });
  }
  const today = new Date(now);
  const rand = mulberry32(19740630);
  const anniversaries = [1, 3, 5, 8, 11, 14];
  const floor = new Date(2009, 0, 1).getTime();
  const ceiling = now - 100 * DAY_MS;
  return shapes
    .map((s, i): Print => {
      let takenAt: number;
      if (i < anniversaries.length) {
        const d = new Date(today.getFullYear() - anniversaries[i], today.getMonth(), today.getDate(), 9 + i * 2, 14);
        takenAt = d.getTime();
      } else {
        takenAt = Math.floor(floor + rand() * (ceiling - floor));
      }
      return { id: `demo-library-${s.seed}`, uri: DEMO_PREFIX + s.seed, width: s.width, height: s.height, takenAt, subtypes: [] };
    })
    .sort((a, b) => a.takenAt - b.takenAt);
}

let library: Print[] | null = null;
function all(): Print[] {
  if (!library) library = build(Date.now());
  return library;
}

export const demoSource: LibrarySource = {
  async count(range, subtype) {
    if (subtype) return 0;
    return all().filter((p) => p.takenAt >= range.from && p.takenAt < range.to).length;
  },
  async page({ range, first, after, order }: PageRequest): Promise<Page> {
    let list = all().filter((p) => p.takenAt >= range.from && p.takenAt < range.to);
    if (order === "desc") list = [...list].reverse();
    const start = after ? list.findIndex((p) => p.id === after) + 1 : 0;
    const prints = list.slice(start, start + first);
    return {
      prints,
      endCursor: prints[prints.length - 1]?.id ?? after ?? null,
      hasNextPage: start + first < list.length,
    };
  },
  async oldest() {
    return all()[0]?.takenAt ?? null;
  },
};
