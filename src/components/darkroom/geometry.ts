/**
 * Where everything sits on the room's page, derived from the window and
 * the safe area alone, so a print's well is the right size before a
 * single pixel of it arrives and nothing moves when they do.
 *
 * On the reference phone (393 × 852, insets 59/34) the running head runs
 * from 59 to 103, the photograph's area (the stage) from 103 to 686, 583
 * high, POST's block from 686 to 734, right under the photograph's
 * caption, and the glide strip from 746 to 814, the control beneath it,
 * 4 above the home indicator's inset; on an SE (375 × 667, insets 20/0)
 * the stage runs from 64 to 519, 455 high. When the word and the strip
 * changed places the stage kept its height, so every plate is the size it
 * was. Until Contents is first opened the running head carries a
 * second line, about 23 more, and the stage is that much shorter. The
 * screen lays these out with flex and measures the stage; the numbers here
 * are what it is measured against.
 *
 * Under each plate is its label, as a VINTAGE print has one: paper, then
 * the signature line — the print's hairline rule — and the caption hung
 * beneath it. The paper between the photograph and the line is the
 * print's own proportion (`exportLayout`: a sixteenth of the line's
 * width), so the room's plates and the prints a member exports are set
 * alike.
 *
 * At the end are the plate's two other rules that need no screen: how far
 * the caption's presses reach, and what a plate that cannot draw its
 * photograph decides about asking again.
 *
 * Pure, so the tests can hold the plate to its sizes.
 */
import { exportLayout, PRINT_WIDTH } from "@/utils/exportLayout";
import type { PlateTrouble } from "./words";

/** The running head's height; a minimum, so it grows with Dynamic Type. */
export const HEAD_HEIGHT = 44;
/**
 * POST's block, right under the stage: the photograph's word. Its height
 * is fixed, whatever a develop state puts in its place, so the stage keeps
 * one height on every page; the longest word, DOWNLOAD AND POST, keeps to
 * one line at the largest type the word allows, on a 320-point phone.
 */
export const DEVELOP_HEIGHT = 48;
/**
 * The glide strip's slot under POST, on every page: the marks' row, 2 pt,
 * and the grease-pencil box's row (`STRIP` in replay.ts, which the tests
 * hold this to). A gap over it, between POST and the strip, so the word
 * reads as the photograph's and the strip as the control beneath; the
 * strip's own gutters at either side, the plate's, which keep its left
 * end clear of the back swipe at the left edge; and under it, the strip
 * stands this far above the bottom inset (or 16, without one).
 */
export const GLIDE_HEIGHT = 68;
export const GLIDE_GAP = 12;
export const GLIDE_INSET = 16;
export const GLIDE_LIFT = 4;
export const MIN_BOTTOM_INSET = 16;
/** The plate keeps this far from each side of the page. */
export const PLATE_GUTTER = 16;

/** A square print, as it is exported: the paper under its photograph, measured. */
const PRINT = exportLayout(1, "print", PRINT_WIDTH);
/**
 * The paper between the photograph and the signature line, as a share of
 * the line's width: the print's gap over its picture's width, which is
 * the width of its rule. A sixteenth.
 */
export const SIGNATURE_SHARE = (PRINT.rule.y - (PRINT.photo.y + PRINT.photo.height)) / PRINT.photo.width;
/** The signature line's weight: the print's rule at the plate's size, which never comes to less than 1. */
export const SIGNATURE_RULE = 1;
/** The caption hangs this far under the signature line: the print's label, at the plate's size. */
export const CAPTION_GAP = 10;
/** Room kept above the group, and below it. */
const ABOVE = 12;
const BELOW = 20;
/** The group sits this far above true centre: the optical centre of a page. */
const OPTICAL_LIFT = 12;
const MIN_TOP = 8;
/** A caption is never narrower than this, even under a narrow print. */
export const MIN_CAPTION_WIDTH = 240;

/** The stage between the running head and POST over the glide strip, for a window and its insets. */
export function stageFrame(height: number, insets: { top: number; bottom: number }): { top: number; height: number } {
  const top = insets.top + HEAD_HEIGHT;
  const bottom = height - Math.max(insets.bottom, MIN_BOTTOM_INSET) - GLIDE_LIFT - GLIDE_HEIGHT - GLIDE_GAP - DEVELOP_HEIGHT;
  return { top, height: Math.max(0, bottom - top) };
}

/**
 * The caption's height, from the signature line down, the space under the
 * line included: `10 + round(14·s1) + 6 + round(20·s2)·L`, where s1 and
 * s2 are the font scale capped as the two lines cap it (1.5 and 2.0), and
 * L is the number of lines the second line takes. 50 at the default size.
 * The page confirms it by measuring, and refits when it differs.
 */
export function captionHeight(fontScale: number, lines: 1 | 2): number {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const s1 = Math.min(scale, 1.5);
  const s2 = Math.min(scale, 2);
  return CAPTION_GAP + Math.round(14 * s1) + 6 + Math.round(20 * s2) * lines;
}

/**
 * The caption heights pages have measured this session, by type size and
 * by whether the second line runs to two. A page is laid out at the
 * height measured before it, where there is one, rather than at the
 * estimate: a plate laid out at the estimate and then refitted to its
 * measure changes size, and on the phone its photograph is asked of
 * Photos a second time at the new size, the first request thrown away.
 * So where the estimate is out at a type size, only the first page there
 * refits. The least height measured is kept — a caption whose word drops
 * to a row of its own is taller, and is the exception — so a page whose
 * word does that still refits, as it always did, and the next is not
 * laid out at its height.
 */
export class CaptionHeights {
  private readonly known = new Map<string, number>();

  get(fontScale: number, long: boolean): number | null {
    return this.known.get(`${fontScale}:${long}`) ?? null;
  }

  set(fontScale: number, long: boolean, height: number): void {
    if (!(Number.isFinite(height) && height > 0)) return;
    const key = `${fontScale}:${long}`;
    const was = this.known.get(key);
    const h = Math.round(height);
    if (was == null || h < was) this.known.set(key, h);
  }
}

/** Width over height, or square for a print whose size the library did not say. */
export function ratioOf(size: { width: number; height: number }): number {
  return size.width > 0 && size.height > 0 && Number.isFinite(size.width / size.height) ? size.width / size.height : 1;
}

function toPixel(value: number, pixelRatio: number): number {
  const r = pixelRatio > 0 ? pixelRatio : 1;
  return Math.round(value * r) / r;
}

/**
 * The plate: the largest box of the print's own shape that fits the page
 * width less its gutters, and the stage less the room above, the label
 * under it (the paper, the signature line and the caption) and the room
 * below. The paper grows with the plate's width, so the two are worked
 * out together: a sixteenth of the plate's width for a plate 240 or
 * wider, and a sixteenth of 240 under a narrower one, whose label is
 * still 240 wide. Rounded to the screen's pixels.
 */
export function plateBox(
  ratio: number,
  pageWidth: number,
  stageHeight: number,
  caption: number,
  pixelRatio = 1,
): { width: number; height: number } {
  const r = ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
  const maxW = Math.max(1, pageWidth - PLATE_GUTTER * 2);
  // The photograph and the paper under it, down to the signature line.
  const room = Math.max(1, stageHeight - ABOVE - caption - SIGNATURE_RULE - BELOW);
  // w / r + w / 16 = room, for a plate as wide as its label…
  const wide = room / (1 / r + SIGNATURE_SHARE);
  // …or w / r + 240 / 16 = room, under a narrower one.
  const narrow = Math.max(1, (room - MIN_CAPTION_WIDTH * SIGNATURE_SHARE) * r);
  const w = Math.min(maxW, wide >= MIN_CAPTION_WIDTH ? wide : narrow);
  return { width: toPixel(w, pixelRatio), height: toPixel(w / r, pixelRatio) };
}

/** The paper between a photograph and its signature line, for a label (and line) this wide. */
export function signatureGap(labelWidth: number, pixelRatio = 1): number {
  return toPixel(Math.max(0, labelWidth) * SIGNATURE_SHARE, pixelRatio);
}

/** Everything under a plate this wide: the paper, the signature line, and the caption beneath. */
export function underPlate(plateWidth: number, caption: number, pixelRatio = 1): number {
  return signatureGap(captionWidth(plateWidth), pixelRatio) + SIGNATURE_RULE + caption;
}

/** The plate and its label, centred in the stage as one group, a little above true centre. */
export function groupTop(stageHeight: number, plateHeight: number, under: number): number {
  return Math.max(MIN_TOP, (stageHeight - plateHeight - under) / 2 - OPTICAL_LIFT);
}

/** The caption and its signature line run flush with the plate's edges, and never narrower than 240. */
export function captionWidth(plateWidth: number): number {
  return Math.max(plateWidth, MIN_CAPTION_WIDTH);
}

/**
 * Where a print's plate and its caption stand on a page, as `PrintPage`
 * lays them out: the plate's box, its top and left edges on the page, the
 * caption's width and left edge, and the paper between the photograph and
 * the signature line. The glide strip's preview is drawn here, so it sits
 * exactly on the plate it stands in for.
 */
export function plateFrame(
  ratio: number,
  pageWidth: number,
  stageHeight: number,
  caption: number,
  pixelRatio = 1,
): { box: { width: number; height: number }; top: number; left: number; captionW: number; captionLeft: number; gap: number } {
  const box = plateBox(ratio, pageWidth, stageHeight, caption, pixelRatio);
  const captionW = captionWidth(box.width);
  const gap = signatureGap(captionW, pixelRatio);
  const top = groupTop(stageHeight, box.height, underPlate(box.width, caption, pixelRatio));
  return { box, top, left: (pageWidth - box.width) / 2, captionW, captionLeft: (pageWidth - captionW) / 2, gap };
}

/**
 * The feed shows a photograph between 4:5 and 1.91:1 (`PostMedia`, and
 * compose's frame). A print outside that will be cropped, and the easel
 * blades show how before the editor opens.
 */
export const FEED_TALLEST = 0.8;
export const FEED_WIDEST = 1.91;

export function feedCrops(ratio: number): boolean {
  return ratio < FEED_TALLEST || ratio > FEED_WIDEST;
}

/**
 * The blades' depth for a plate: from the top and bottom for a tall
 * print, kept to `width / 0.8`; from the sides for a wide one, kept to
 * `height × 1.91`. Zero for a print the feed shows whole.
 */
export function bladeDepth(
  plate: { width: number; height: number },
  ratio: number,
): { axis: "vertical" | "horizontal"; depth: number } | null {
  if (ratio < FEED_TALLEST) {
    const kept = plate.width / FEED_TALLEST;
    const depth = (plate.height - kept) / 2;
    return depth > 0.5 ? { axis: "vertical", depth } : null;
  }
  if (ratio > FEED_WIDEST) {
    const kept = plate.height * FEED_WIDEST;
    const depth = (plate.width - kept) / 2;
    return depth > 0.5 ? { axis: "horizontal", depth } : null;
  }
  return null;
}

/** Every press in the room is at least this tall (§11.6). */
export const TOUCH_TARGET = 44;
/** Caption line 1's own height at the default type size. */
const LINE_1 = 14;

/**
 * How far the caption's two presses reach above and below their letters.
 * Drawn as padding that an equal negative margin takes back, so the
 * caption is laid out exactly as if the reach were not there and
 * `captionHeight` still holds, and the target is part of the measured
 * layout, where a test can see it. (HitSlop's trouble here was never its
 * reach: the line beneath, drawn later, took the touch first. That line
 * and the signature line now let touches through.)
 *
 * The date reaches up to the signature line and down over the line
 * beneath: 44 at the default type size and more as the type grows. Below
 * the default its press keeps a minimum height of 44, which leaves the
 * 14 pt the row is held to anyway, so nothing moves. The word at the
 * right (SET ASIDE) is set smaller, in 10 pt Courier with no line height
 * of its own: about 11 pt tall, and 9.3 at the smallest Dynamic Type
 * size. So it reaches further down, and its reach and letters make 44 at
 * every size without its minimum height ever taking effect, which would
 * move the word when it has a row of its own. Upward it reaches over the
 * signature line into the paper above it, never as far as the
 * photograph: that paper is at least a sixteenth of 240.
 */
export const DATE_REACH = { top: CAPTION_GAP, bottom: TOUCH_TARGET - LINE_1 - CAPTION_GAP };
export const WORD_REACH = { top: 15, bottom: 20 };

/**
 * Why a plate could not draw its photograph, decided when it fails and
 * kept: gone from the library (expo-image's error says "not found"), or
 * failed while the phone was offline, or failed while it was online. It is
 * read from the moment of failure, not from the network afterwards,
 * because §9.4 tells the last two apart by when they happened: one that
 * failed with a connection will not draw by being asked again at once.
 * The error text names the asset, so it is only matched, never kept.
 */
export function plateTrouble(error: string | undefined, online: boolean): PlateTrouble {
  if (/not found/i.test(error ?? "")) return "missing";
  return online ? "other" : "offline";
}

/**
 * What a failure is called once the phone goes offline: one that looked
 * like the image's own fault while the phone was online (or before it
 * knew) may just as well be iCloud's, and it will be asked again when the
 * phone is back — so it says IN ICLOUD meanwhile, not "Try it again later".
 */
export function troubleOffline(trouble: PlateTrouble | null, wasOnline: boolean, online: boolean): PlateTrouble | null {
  return trouble === "other" && wasOnline && !online ? "offline" : trouble;
}

/**
 * Whether a plate that could not draw asks again as the network changes.
 * Only on the way back online: one that failed offline is asked for once
 * the phone is online (it may be already, if the failure was reported
 * after the connection came back), and one that failed online only when
 * the phone has been offline since and is back. So a print that fails
 * with a connection settles on COULDN’T SHOW THIS ONE instead of asking
 * again forever. One gone from the library waits for the library to
 * change, which retries every plate in trouble.
 */
export function asksAgain(trouble: PlateTrouble | null, wasOnline: boolean, online: boolean): boolean {
  if (trouble == null || trouble === "missing" || !online) return false;
  return trouble === "offline" || !wasOnline;
}
