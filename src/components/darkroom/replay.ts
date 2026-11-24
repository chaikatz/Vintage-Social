import { occasionDay } from "@/darkroom/occasions";
import type { DarkroomMode, Print } from "@/darkroom/types";
import { edgeMarkWords } from "./words";

/**
 * The glide strip's rules, the ones that need no screen: the strip's
 * measures, which frame is under its box, where a chapter's groups begin,
 * and the marks printed along its top edge. The file keeps the name of
 * the replay the strip was cut from; the strip is now on every page of
 * the room, and sliding across it is how a chapter is played through.
 *
 * Pure: it reads the chapter's own prints, which the room already holds,
 * and asks the library nothing.
 */

/** The glide strip: frames, their pitch, the frame in front's growth, the grease-pencil box and the marks' row. */
export const STRIP = { cellW: 28, cellH: 40, gap: 8, pitch: 36, centreScale: 1.2, boxW: 40, boxH: 54, marks: 12 } as const;
/** Edge marks closer than this many frames to the last one kept are left out. */
export const MARK_SPACING = 3;

/**
 * The strip's frame under its box at scroll offset `x`, of `count` frames:
 * the chapter's prints and the blank frame after them.
 */
export function stripIndex(x: number, count: number): number {
  if (count <= 0 || !Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(x / STRIP.pitch)));
}

/**
 * Where a chapter's groups begin, in one pass. On this day is ordered
 * newest year first and each year in the order taken (discovery's own
 * order), so a new year begins wherever the time goes backwards; that is
 * exact even near New Year, where a year is an anniversary's, not the
 * calendar's. A stretch is grouped by its days, which run to four in the
 * morning (`occasionDay`). A year, dealt January to December, by its
 * months. Surprise me and the shelf are one group.
 */
export function groupStarts(prints: readonly Print[], mode: DarkroomMode): number[] {
  const n = prints.length;
  if (n === 0) return [];
  const starts = [0];
  if (mode !== "on-this-day" && mode !== "span" && mode !== "year") return starts;
  let day = mode === "span" ? occasionDay(prints[0].takenAt) : 0;
  for (let i = 1; i < n; i++) {
    let fresh = false;
    if (mode === "on-this-day") fresh = prints[i].takenAt < prints[i - 1].takenAt;
    else if (mode === "span") {
      const d = occasionDay(prints[i].takenAt);
      fresh = d !== day;
      day = d;
    } else {
      const a = new Date(prints[i - 1].takenAt);
      const b = new Date(prints[i].takenAt);
      fresh = a.getMonth() !== b.getMonth() || a.getFullYear() !== b.getFullYear();
    }
    if (fresh) starts.push(i);
  }
  return starts;
}

/**
 * The marks printed along the strip's top edge, by frame: the year in On
 * this day, the day in a stretch of two days or more, the month in a
 * year; never a frame number, and none in Surprise me or on the shelf. A
 * mark within `MARK_SPACING` frames of the last one kept is left out, so
 * marks never run into each other.
 */
export function edgeMarks(prints: readonly Print[], mode: DarkroomMode, now: number): Map<number, string> {
  const marks = new Map<number, string>();
  if (mode === "set-aside" || mode === "surprise") return marks;
  const starts = groupStarts(prints, mode);
  if (mode === "span" && starts.length < 2) return marks;
  let last = -Infinity;
  for (const s of starts) {
    if (s - last < MARK_SPACING) continue;
    const words = edgeMarkWords(mode, prints[s].takenAt, now);
    if (words == null) continue;
    marks.set(s, words);
    last = s;
  }
  return marks;
}
