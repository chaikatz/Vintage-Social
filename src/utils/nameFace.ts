import { useFeedLayout, type FeedLayout } from "@/utils/feedLayout";

/**
 * Editorial (Preview): members' usernames, not bold.
 *
 * While the feed is Editorial, every username the app draws as a name (a
 * row in a list, the name before a caption, a comment or a notice, a chip,
 * a sheet) is drawn as it is under Original, in the app's own face, size,
 * colour and spacing, except that where it is bold there it is regular.
 * Where a place marks a name for a state of its own, the state still wins:
 * an unread thread's name is bold again, the author of a photograph sent in
 * your own dark bubble keeps the bubble's light ink, and a member tagged
 * who has not yet accepted stays faint and regular. A bar's title is
 * regular already, so it is left as it is. Under Original nothing changes:
 * a name bold there stays bold.
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
