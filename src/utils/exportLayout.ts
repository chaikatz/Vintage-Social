/**
 * The geometry of an exported print.
 *
 * A photograph leaves VINTAGE the way a print leaves a darkroom: on paper,
 * with a margin, and a label along the bottom — the wordmark on the left,
 * the place and date on the right, the member's name under them. Two
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
  byline: TextBox;
  credit: TextBox;
  /** The amber date stamp, bottom-right of the photograph. */
  stamp: TextBox;
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

export function exportLayout(ratio: number, format: ExportFormat, width: number): ExportLayout {
  const W = width;
  const margin = r(W * 0.07);
  const gap = r(margin * 0.75);
  // The label: a rule, then a row with the wordmark and the right-hand block.
  const wordmarkSize = r2(W * 0.034);
  const bylineSize = r2(W * 0.019);
  const creditSize = r2(W * 0.017);
  const labelHeight = r(W * 0.115);

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
  const centerY = labelTop + labelHeight * 0.56;

  const rule: Rect = { x: margin, y: labelTop, width: W - 2 * margin, height: Math.max(1, r2(W * 0.002)) };

  const wordmarkHeight = r2(wordmarkSize * 1.3);
  const wordmark: TextBox = {
    x: margin,
    y: r2(centerY - wordmarkHeight / 2),
    width: r((W - 2 * margin) * 0.5),
    height: wordmarkHeight,
    size: wordmarkSize,
    spacing: r2(wordmarkSize * 0.2),
  };

  const bylineHeight = r2(bylineSize * 1.35);
  const creditHeight = r2(creditSize * 1.35);
  const between = r2(W * 0.005);
  const blockHeight = bylineHeight + between + creditHeight;
  const rightX = r(W / 2);
  const rightWidth = W - margin - rightX;
  const byline: TextBox = {
    x: rightX,
    y: r2(centerY - blockHeight / 2),
    width: rightWidth,
    height: bylineHeight,
    size: bylineSize,
    spacing: r2(bylineSize * 0.16),
  };
  const credit: TextBox = {
    x: rightX,
    y: r2(byline.y + bylineHeight + between),
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

  return { width: W, height, margin, photo, rule, wordmark, byline, credit, stamp };
}

/** The label's right-hand line: `NYC · Jan 23, 2003`, or the date alone. */
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
