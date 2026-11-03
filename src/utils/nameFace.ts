import { type } from "@/theme";
import { useFeedLayout, type FeedLayout } from "@/utils/feedLayout";

/**
 * Editorial (Preview): members' usernames in the print's typewriter face.
 *
 * While the feed is Editorial, every username the app draws as a name (a
 * bar's title, a row in a list, the bold name before a caption, a comment
 * or a notice, a chip, a sheet) is set in the face the print sets its
 * credit in (`@chai · MEMBER NO. 00001`, src/components/ExportCard.tsx):
 * type.mono. Only the face changes. Size, weight, colour, spacing and
 * layout stay as each place sets them, and under Original nothing changes.
 *
 * Display names, what a member types, and what they wrote (captions,
 * comments, messages) keep their own face.
 *
 * Part of the trial, and meant to come out with it: EDITORIAL_FEED_PREVIEW.md
 * lists every place that reads it.
 */

const MONO = { fontFamily: type.mono };

/** Appended to a name's style: the typewriter face under Editorial, and nothing at all under Original. */
export function nameFace(layout: FeedLayout): { fontFamily: string } | undefined {
  return layout === "editorial" ? MONO : undefined;
}

/** The name face for the layout in effect, redrawn the moment Settings changes it. */
export function useNameFace(): { fontFamily: string } | undefined {
  return nameFace(useFeedLayout());
}

/**
 * A bar's title, where the title is a username. The app's stack sets every
 * title in the serif at 17 pt (headerTitleStyle in app/_layout.tsx); a
 * screen's own headerTitleStyle replaces that whole, so this carries the
 * same size and changes the face alone. Under Original it is the stack's
 * own style, so a title set while Editorial was on goes back with it.
 */
const TITLES: Record<FeedLayout, { fontFamily: string; fontSize: number }> = {
  original: { fontFamily: type.serif, fontSize: 17 },
  editorial: { fontFamily: type.mono, fontSize: 17 },
};

export function nameTitleStyle(layout: FeedLayout): { fontFamily: string; fontSize: number } {
  return TITLES[layout];
}

/**
 * The title style for the layout in effect. `isName` is false where the
 * same bar is sometimes titled with something else (an era's gallery), so
 * that title keeps the stack's own serif.
 */
export function useNameTitleStyle(isName = true): { fontFamily: string; fontSize: number } {
  const layout = useFeedLayout();
  return nameTitleStyle(isName ? layout : "original");
}
