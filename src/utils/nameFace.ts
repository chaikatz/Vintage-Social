import { type } from "@/theme";
import { useFeedLayout, type FeedLayout } from "@/utils/feedLayout";

/**
 * Editorial (Preview): members' usernames, not bold.
 *
 * While the feed is Editorial, every username the app draws as a name (a
 * bar's title, a row in a list, the name before a caption, a comment or a
 * notice, a chip, a sheet) is drawn as it is under Original, in the app's
 * own face, size, colour and spacing, except that where it is bold there it
 * is regular. Where a place marks a name for a state of its own, the state
 * still wins: an unread thread's name is bold again, the author of a
 * photograph sent in your own dark bubble keeps the bubble's light ink, and
 * a member tagged who has not yet accepted stays faint and regular. Under
 * Original nothing changes: a name bold there stays bold.
 *
 * Part of the trial, and meant to come out with it: EDITORIAL_FEED_PREVIEW.md
 * lists every place that reads it.
 */
type NameFace = { fontWeight: "400" };

const REGULAR: NameFace = { fontWeight: "400" };

/**
 * Added to a name's style, after the place's own and before any state's:
 * regular under Editorial, and nothing at all under Original.
 */
export function nameFace(layout: FeedLayout): NameFace | undefined {
  return layout === "editorial" ? REGULAR : undefined;
}

/** The name face for the layout in effect, redrawn the moment Settings changes it. */
export function useNameFace(): NameFace | undefined {
  return nameFace(useFeedLayout());
}

/**
 * A bar's title, where the title is a username (a pushed profile, an
 * author's gallery, a message thread).
 *
 * Such a title is bold on the phone. The stack sets every title in the
 * serif at 17 pt (headerTitleStyle in app/_layout.tsx), but lays that over
 * its own title face, which on iOS is the system's bold, weight 600
 * (@react-navigation/native-stack's useHeaderConfigProps flattens
 * `[Platform.select({ ios: fonts.bold, default: fonts.medium }),
 * headerTitleStyle]`). The serif replaces the family and keeps the weight,
 * so the bar draws the serif's bold cut. (On the web the same underlay is
 * the stack's medium, 500.) Under Editorial the name's title is the same
 * serif at the same size, regular.
 *
 * Under Original it is the stack's own style, exactly app/_layout.tsx's, so
 * the title is drawn as it always was. It is handed over under Original too,
 * never left out: a screen's options are merged into the ones it set
 * before, so a title left without one after Settings turns Editorial off
 * would keep Editorial's weight (and one handed `undefined` would lose the
 * stack's serif).
 */
type TitleStyle = { fontFamily: string; fontSize: number; fontWeight?: "400" };

const TITLES: Record<FeedLayout, TitleStyle> = {
  original: { fontFamily: type.serif, fontSize: 17 },
  editorial: { fontFamily: type.serif, fontSize: 17, fontWeight: "400" },
};

export function nameTitleStyle(layout: FeedLayout): TitleStyle {
  return TITLES[layout];
}

/**
 * The title style for the layout in effect. `isName` is false where the
 * same bar is sometimes titled with something else (an era's gallery), so
 * that title keeps the stack's own.
 */
export function useNameTitleStyle(isName = true): TitleStyle {
  const layout = useFeedLayout();
  return nameTitleStyle(isName ? layout : "original");
}
