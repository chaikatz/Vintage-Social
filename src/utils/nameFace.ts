import { Platform } from "react-native";
import { type } from "@/theme";
import { useFeedLayout, type FeedLayout } from "@/utils/feedLayout";

/**
 * Editorial (Preview): members' usernames in Cormorant Garamond.
 *
 * While the feed is Editorial, every username the app draws (a row in a
 * list, the name before a caption, a comment or a notice, an @name in what
 * a member wrote, a chip, a sheet, a bar titled with one) is set in
 * Cormorant Garamond Bold Italic, the face the owner chose for the names
 * (24 November; in its bold once the owner had seen build 56), in the
 * place's own colour. Under Original nothing changes at all.
 *
 * Its size follows one rule. Cormorant's small letters are short (its
 * x-height is 0.386 of its size), so a name set at the size of the words
 * around it would look a size smaller than them. A name is set at the size
 * of the words it sits beside, or of the words it stands in for where it
 * stands alone, times NAME_SCALE, to the half point: the 16 pt names over
 * the 12.5 pt words of the editorial card, the owner's pairing (24
 * November), wherever a name is drawn.
 *
 * Every name is in the one cut: a place that marks a name heavier for a
 * state (an unread thread's) marks it there by other means, its ink and
 * what is around it.
 *
 * Part of the trial, and meant to come out with it: EDITORIAL_FEED_PREVIEW.md
 * lists every place that reads it.
 */

/**
 * The cut, a font file of its own in assets/fonts (SIL Open Font License,
 * assets/fonts/CormorantGaramond-OFL.txt), built into the iPhone app by
 * expo-font's plugin in app.json and found there by its PostScript name. It
 * is bold and italic in itself, so no style is ever set over it.
 */
const FAMILY = "CormorantGaramond-BoldItalic";

/**
 * The web build has no plugin, so there the cut is loaded once, here, the
 * first time anything that draws a name is loaded; a failure is let go (the
 * browser draws its own serif until the file arrives).
 */
if (Platform.OS === "web") {
  require("expo-font")
    .loadAsync({ [FAMILY]: require("../../assets/fonts/CormorantGaramond-BoldItalic.ttf") })
    .catch(() => {});
}

/** A name's size over the size of the words it sits beside: 16 pt names over 12.5 pt words. */
export const NAME_SCALE = 16 / 12.5;

/** The size of a name beside words of `size` points: NAME_SCALE times it, to the half point. */
export function nameSize(size: number): number {
  return Math.round(size * NAME_SCALE * 2) / 2;
}

/**
 * The weight a name is drawn at is the one that lands on the cut, laid over
 * whatever weight the place's own style had (a semibold username, an unread
 * thread's, a regular one), so that weight never picks another font or a
 * faked bold:
 * - on the iPhone, the cut's own, 700. The phone takes a PostScript name to
 *   its family and draws the family's cut nearest the weight asked for, as
 *   italic as the named one (React Native's RCTFont): the bold italic itself.
 * - on the web, regular. There the cut is a family of its own, registered
 *   without a weight, that is, regular; a heavier weight would be faked over it.
 */
const WEIGHT = Platform.OS === "web" ? "400" : "700";

/**
 * How far the face's ink reaches past the width each character a username
 * can hold (a-z, 0-9, "." and "_": USERNAME_RE) is set in, in thousandths
 * of its size, where it reaches a hundredth of it or more: to the left of
 * where the character begins, and to the right of where the next one does.
 * An italic leans out of its letters' widths: the f's and the j's tails
 * reach in under the letter before, the f's hook out over the one after.
 * On the iPhone a Text draws nothing outside its own box, and its box is as
 * wide as its letters' widths and starts where the first one does (React
 * Native's RCTTextLayoutManager sets a line with no margin of its own), so
 * what reaches past a name's first or last letter is cut off there unless
 * the box is given room for it. tests/editorial-name-room.test.ts reads
 * every figure here from the font file, and what reaches less (the 2's
 * thousandth, the l's) from it too.
 */
const REACH: Record<"left" | "right", Readonly<Record<string, number>>> = {
  left: { f: 128, j: 114, y: 78, p: 73, g: 51, "3": 42, "5": 32, "9": 28, "7": 20, x: 13, z: 13, "4": 13, _: 12 },
  right: { f: 149, "6": 30, d: 26, z: 17, k: 14, r: 13, g: 12, t: 11 },
};

/** The farthest any of them reaches, either way: the f's hook. */
const FARTHEST = Math.max(...Object.values(REACH.left), ...Object.values(REACH.right));

/**
 * The room a name that stands alone in its Text is given on each side, in
 * points, beside words of `size`: the farthest any letter reaches at the
 * name's size, to the whole point above, so the box's edges, and the name
 * inside it, stay on the pixels they were on.
 */
export function nameRoom(size: number): number {
  return Math.ceil((nameSize(size) * FARTHEST) / 1000);
}

/**
 * A name's face: the cut, its size, and the weight that lands on that cut;
 * and, for a name that stands alone in its Text (a row's, a chip's, a
 * header's, a title), the room its letters reach into: the box grows by
 * nameRoom on each side, as padding, and gives the same back as a negative
 * margin, so the letters, and everything around the Text, stay exactly
 * where they were while the tails are drawn inside it.
 */
export type NameStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: "400" | "700";
  paddingHorizontal?: number;
  marginHorizontal?: number;
  lineHeight?: number;
};

const STYLES = new Map<string, NameStyle>();

/**
 * A name beside words of `size` points, standing alone in its Text or not:
 * always the face, whatever the layout (the editorial card, drawn only under
 * Editorial, sets its names with it). The same object for the same size, so
 * nothing redraws for it alone.
 */
export function nameStyle(size: number, alone?: "alone"): NameStyle {
  const key = `${size}${alone ? " alone" : ""}`;
  let style = STYLES.get(key);
  if (style == null) {
    const room = nameRoom(size);
    style = alone
      ? { ...nameStyle(size), paddingHorizontal: room, marginHorizontal: -room }
      : { fontFamily: FAMILY, fontSize: nameSize(size), fontWeight: WEIGHT };
    STYLES.set(key, style);
  }
  return style;
}

/**
 * The face of the names a place draws: given the size of the words a name
 * sits beside (or stands in for), and "alone" where the name is all its Text
 * holds, the style laid last over the name's own, after the place's and any
 * state's, so that its family, size and weight are the name's and the
 * place's colour stays. Under Original it is nothing at all, so a style
 * array is exactly what it was.
 */
export type NameFace = (size: number, alone?: "alone") => NameStyle | undefined;

const EDITORIAL: NameFace = (size, alone) => nameStyle(size, alone);
const ORIGINAL: NameFace = () => undefined;

/** The face of the names for a layout. */
export function nameFace(layout: FeedLayout): NameFace {
  return layout === "editorial" ? EDITORIAL : ORIGINAL;
}

/** The face of the names for the layout in effect, redrawn the moment Settings changes it. */
export function useNameFace(): NameFace {
  return nameFace(useFeedLayout());
}

/**
 * A name inside a line of words cannot be given room by its box: the line
 * is the box, and a line that holds a link to a member is never padded
 * (tests/name-link-hit-area.test.ts). Where such a name begins the line (a
 * caption's, a comment's or a notice's author, a sentence that starts with
 * the name), its first letter's reach is made room for by NAME_EDGE, a
 * no-break narrow space, laid before it in the face at the size that makes
 * it exactly as wide as the letter reaches: the name moves over by that,
 * and no more, and its tail is drawn inside the line. The same after a name
 * that ends a Text sized to its words, for its last letter's reach to the
 * right. Nothing where the letter does not reach out, as most do not.
 */
export const NAME_EDGE = " ";

/** NAME_EDGE's width in the face, in thousandths of its size (the test reads it from the file). */
const EDGE_WIDTH = 200;

/**
 * Its line, on the web, none: there a line's set height is handed down to
 * each span in it, and a span in a smaller face sits lower in that height
 * than the name beside it, so a line led by NAME_EDGE would grow a pixel.
 * The iPhone sets a line's height for the paragraph as a whole, by its
 * largest face (React Native's RCTApplyBaselineOffset), so nothing is set
 * there.
 */
const EDGE_LINE = Platform.OS === "web" ? { lineHeight: 0 } : undefined;

const EDGES = new Map<string, NameStyle | undefined>();

/**
 * What NAME_EDGE is drawn in, on the `side` of a name beside words of
 * `size`, or nothing where the letter on that side does not reach out.
 */
export function nameEdge(size: number, name: string, side: "left" | "right"): NameStyle | undefined {
  const letter = (side === "left" ? name[0] : name[name.length - 1]) ?? "";
  const key = `${side} ${letter} ${size}`;
  if (!EDGES.has(key)) {
    const reach = REACH[side][letter];
    EDGES.set(key, reach ? { fontFamily: FAMILY, fontSize: (nameSize(size) * reach) / EDGE_WIDTH, fontWeight: WEIGHT, ...EDGE_LINE } : undefined);
  }
  return EDGES.get(key);
}

/**
 * A bar's title, where the title is a username (a pushed profile, an
 * author's gallery, a message thread, the Profile tab).
 *
 * Under Original it is the stack's own style, exactly app/_layout.tsx's
 * (the serif at 17 pt, which the stack lays over its own title face, bold
 * on the iPhone), so the title is drawn as it always was. Under Editorial
 * the username is in the names' face at the size that matches that title,
 * nameStyle(17), whose weight also replaces the stack's bold underneath, on
 * a line of TITLE_LINE, standing alone: with the room its letters reach
 * into, which the app draws itself (NameTitle, in
 * src/components/NameTitle.tsx), since the bar's own label would cut it.
 *
 * It is handed over under Original too, never left out: a screen's options
 * are merged into the ones it set before, so a title left without one after
 * Settings turns Editorial off would keep Editorial's face (and one handed
 * `undefined` would lose the stack's serif).
 */
export type TitleStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight?: NameStyle["fontWeight"];
  lineHeight?: number;
  paddingHorizontal?: number;
  marginHorizontal?: number;
};

/** The size of every bar's title (app/_layout.tsx), and of the Profile tab's, which the app draws itself. */
const TITLE_SIZE = 17;

/**
 * The line a username's title is set on under Editorial: a little taller
 * than the face's own at 22 pt (1.211 of it, 26.6), so its long descenders
 * (the q, the italic f) are never cut where a title is held to one line,
 * as the web holds the bar's, on a line it rounds down to 26.
 */
const TITLE_LINE = 28;

const TITLES: Record<FeedLayout, TitleStyle> = {
  original: { fontFamily: type.serif, fontSize: TITLE_SIZE },
  editorial: { ...nameStyle(TITLE_SIZE, "alone"), lineHeight: TITLE_LINE },
};

export function nameTitleStyle(layout: FeedLayout): TitleStyle {
  return TITLES[layout];
}

/**
 * The title style for the layout in effect. `isName` is false where the
 * same bar is sometimes titled with something else (an era's gallery, the
 * Profile tab before the member's username is known), so that title keeps
 * the stack's own.
 */
export function useNameTitleStyle(isName = true): TitleStyle {
  const layout = useFeedLayout();
  return nameTitleStyle(isName ? layout : "original");
}
