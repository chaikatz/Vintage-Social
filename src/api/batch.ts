/**
 * Asking about many rows at once without asking too much in one request.
 *
 * A filter like `.in("post_id", ids)` travels in the request's URL, and
 * every hop between the phone and PostgREST has a ceiling on how long a
 * URL may be (commonly 8 KB; 16 KB at the most generous), past which the
 * request is refused (HTTP 414) rather than answered. A uuid costs 39
 * characters of it once the comma after it is encoded. So a list of a
 * few hundred ids - a long gallery, a feed scrolled far down, a busy
 * inbox - turned a read that worked yesterday into one that fails
 * outright, for that member only, once they had enough photographs or
 * friends. Every such list now goes in chunks of IDS_PER_REQUEST, a few
 * at a time, and the answers are put together.
 */

/** Ids per request: about 3.9 KB of URL, half the ceiling, with room for the rest. */
export const IDS_PER_REQUEST = 100;

/** Requests in flight at once for one list. */
export const CHUNKS_AT_ONCE = 4;

/** The list without repeats, in its first order, split into runs of `size`. */
export function chunked<T>(items: readonly T[], size = IDS_PER_REQUEST): T[][] {
  const unique = [...new Set(items)];
  const out: T[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}

/**
 * Ask `read` about each chunk of `ids`, at most CHUNKS_AT_ONCE at a time,
 * and give back every answer's rows, in chunk order. Any chunk failing
 * fails the whole read, as one request failing always did.
 */
export async function readInChunks<T, R>(
  ids: readonly T[],
  read: (chunk: T[]) => PromiseLike<R[]>,
  { size = IDS_PER_REQUEST, atOnce = CHUNKS_AT_ONCE }: { size?: number; atOnce?: number } = {},
): Promise<R[]> {
  const chunks = chunked(ids, size);
  const results: R[][] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const index = next++;
      results[index] = await read(chunks[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, chunks.length) }, worker));
  return results.flat();
}
