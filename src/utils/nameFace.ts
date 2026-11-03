import { type } from "@/theme";
import { useFeedLayout, type FeedLayout } from "@/utils/feedLayout";

/**
 * Editorial (Preview): members' usernames in the print's typewriter face.
 *
 * While the feed is Editorial, every username the app draws as a name (a
 * bar's title, a row in a list, the bold name before a caption, a comment
 * or a notice, a chip, a sheet, the sentence an empty page says about a
 * member) is set in the face the print sets its credit in
 * (`@chai · MEMBER NO. 00001`, src/components/ExportCard.tsx): type.mono,
 * in its regular weight, as the print sets it — a name that was bold is
 * set regular. Only the face and its weight change. Size, colour, spacing
 * and layout stay as each place sets them, and under Original nothing
 * changes: a name bold there stays bold.
 *
 * Display names, what a member types, and what they wrote (captions,
 * comments, messages) keep their own face.
 *
 * Part of the trial, and meant to come out with it: EDITORIAL_FEED_PREVIEW.md
 * lists every place that reads it.
 */

/** The face and weight a name takes; appended last, so it overrides a bold the place sets. */
type NameFace = { fontFamily: string; fontWeight: "400" };

const MONO: NameFace = { fontFamily: type.mono, fontWeight: "400" };

/** Appended to a name's style: the typewriter face, regular, under Editorial, and nothing at all under Original. */
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
 * title in the serif at 17 pt (headerTitleStyle in app/_layout.tsx); a
 * screen's own headerTitleStyle replaces that whole, so this carries the
 * same size and changes the face alone, set regular as every name is.
 * Under Original it is the stack's own style, so a title set while
 * Editorial was on goes back with it.
 */
type TitleStyle = { fontFamily: string; fontSize: number; fontWeight?: "400" };

const TITLES: Record<FeedLayout, TitleStyle> = {
  original: { fontFamily: type.serif, fontSize: 17 },
  editorial: { fontFamily: type.mono, fontSize: 17, fontWeight: "400" },
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
