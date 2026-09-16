import { signatureDate } from "./time";
import { formatMemberNumber, isFoundingMember } from "./membership";

/**
 * The geometry of an exported print.
 *
 * A photograph leaves VINTAGE the way a print leaves a darkroom: on paper,
 * with a margin, and a label along the bottom — the wordmark on the left
 * and, on the right, where it was taken, when, and whose it is. Two
 * formats: `print`, the photograph's own shape with the paper around it,
 * for a feed; `story`, a 9:16 page with the print sitting in the middle,
 * for a story. Two papers: the light page and the darkroom brown.
 *
 * Everything is expressed in the units of `width`, so the same numbers
 * draw the on-screen preview (points), the captured still (points at the
 * phone's scale) and the branded video (pixels, in Swift, which reads
 * these rectangles and flips nothing but the y axis). Pure; tested.
 */

export type ExportFormat = "print" | "story";
export type ExportPaper = "paper" | "darkroom";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextBox extends Rect {
  /** Font size, in the same units. */
  size: number;
  /** Letter spacing, in the same units. */
  spacing: number;
}

export interface ExportLayout {
  width: number;
  height: number;
  margin: number;
  /** Where the photograph or film sits. */
  photo: Rect;
  /** The hairline above the label. */
  rule: Rect;
  wordmark: TextBox;
  /** Where it was taken; one or two lines, or nothing (height 0). */
  place: TextBox;
  /** When it was taken. */
  byline: TextBox;
  /** Whose it is: the member and their number. */
  credit: TextBox;
  /** The amber date stamp, bottom-right of the photograph. */
  stamp: TextBox;
}

/** What the label says, with nothing invented and nothing left dangling. */
export interface ExportLabelText {
  /** Upper-case place, or null when the post names none. */
  place: string | null;
  /** How many lines the place takes: 0, 1 or 2. */
  placeLines: 0 | 1 | 2;
  /** `SEPTEMBER 15, 2026`. */
  date: string;
  /** `chai · MEMBER NO. 00027`, `chai · FOUNDING MEMBER NO. 00002`, or just `chai`. */
  credit: string;
}

// The same clamp the feed applies: nothing taller than 4:5, nothing wider
// than 1.91:1, so a print looks like the post did.
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 1.91;

export function printRatio(width: number | null, height: number | null): number {
  if (!width || !height) return 1;
  return Math.min(Math.max(width / height, MIN_RATIO), MAX_RATIO);
}

/** Widths that come out crisp: 3× a 540-point card is 1620 px; a story is 1080 × 1920. */
export const PRINT_WIDTH = 540;
export const STORY_WIDTH = 360;

/** A place longer than this is set on two lines rather than cut off. */
export const PLACE_WRAP_AT = 22;

/** How many lines a place needs on the label. */
export function placeLineCount(place: string | null | undefined): 0 | 1 | 2 {
  const p = place?.trim();
  if (!p) return 0;
  return p.length > PLACE_WRAP_AT ? 2 : 1;
}

/** The member's line under the date. Real number or nothing; never a placeholder. */
export function memberCredit(username: string, memberNo: number | null | undefined): string {
  const name = username.trim();
  if (typeof memberNo !== "number" || memberNo < 1) return name;
  const number = formatMemberNumber(memberNo);
  return isFoundingMember(memberNo) ? `${name} · FOUNDING MEMBER ${number}` : `${name} · MEMBER ${number}`;
}

/**
 * The words on the label for a post: place, date, member — from the same
 * fields the app shows everywhere else. A missing place is simply absent;
 * the date is the capture date, or the day it was posted when the file
 * carried none, exactly as the feed byline decides it.
 */
export function exportLabelText(
  post: { location: string | null; taken_at: string | null; created_at: string; author: { username: string } },
  memberNo: number | null | undefined,
): ExportLabelText {
  const place = post.location?.trim() ? post.location.trim().toUpperCase() : null;
  return {
    place,
    placeLines: placeLineCount(place),
    date: signatureDate(post.taken_at ?? post.created_at).toUpperCase(),
    credit: memberCredit(post.author.username, memberNo),
  };
}

export function exportLayout(
  ratio: number,
  format: ExportFormat,
  width: number,
  label: { placeLines?: 0 | 1 | 2 } = {},
): ExportLayout {
  const W = width;
  const placeLines = label.placeLines ?? 1;
  const margin = r(W * 0.07);
  const gap = r(margin * 0.75);

  // The label: a rule, then the wordmark on the left and, on the right,
  // the place (one or two lines), the date, and the member.
  const wordmarkSize = r2(W * 0.034);
  const bylineSize = r2(W * 0.019);
  const placeSize = placeLines === 2 ? r2(W * 0.0165) : bylineSize;
  const creditSize = r2(W * 0.017);
  const between = r2(W * 0.006);
  const placeHeight = placeLines === 0 ? 0 : r2(placeSize * 1.35 * placeLines);
  const bylineHeight = r2(bylineSize * 1.35);
  const creditHeight = r2(creditSize * 1.35);
  const block = placeHeight + (placeLines ? between : 0) + bylineHeight + between + creditHeight;
  const labelHeight = Math.max(r(W * 0.115), r(block + W * 0.04));

  let photoWidth = W - 2 * margin;
  let photoHeight = r(photoWidth / ratio);
  let height: number;
  let top: number;
  if (format === "story") {
    height = r((W * 16) / 9);
    const available = height - 2 * margin - gap - labelHeight;
    if (photoHeight > available) {
      photoHeight = available;
      photoWidth = r(photoHeight * ratio);
    }
    // The whole print — picture, gap, label — centred on the page.
    top = r((height - (photoHeight + gap + labelHeight)) / 2);
  } else {
    height = margin + photoHeight + gap + labelHeight + margin;
    top = margin;
  }
  const photo: Rect = { x: r((W - photoWidth) / 2), y: top, width: photoWidth, height: photoHeight };
  const labelTop = photo.y + photo.height + gap;
  const centerY = labelTop + labelHeight / 2 + W * 0.004;

  const rule: Rect = { x: margin, y: labelTop, width: W - 2 * margin, height: Math.max(1, r2(W * 0.002)) };

  const wordmarkHeight = r2(wordmarkSize * 1.3);
  const wordmark: TextBox = {
    x: margin,
    y: r2(centerY - wordmarkHeight / 2),
    width: r((W - 2 * margin) * 0.42),
    height: wordmarkHeight,
    size: wordmarkSize,
    spacing: r2(wordmarkSize * 0.2),
  };

  // The right-hand block, stacked and centred on the same line as the wordmark.
  const rightX = margin + wordmark.width;
  const rightWidth = W - margin - rightX;
  let y = r2(centerY - block / 2);
  const place: TextBox = {
    x: rightX,
    y,
    width: rightWidth,
    height: placeHeight,
    size: placeSize,
    spacing: r2(placeSize * 0.14),
  };
  if (placeLines) y = r2(y + placeHeight + between);
  const byline: TextBox = {
    x: rightX,
    y,
    width: rightWidth,
    height: bylineHeight,
    size: bylineSize,
    spacing: r2(bylineSize * 0.16),
  };
  y = r2(y + bylineHeight + between);
  const credit: TextBox = {
    x: rightX,
    y,
    width: rightWidth,
    height: creditHeight,
    size: creditSize,
    spacing: r2(creditSize * 0.08),
  };

  // The stamp as it sits on the feed: 15 pt on a 540 card, inset from the corner.
  const stampSize = r2(W * 0.028);
  const stampHeight = r2(stampSize * 1.3);
  const stamp: TextBox = {
    x: photo.x + r(photo.width / 2),
    y: r2(photo.y + photo.height - W * 0.022 - stampHeight),
    width: r(photo.width / 2) - r(W * 0.026),
    height: stampHeight,
    size: stampSize,
    spacing: 0,
  };

  return { width: W, height, margin, photo, rule, wordmark, place, byline, credit, stamp };
}

/** The label's one-line form, kept for anything that wants `NYC · Jan 23, 2003`. */
export function exportByline(place: string | null | undefined, date: string): string {
  const p = place?.trim();
  return p ? `${p} · ${date}` : date;
}

function r(n: number): number {
  return Math.round(n);
}
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
