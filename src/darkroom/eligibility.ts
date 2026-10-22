import type { Print } from "./types";

/**
 * Which photographs are worth showing, and how a run of near-identical
 * frames is read as one.
 *
 * Only what the library already says about a photograph is used — its
 * shape, its size, its subtype, when it was taken. Nothing looks at the
 * pixels, so nothing here claims to know what a picture is of.
 */

/** Smaller than this on its short side is a thumbnail, a saved icon, a sticker. */
export const MIN_SHORT_SIDE = 320;
/** Narrower than 1:2 and not a panorama is the shape of a phone screen, not a camera's frame. */
export const MIN_SHAPE = 0.5;
/** Frames this close together are one moment: a burst, or the same shot taken again. */
export const SCENE_GAP_MS = 90_000;
/** Scenes this far apart are different occasions. */
export const EVENT_GAP_MS = 3 * 3_600_000;
/** However long an occasion, at most this many of its moments are shown in a chapter. */
export const MAX_SCENES_PER_EVENT = 4;

/** Cameras write HEIC, JPEG or DNG. A PNG or a GIF in the roll is a saved graphic, a meme, a screen. */
const NOT_A_CAMERA = /\.(png|gif)$/i;

export function isEligible(print: Print): boolean {
  if (!(print.takenAt > 0)) return false;
  if (print.subtypes.includes("screenshot")) return false;
  if (print.filename && NOT_A_CAMERA.test(print.filename)) return false;
  const { width, height } = print;
  if (!(width > 0 && height > 0)) return false;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < MIN_SHORT_SIDE) return false;
  if (short / long < MIN_SHAPE && !print.subtypes.includes("panorama")) return false;
  return true;
}

/**
 * Consecutive frames within `gap` of each other, grouped. Input in capture
 * order (either direction); groups keep that order.
 */
export function groupRuns(prints: readonly Print[], gap: number): Print[][] {
  const out: Print[][] = [];
  for (const p of prints) {
    const run = out[out.length - 1];
    if (run && Math.abs(p.takenAt - run[run.length - 1].takenAt) <= gap) run.push(p);
    else out.push([p]);
  }
  return out;
}

/**
 * The frame that stands for a run: the largest, and of equals the last —
 * the one taken after the camera was settled, usually the keeper.
 */
export function representative(run: readonly Print[]): Print {
  let best = run[0];
  for (const p of run) {
    const area = p.width * p.height;
    const bestArea = best.width * best.height;
    if (area > bestArea || (area === bestArea && p.takenAt >= best.takenAt)) best = p;
  }
  return best;
}

/** One frame per moment, in capture order. */
export function condense(prints: readonly Print[], gap = SCENE_GAP_MS): Print[] {
  return groupRuns(prints, gap).map(representative);
}

/**
 * `count` items spread evenly through a list, first and last included
 * when there is room for both; a single pick is the middle. Keeps order.
 */
export function spread<T>(items: readonly T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (items.length <= count) return [...items];
  if (count === 1) return [items[Math.floor((items.length - 1) / 2)]];
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(items[Math.round((i * (items.length - 1)) / (count - 1))]);
  return out;
}

/** How many of an occasion's moments a chapter shows: grows slowly with its size. */
export function scenesFor(occasionSize: number): number {
  return Math.min(MAX_SCENES_PER_EVENT, Math.max(1, Math.ceil(Math.sqrt(occasionSize))));
}

/**
 * A chapter's edit of an occasion: its moments, a few of them, spread
 * through it — the way a contact sheet is marked up, not every frame.
 */
export function editOccasion(scenes: readonly Print[]): Print[] {
  return spread(scenes, scenesFor(scenes.length));
}
