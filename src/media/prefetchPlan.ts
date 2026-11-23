import type { PostRow } from "@/types/db";

/**
 * What Home fetches ahead of the reader, worked out apart from the image
 * library so it can be checked on its own (the fetching itself is
 * src/media/prefetch.ts).
 *
 * A card's photograph stands on its small copy (the grid's thumbnail,
 * PostMedia's placeholder) until the full frame is in. The list draws a
 * few cards ahead and each asks for both at once, so a card reached
 * quickly, or one past what the list has drawn yet, showed its paper
 * until the small copy came. Fetched ahead onto the disk, the small copies
 * of the next posts are there the moment their cards draw, and the next
 * photograph or two are on their way before the reader is.
 *
 * Only the next few posts, never the feed: as the reader moves on, the
 * next few after them, and nothing for what is behind.
 */

/** Posts after the one on screen whose small copy is fetched ahead. */
export const SMALL_AHEAD = 8;
/** Posts after the one on screen whose photograph itself is fetched ahead. */
export const LARGE_AHEAD = 2;
/** How many addresses are remembered as asked for already, so none is asked for twice. */
export const ASKED_MEMORY = 400;

type Media = Pick<PostRow, "media_type" | "media_path" | "thumb_path">;
type UrlOf = (bucket: "media" | "thumbnails", path: string | null) => string | null;

/** Only an address on the network is fetched ahead: a file on this phone, or a picture bundled with the app, is already here. */
export function isRemote(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

/**
 * The small copies and photographs to fetch for the posts after `index`
 * (the one on screen; -1 before any is): the small copies of the next
 * `small`, and the photographs of the next `large`. A film's photograph
 * is its film, which an image cannot hold; only its poster is fetched.
 */
export function aheadOf(
  posts: readonly Media[],
  index: number,
  urlOf: UrlOf,
  { small = SMALL_AHEAD, large = LARGE_AHEAD }: { small?: number; large?: number } = {},
): { small: string[]; large: string[] } {
  const from = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0) + 1);
  const out = { small: [] as string[], large: [] as string[] };
  const next = posts.slice(from, from + Math.max(small, large));
  next.forEach((post, i) => {
    if (i < small) {
      const thumb = urlOf("thumbnails", post.thumb_path);
      if (isRemote(thumb)) out.small.push(thumb);
    }
    if (i < large && post.media_type === "photo") {
      const photo = urlOf("media", post.media_path);
      if (isRemote(photo)) out.large.push(photo);
    }
  });
  return out;
}

/**
 * A memory of addresses already asked for, as long as `capacity` at most
 * (the oldest let go first). `fresh` hands back those of `urls` not asked
 * for yet, each once, and remembers them.
 */
export function askedOnce(capacity = ASKED_MEMORY): (urls: readonly string[]) => string[] {
  const asked = new Set<string>();
  return (urls) => {
    const out: string[] = [];
    for (const url of urls) {
      if (asked.has(url) || out.includes(url)) continue;
      out.push(url);
    }
    for (const url of out) {
      asked.add(url);
      if (asked.size > capacity) asked.delete(asked.values().next().value as string);
    }
    return out;
  };
}
