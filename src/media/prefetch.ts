import { Image } from "expo-image";
import { mediaUrlString } from "@/api/media";
import type { PostRow } from "@/types/db";
import { aheadOf, askedOnce } from "./prefetchPlan";

/**
 * Fetching Home's next pictures ahead of the reader (see ./prefetchPlan.ts
 * for which). Onto the disk only: a picture not on screen is not held
 * decoded in memory, and the card that draws it reads it from the disk
 * at once. Each address is asked for once; the image library fetches
 * ahead at a lower priority than what is on screen, so nothing the reader
 * is looking at waits behind it. It has no way to call a fetch off, so a
 * reader who moves on simply stops being fetched for: what is already
 * asked is a few small files, and finishes into the disk cache.
 */

type Media = Pick<PostRow, "media_type" | "media_path" | "thumb_path">;

const fresh = askedOnce();

function fetchOnce(urls: readonly string[]): void {
  const out = fresh(urls);
  if (out.length === 0) return;
  try {
    void Image.prefetch(out, "disk").catch(() => undefined);
  } catch {
    // Only a head start: the cards fetch their own pictures as ever.
  }
}

/** The next posts' small copies and the next photograph or two, after the post at `index` on screen. */
export function prefetchAhead(posts: readonly Media[], index: number): void {
  const { small, large } = aheadOf(posts, index, mediaUrlString);
  fetchOnce(small);
  fetchOnce(large);
}

/** The most new posts whose small copies are fetched ahead: a page's worth. */
const NEW_SMALL_MOST = 12;

/**
 * New posts waiting behind the "New posts" tag: their small copies, and
 * the first one's photograph, so a tap shows them at once. As few as
 * there are, never more than a page.
 */
export function prefetchNewPosts(posts: readonly Media[]): void {
  const { small, large } = aheadOf(posts, -1, mediaUrlString, { small: Math.min(posts.length, NEW_SMALL_MOST), large: 1 });
  fetchOnce(small);
  fetchOnce(large);
}
