import { getFilter } from "@/filters/presets";
import type { FilterSpec } from "@/filters/types";
import { needsDisplayFilter } from "@/utils/displayFilter";
import type { PostRow } from "@/types/db";

/**
 * What On this day draws for one of its memories.
 *
 * A memory is drawn the width of the page at 4:5. Its grid square, the
 * thumbnail, is 540 px on its short side (src/uploads/thumbSize.ts), and a
 * 3x phone's page is 1,170 to 1,320 px across, so drawn from the thumbnail
 * a memory was soft however it was cut. It is drawn from the photograph
 * itself, as the feed draws it, with the thumbnail, usually on disk
 * already from the member's grid, standing in while the photograph
 * arrives.
 *
 * The page holds every memory of the day at once, above its list, rather
 * than as rows drawn as they scroll into view. Decoded, a photograph costs
 * four to six times what its thumbnail does: 1,152 × 1,440 px for one
 * posted from the phone (1,440 on its long side), and at most the size it
 * is drawn, 1,320 × 1,650 on the widest phone, for a larger one, which the
 * image view scales down as it decodes; a thumbnail is 540 × 675. So the
 * photograph is asked for by the first SHARP_MEMORIES only, and any after
 * them keep their thumbnail as before.
 * The most any member has from one day today is 6, and 99 in 100 of the
 * days with any have 4 or fewer (production, November 2026): every memory
 * anyone has now is drawn sharp, and a day with many more costs at most
 * SHARP_MEMORIES photographs' worth over what it cost before.
 *
 * A film's file is a movie, which an image cannot draw: it keeps its
 * poster frame, the thumbnail, and nothing stands in for it.
 *
 * A picture that was not baked with its film (needsDisplayFilter: a
 * photograph the darkroom could not bake, a film from before films were
 * baked, the demo's and the house's photographs) has its look laid over
 * it on screen, by the same rule the feed, the grid and the photograph's
 * own page follow, so a memory looks like the photograph it opens.
 */
export const SHARP_MEMORIES = 6;

export interface MemoryPicture<U> {
  /** What the image draws, or null for nothing to draw. */
  source: U | null;
  /** What stands in while `source` arrives, or null for nothing. */
  placeholder: U | null;
  /** The film's look, to lay over a picture not baked with it; null when it is in the pixels already. */
  look: FilterSpec | null;
}

/**
 * The picture for the memory at `index` (0 for the first on the page).
 * `url` is mediaUrl, passed in so this stays free of the storage client.
 */
export function memoryPicture<U>(
  post: Pick<PostRow, "media_type" | "media_path" | "thumb_path" | "filter_id" | "filter_baked">,
  index: number,
  url: (bucket: "media" | "thumbnails", path: string | null) => U | null,
): MemoryPicture<U> {
  const look = needsDisplayFilter(post) ? getFilter(post.filter_id) : null;
  const small = url("thumbnails", post.thumb_path);
  if (post.media_type === "video") return { source: small, placeholder: null, look };
  const photo = index < SHARP_MEMORIES ? url("media", post.media_path) : null;
  if (photo == null) return { source: small ?? url("media", post.media_path), placeholder: null, look };
  return { source: photo, placeholder: small != null && small !== photo ? small : null, look };
}
