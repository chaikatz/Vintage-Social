/**
 * Where everything sits on the room's page, derived from the window and
 * the safe area alone, so a print's well is the right size before a
 * single pixel of it arrives and nothing moves when they do.
 *
 * On the reference phone (393 × 852, insets 59/34) the running head runs
 * from 59 to 103, DEVELOP's block from 762 to 810, and the stage between
 * them is 659 high; on an SE (375 × 667, insets 20/0) it is 531. The
 * screen lays these out with flex and measures the stage; the numbers
 * here are what it is measured against.
 *
 * At the end are the plate's two other rules that need no screen: how far
 * the caption's presses reach, and what a plate that cannot draw its
 * photograph decides about asking again.
 *
 * Pure, so the tests can hold the plate to its sizes.
 */
import type { PlateTrouble } from "./words";

/** The running head's height; a minimum, so it grows with Dynamic Type. */
export const HEAD_HEIGHT = 44;
/** DEVELOP's block; a minimum for the same reason. */
export const DEVELOP_HEIGHT = 48;
/** DEVELOP's block stands this far above the bottom inset (or 16, without one). */
export const DEVELOP_LIFT = 8;
export const MIN_BOTTOM_INSET = 16;
/** The plate keeps this far from each side of the page. */
export const PLATE_GUTTER = 16;
/** The caption hangs this far under the plate. */
export const CAPTION_GAP = 14;
/** Room kept above the group, and below it. */
const ABOVE = 12;
const BELOW = 20;
/** The group sits this far above true centre: the optical centre of a page. */
const OPTICAL_LIFT = 12;
const MIN_TOP = 8;
/** A caption is never narrower than this, even under a narrow print. */
export const MIN_CAPTION_WIDTH = 240;

/** The stage between the running head and DEVELOP, for a window and its insets. */
export function stageFrame(height: number, insets: { top: number; bottom: number }): { top: number; height: number } {
  const top = insets.top + HEAD_HEIGHT;
  const bottom = height - Math.max(insets.bottom, MIN_BOTTOM_INSET) - DEVELOP_LIFT - DEVELOP_HEIGHT;
  return { top, height: Math.max(0, bottom - top) };
}

/**
 * The caption's height, the gap above it included:
 * `14 + round(14·s1) + 6 + round(20·s2)·L`, where s1 and s2 are the font
 * scale capped as the two lines cap it (1.5 and 2.0), and L is the number
 * of lines the second line takes. 54 at the default size. The page
 * confirms it by measuring, and refits when it differs.
 */
export function captionHeight(fontScale: number, lines: 1 | 2): number {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const s1 = Math.min(scale, 1.5);
  const s2 = Math.min(scale, 2);
  return CAPTION_GAP + Math.round(14 * s1) + 6 + Math.round(20 * s2) * lines;
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
 * width less its gutters, and the stage less the room above, the caption
 * and the room below. Rounded to the screen's pixels.
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
  const maxH = Math.max(1, stageHeight - ABOVE - caption - BELOW);
  const w = Math.min(maxW, maxH * r);
  return { width: toPixel(w, pixelRatio), height: toPixel(w / r, pixelRatio) };
}

/** The plate and its caption, centred in the stage as one group, a little above true centre. */
export function groupTop(stageHeight: number, plateHeight: number, caption: number): number {
  return Math.max(MIN_TOP, (stageHeight - plateHeight - caption) / 2 - OPTICAL_LIFT);
}

/** The caption runs flush with the plate's edges, and never narrower than 240. */
export function captionWidth(plateWidth: number): number {
  return Math.max(plateWidth, MIN_CAPTION_WIDTH);
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
 * and the progress slot now let touches through.)
 *
 * The date reaches up to the plate's edge and down over the line
 * beneath: 44 at the default type size and more as the type grows. Below
 * the default its press keeps a minimum height of 44, which leaves the
 * 14 pt the row is held to anyway, so nothing moves. The word at the
 * right (SET ASIDE) is set smaller, in 10 pt Courier with no line height
 * of its own: about 11 pt tall, and 9.3 at the smallest Dynamic Type
 * size. So it reaches further down, and its reach and letters make 44 at
 * every size without its minimum height ever taking effect, which would
 * move the word when it has a row of its own.
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
 * Whether a plate that could not draw asks again as the network changes.
 * Only on the way back online: one that failed offline is asked for once
 * the phone is online (it may be already, if the failure was reported
 * after the connection came back), and one that failed online only when
 * the phone has been offline since and is back. So a print that fails
 * with a connection settles on COULDN’T SHOW THIS ONE instead of asking
 * again forever. One gone from the library waits for the library to
 * change, which retries every plate in trouble.
 */
/**
 * What a failure is called once the phone goes offline: one that looked
 * like the image's own fault while the phone was online (or before it
 * knew) may just as well be iCloud's, and it will be asked again when the
 * phone is back — so it says IN ICLOUD meanwhile, not "Try it again later".
 */
export function troubleOffline(trouble: PlateTrouble | null, wasOnline: boolean, online: boolean): PlateTrouble | null {
  return trouble === "other" && wasOnline && !online ? "offline" : trouble;
}

export function asksAgain(trouble: PlateTrouble | null, wasOnline: boolean, online: boolean): boolean {
  if (trouble == null || trouble === "missing" || !online) return false;
  return trouble === "offline" || !wasOnline;
}
