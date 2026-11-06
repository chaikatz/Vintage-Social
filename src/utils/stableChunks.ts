/**
 * The posts whose likes and comment previews a screen reads, in groups
 * that keep their members: each post stays in the group it was first read
 * in, so the group's request, and its answer in the cache, stays the same
 * however the screen's list of posts grows, shrinks or moves on.
 *
 * The screens used to key one read on every id they asked about, joined.
 * The feed asks about the stretch of cards around the reader (see
 * src/media/cardWindow.ts), and every move to the next stretch was a new
 * key: the likes and the comment previews of every card still in the
 * window were fetched and parsed again with the few new ones, request
 * after request, while the reader scrolled. Read in groups, a new page of
 * the feed reads its own posts and nothing else; a group the reader comes
 * back to is in the cache already.
 *
 * Ids new to the screen at the same time make one group, up to `size`
 * (a request's worth: IDS_PER_REQUEST in src/api/batch.ts), so a page
 * read at once is still one request. The book of who is in which group
 * is the screen's own, and is started afresh once it holds `remember`
 * ids, so it never grows without end over a very long scroll.
 */

/** Ids per group: one request of src/api/batch.ts. */
export const CHUNK_SIZE = 100;

/** Ids a screen's book holds before it starts again. */
export const CHUNK_BOOK_LIMIT = 2000;

/** Which group each id was put in, for one screen. */
export type ChunkBook = Map<string, readonly string[]>;

/**
 * The groups that hold `ids`, in the order their first id appears; ids not
 * yet in a group are put in new ones, in their own order, `size` at most
 * to a group. Each group is the same array for as long as the book keeps
 * it, so its key never changes.
 */
export function stableChunks(
  ids: readonly string[],
  book: ChunkBook,
  { size = CHUNK_SIZE, remember = CHUNK_BOOK_LIMIT }: { size?: number; remember?: number } = {},
): (readonly string[])[] {
  const per = Math.max(1, Math.floor(size));
  if (book.size + ids.length > remember) book.clear();
  const out: (readonly string[])[] = [];
  const included = new Set<readonly string[]>();
  const seen = new Set<string>();
  let fresh: string[] = [];
  const seal = () => {
    if (fresh.length === 0) return;
    const group = Object.freeze(fresh);
    for (const id of group) book.set(id, group);
    out.push(group);
    included.add(group);
    fresh = [];
  };
  for (const id of ids) {
    const group = book.get(id);
    if (group) {
      if (!included.has(group)) {
        out.push(group);
        included.add(group);
      }
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push(id);
    if (fresh.length >= per) seal();
  }
  seal();
  return out;
}
