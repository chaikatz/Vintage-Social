import { DynamicColorIOS, Platform, type ColorValue } from "react-native";
import { type } from "@/theme";
import { useFeedLayout, type FeedLayout } from "@/utils/feedLayout";

/**
 * Editorial (Preview): members' usernames set as the print sets its credit.
 *
 * While the feed is Editorial, every username the app draws as a name (a
 * bar's title, a row in a list, the name before a caption, a comment or a
 * notice, a chip, a sheet, the sentence an empty page says about a member)
 * is set the way the print sets its credit (`@chai · MEMBER NO. 00001`,
 * src/components/ExportCard.tsx): in type.mono, tracked 0.08 em, in the
 * grey the credit reads in on the print (PRINT_GREY), and bold, which the
 * member chose over the print's regular so the name holds its own beside
 * the words after it. Each name keeps its own size and its place. Where a place marks a name for a state of its own
 * (an unread thread, a photograph sent in your own dark bubble), the state's
 * colour and weight still win, and the name keeps the face and the
 * tracking. Under Original nothing changes: a name bold and dark there
 * stays so.
 *
 * Display names, what a member types, and what they wrote (captions,
 * comments, messages) keep their own face.
 *
 * Part of the trial, and meant to come out with it: EDITORIAL_FEED_PREVIEW.md
 * lists every place that reads it.
 */

/**
 * The print tracks its credit 0.08 em (src/utils/exportLayout.ts: the
 * credit's spacing is its size times 0.08). React Native tracks in points,
 * and a name is set at 13 to 15 pt nearly everywhere, so a name takes the
 * credit's tracking at 14 pt, 0.08 × 14 ≈ 1.1 pt: within a tenth of a point
 * of 0.08 em at 13 or 15 pt, and within a quarter at the 11 to 16 pt of the
 * few places set smaller or larger.
 */
const NAME_TRACKING = 1.1;

/**
 * The grey the print's credit reads in. The print sets it in inkFaint, a
 * warm tan, but a credit 9 pt high, saved as a JPEG, comes out a neutral,
 * silvery grey: the fine strokes lose their colour to the paper around
 * them. A name at its own size in the app keeps every bit of a warm ink,
 * so it takes the grey the print shows instead, measured off a member's
 * print. In the dark appearance, the same grey a step lighter, as the
 * dark print's faint ink is.
 */
export const PRINT_GREY = { light: "#A29E97", dark: "#ACA7A0" } as const;
export const NAME_INK: ColorValue = Platform.OS === "ios" ? DynamicColorIOS(PRINT_GREY) : PRINT_GREY.light;

/**
 * The face, weight, tracking and ink a name takes. A place puts it after
 * its own style, so it overrides the weight and ink the place sets, and
 * before a state's style, so the state still wins.
 */
type NameFace = { fontFamily: string; fontWeight: "700"; letterSpacing: number; color: ColorValue };

const MONO: NameFace = { fontFamily: type.mono, fontWeight: "700", letterSpacing: NAME_TRACKING, color: NAME_INK };

/** Added to a name's style: the print's credit, at the name's own size, under Editorial, and nothing at all under Original. */
export function nameFace(layout: FeedLayout): NameFace | undefined {
  return layout === "editorial" ? MONO : undefined;
}

/** The name face for the layout in effect, redrawn the moment Settings changes it. */
export function useNameFace(): NameFace | undefined {
  return nameFace(useFeedLayout());
}

/** What stands in for the name while a sentence is cut at it: a character no text holds. */
const STAND_IN = "\u0000";

/**
 * A sentence the app writes with a member's username in it (an empty
 * page's), as the words around the name, so the name can be drawn in its
 * face between each pair. `write` is the sentence's own writer, given a
 * stand-in for the name, so the cut is where the writer puts the name, and
 * never where the same letters happen to fall in the words around it.
 */
export function aroundName(write: (name: string) => string): string[] {
  return write(STAND_IN).split(STAND_IN);
}

/**
 * A bar's title, where the title is a username. The app's stack sets every
 * title in the serif at 17 pt (headerTitleStyle in app/_layout.tsx), in the
 * bar's tint; a screen's own headerTitleStyle replaces that whole, so this
 * carries the same size and sets the name as every name is set: the
 * typewriter face, bold, tracked 0.08 em at 17 pt (0.08 × 17 = 1.36 pt),
 * in the print's grey. The ink is the title's own colour, which the stack
 * takes over the bar's tint (react-native-screens draws it as the title's
 * colour on iOS). The bar on iOS is the system's own, and react-native-screens
 * hands it a title's face, size, weight and colour but no tracking, so there
 * a pushed screen's title is set untracked; the web's bar, and the Profile
 * tab's title, which the app draws itself, are tracked.
 * Under Original it is the stack's own style, with no colour of its own, so
 * a title set while Editorial was on goes back to the bar's tint with it.
 */
type TitleStyle = { fontFamily: string; fontSize: number; fontWeight?: "700"; letterSpacing?: number; color?: string };

const TITLES: Record<FeedLayout, TitleStyle> = {
  original: { fontFamily: type.serif, fontSize: 17 },
  // The stack types a title's colour as a string; a dynamic colour is handed on as one, as the bar's tint is (app/_layout.tsx).
  editorial: { fontFamily: type.mono, fontSize: 17, fontWeight: "700", letterSpacing: 1.36, color: NAME_INK as unknown as string },
};

export function nameTitleStyle(layout: FeedLayout): TitleStyle {
  return TITLES[layout];
}

/**
 * The title style for the layout in effect. `isName` is false where the
 * same bar is sometimes titled with something else (an era's gallery), so
 * that title keeps the stack's own serif.
 */
export function useNameTitleStyle(isName = true): TitleStyle {
  const layout = useFeedLayout();
  return nameTitleStyle(isName ? layout : "original");
}
