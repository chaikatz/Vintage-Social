import { mediaUrl } from "@/api/media";
import { cssFilterFor } from "@/filters/cssFilter";
import { getFilter } from "@/filters/presets";
import { needsDisplayFilter } from "@/utils/displayFilter";
import { memoryHeadline, onThisDay } from "@/utils/memories";
import type { PostRow } from "@/types/db";

/**
 * The one print the Post tab's On this day line may carry: a photograph
 * the member posted, taken on this date in an earlier year, kept apart
 * from the screen so it can be tested without a phone.
 *
 * It is drawn from what the member has already posted, never from the
 * phone's library, and drawn the way the profile grid draws its squares:
 * the thumbnail, or a film's poster frame (the film itself is a movie,
 * which an image cannot draw), with the film's look applied only where
 * the picture was not baked with it.
 */
export interface TodaysPrint {
  id: string;
  /** "3 years ago today, you were in Lisbon." — the sentence On this day itself leads with. */
  headline: string;
  /** What an image can draw, or null when there is nothing to draw and the line goes alone. */
  source: string | number | null;
  /** The film's look as a CSS filter, where the picture still needs it. */
  filter: string | null;
}

/**
 * The newest year's memory, and its picture. When that year's post has
 * nothing to draw (a film posted before posters were made) an older year
 * that has one is shown instead, so the line and the print are always
 * the same photograph. Null when today has no memory: the line keeps its
 * ordinary words and nothing else is drawn.
 */
export function todaysPrint(
  posts: readonly PostRow[] | null | undefined,
  today: Date = new Date(),
): TodaysPrint | null {
  if (!posts || posts.length === 0) return null;
  const memories = onThisDay([...posts], today);
  if (memories.length === 0) return null;
  const drawn = memories.map((m) => ({ m, source: printSource(m.post) }));
  const { m, source } = drawn.find((d) => d.source != null) ?? drawn[0];
  return {
    id: m.post.id,
    headline: memoryHeadline(m),
    source,
    filter: source != null && needsDisplayFilter(m.post) ? cssFilterFor(getFilter(m.post.filter_id)).filter : null,
  };
}

/** The grid's rule for a square: a film shows only its poster; a photograph its thumbnail, else itself. */
export function printSource(post: Pick<PostRow, "media_type" | "media_path" | "thumb_path">): string | number | null {
  if (post.media_type === "video") return mediaUrl("thumbnails", post.thumb_path);
  return mediaUrl("thumbnails", post.thumb_path) ?? mediaUrl("media", post.media_path);
}
