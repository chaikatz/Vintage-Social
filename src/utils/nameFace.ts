import { Platform } from "react-native";
import { type } from "@/theme";
import { useFeedLayout, type FeedLayout } from "@/utils/feedLayout";

/**
 * Editorial (Preview): members' usernames in Cormorant Garamond.
 *
 * While the feed is Editorial, every username the app draws (a row in a
 * list, the name before a caption, a comment or a notice, an @name in what
 * a member wrote, a chip, a sheet, a bar titled with one) is set in
 * Cormorant Garamond Medium Italic, the face the owner chose for the names
 * on the editorial card (24 November), in the place's own colour. Under
 * Original nothing changes at all.
 *
 * Its size follows one rule. Cormorant's small letters are short (its
 * x-height is 0.386 of its size), so a name set at the size of the words
 * around it would look a size smaller than them. A name is set at the size
 * of the words it sits beside, or of the words it stands in for where it
 * stands alone, times NAME_SCALE, to the half point: the 16 pt names over
 * the 12.5 pt words of the editorial card, the owner's pairing (24
 * November), wherever a name is drawn.
 *
 * Where a place marks a name heavier for a state (an unread thread's name),
 * the name is drawn in the face's heavier cut, Cormorant Garamond SemiBold
 * Italic, rather than a weight laid over the medium.
 *
 * Part of the trial, and meant to come out with it: EDITORIAL_FEED_PREVIEW.md
 * lists every place that reads it.
 */

/**
 * The two cuts, each a font file of its own in assets/fonts (SIL Open Font
 * License, assets/fonts/CormorantGaramond-OFL.txt), built into the iPhone
 * app by expo-font's plugin in app.json and found there by its PostScript
 * name; each is italic in itself, so no style is ever set over it.
 */
const CUTS = {
  medium: { family: "CormorantGaramond-MediumItalic", weight: "500" },
  semibold: { family: "CormorantGaramond-SemiBoldItalic", weight: "600" },
} as const;

export type NameCut = keyof typeof CUTS;

/**
 * The web build has no plugin, so there both cuts are loaded once, here,
 * the first time anything that draws a name is loaded; a failure is let go
 * (the browser draws its own serif until the file arrives).
 */
if (Platform.OS === "web") {
  require("expo-font")
    .loadAsync({
      [CUTS.medium.family]: require("../../assets/fonts/CormorantGaramond-MediumItalic.ttf"),
      [CUTS.semibold.family]: require("../../assets/fonts/CormorantGaramond-SemiBoldItalic.ttf"),
    })
    .catch(() => {});
}

/** A name's size over the size of the words it sits beside: 16 pt names over 12.5 pt words. */
export const NAME_SCALE = 16 / 12.5;

/** The size of a name beside words of `size` points: NAME_SCALE times it, to the half point. */
export function nameSize(size: number): number {
  return Math.round(size * NAME_SCALE * 2) / 2;
}

/** A name's face: the cut, its size, and the weight that lands on that cut. */
export type NameStyle = { fontFamily: string; fontSize: number; fontWeight: "400" | "500" | "600" };

/**
 * The weight a name is drawn at is the one that lands on its cut, laid over
 * whatever weight the place's own style had (a semibold username, a regular
 * one), so that weight never picks another cut or a faked bold:
 * - on the iPhone, the cut's own weight. The phone draws the cut of the
 *   family nearest the weight asked for (React Native's RCTFont), so the
 *   medium is asked for at 500 and the semibold at 600: each is itself.
 * - on the web, regular. There each cut is a family of its own, registered
 *   without a weight, that is, regular; a heavier weight would be faked
 *   over it by the browser.
 */
function weightOf(cut: NameCut): NameStyle["fontWeight"] {
  return Platform.OS === "web" ? "400" : CUTS[cut].weight;
}

const STYLES = new Map<string, NameStyle>();

/**
 * A name beside words of `size` points, in the given cut: always the face,
 * whatever the layout (the editorial card, drawn only under Editorial, sets
 * its names with it). The same object for the same size and cut, so nothing
 * redraws for it alone.
 */
export function nameStyle(size: number, cut: NameCut = "medium"): NameStyle {
  const key = `${cut} ${size}`;
  let style = STYLES.get(key);
  if (style == null) {
    style = { fontFamily: CUTS[cut].family, fontSize: nameSize(size), fontWeight: weightOf(cut) };
    STYLES.set(key, style);
  }
  return style;
}

/**
 * The face of the names a place draws: given the size of the words a name
 * sits beside (or stands in for), and the cut a state of the place asks
 * for, the style laid last over the name's own, after the place's and any
 * state's, so that its family, size and weight are the name's and the
 * place's colour stays. Under Original it is nothing at all, so a style
 * array is exactly what it was.
 */
export type NameFace = (size: number, cut?: NameCut) => NameStyle | undefined;

const EDITORIAL: NameFace = (size, cut) => nameStyle(size, cut);
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
 * A bar's title, where the title is a username (a pushed profile, an
 * author's gallery, a message thread).
 *
 * Under Original it is the stack's own style, exactly app/_layout.tsx's
 * (the serif at 17 pt, which the stack lays over its own title face, bold
 * on the iPhone), so the title is drawn as it always was. Under Editorial
 * the username is in the names' face at the size that matches that title,
 * nameStyle(17), whose weight also replaces the stack's bold underneath, on
 * a line of TITLE_LINE.
 *
 * It is handed over under Original too, never left out: a screen's options
 * are merged into the ones it set before, so a title left without one after
 * Settings turns Editorial off would keep Editorial's face (and one handed
 * `undefined` would lose the stack's serif).
 */
export type TitleStyle = { fontFamily: string; fontSize: number; fontWeight?: NameStyle["fontWeight"]; lineHeight?: number };

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
  editorial: { ...nameStyle(TITLE_SIZE), lineHeight: TITLE_LINE },
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
