import { DEMO_POSTS } from "@/demo/fixtures";
import { PHOTOS } from "@/demo/photoAssets";
import { DEMO_PREFIX } from "@/demo/photos";
import { mulberry32 } from "@/utils/shuffle";
import { anniversary } from "./discovery";
import type { LibrarySource, Page, PageRequest, Print } from "./types";

/**
 * A small library for the browser review build, which has no camera roll.
 *
 * The demo world's own bundled photographs, given capture dates across
 * seventeen years. Six fall on today's date in earlier years, so On This
 * Day opens on any day it is visited. The rest are shared out so that
 * nine years hold three photographs each, which is enough for a whole
 * roll of Surprise me, and a tenth holds two. None of the rest falls
 * within a fortnight of the anniversary, so On This Day shows its six and
 * no more.
 * Built once per load, deterministically, so a screenshot taken today and
 * one taken tomorrow differ only in which day is "today".
 */

const DAY_MS = 86_400_000;
/** Years before today of the six anniversaries. */
const ANNIVERSARIES = [1, 3, 5, 8, 11, 14];
/** Years before today of everything else, in turn. */
const OTHERS = [1, 1, 3, 3, 5, 5, 8, 8, 11, 11, 14, 14, 2, 2, 2, 7, 7, 7, 17, 17, 17, 10, 10];
/** Nothing else is dated within this many days of the anniversary. */
const CLEAR_OF_ANNIVERSARY_DAYS = 15;
/** Everything is at least this old, well past the Darkroom's ninety days. */
const NEWEST_DAYS = 100;

function build(now: number): Print[] {
  const seen = new Set<string>();
  const shapes: { seed: string; width: number; height: number }[] = [];
  for (const p of DEMO_POSTS) {
    const seed = String(p.media_path).replace(/^demo:/, "");
    if (seen.has(seed) || !(seed in PHOTOS)) continue;
    seen.add(seed);
    shapes.push({ seed, width: p.width ?? 1200, height: p.height ?? 1500 });
  }
  const today = new Date(now);
  const rand = mulberry32(19740630);
  const ceiling = now - NEWEST_DAYS * DAY_MS;
  return shapes
    .map((s, i): Print => {
      let takenAt: number;
      if (i < ANNIVERSARIES.length) {
        // The same date the Darkroom looks for: the 28th in a common year when today is the 29th of February.
        const date = anniversary(today.getFullYear() - ANNIVERSARIES[i], today.getMonth(), today.getDate());
        takenAt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9 + i * 2, 14).getTime();
      } else {
        const year = today.getFullYear() - OTHERS[(i - ANNIVERSARIES.length) % OTHERS.length];
        const from = new Date(year, 0, 1).getTime();
        const to = Math.min(new Date(year + 1, 0, 1).getTime(), ceiling);
        const span = to - from;
        let t = from + rand() * span;
        const near = anniversary(year, today.getMonth(), today.getDate()).getTime();
        // Half the year away from the anniversary, if it landed near it.
        if (Math.abs(t - near) < CLEAR_OF_ANNIVERSARY_DAYS * DAY_MS) t = from + ((t - from + span / 2) % span);
        const d = new Date(t);
        d.setHours(8 + Math.floor(rand() * 12), Math.floor(rand() * 60), 0, 0);
        takenAt = d.getTime();
      }
      return { id: `demo-library-${s.seed}`, uri: DEMO_PREFIX + s.seed, width: s.width, height: s.height, takenAt, subtypes: [] };
    })
    .sort((a, b) => a.takenAt - b.takenAt);
}

/** The three questions, answered from a list of prints in capture order. */
function answering(prints: () => readonly Print[]): LibrarySource {
  const within = (from: number, to: number) => prints().filter((p) => p.takenAt >= from && p.takenAt < to);
  return {
    async count(range, subtype) {
      if (subtype) return 0;
      return within(range.from, range.to).length;
    },
    async page({ range, first, order }: PageRequest): Promise<Page> {
      let list = within(range.from, range.to);
      if (order === "desc") list = list.reverse();
      return { prints: list.slice(0, Math.max(0, first)), hasNextPage: list.length > first };
    },
    async oldest() {
      return prints()[0]?.takenAt ?? null;
    },
  };
}

let library: Print[] | null = null;

export const demoSource: LibrarySource = answering(() => {
  if (!library) library = build(Date.now());
  return library;
});

/** The demo library as it would be on another day, for the tests; the browser build uses `demoSource`. */
export function demoSourceAt(now: number): LibrarySource {
  const prints = build(now);
  return answering(() => prints);
}
