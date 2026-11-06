/**
 * Reading a list a page at a time, each page after the last row of the
 * one before (a keyset), rather than after however many rows came before
 * it (an offset). A row added or removed between two pages then neither
 * repeats one nor skips one, and a page deep in a long list starts where
 * it is, through the list's index, instead of reading every row above it.
 *
 * The rows are ordered newest first by a time, ties broken by an id,
 * descending both; the cursor is the time and id of the last row held,
 * exactly as the server gave them (a time remade through a Date loses its
 * microseconds, and the rows in between).
 */

/** Where the next page starts: the last row held. */
export type Cursor = { at: string; id: string };

/**
 * A value as PostgREST's or=() must have it when it holds "," "." ":" or
 * parentheses (an ISO time holds "." and ":"): in double quotes, a double
 * quote or backslash inside escaped.
 */
export function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/** The filters of the rows after `cursor`, for a query's or=(). */
export function afterCursor(timeColumn: string, idColumn: string, cursor: Cursor): string {
  const at = quoted(cursor.at);
  return `${timeColumn}.lt.${at},and(${timeColumn}.eq.${at},${idColumn}.lt.${quoted(cursor.id)})`;
}

/**
 * The rows after `cursor` on a PostgREST query: `time <= at` on its own,
 * which an index on the time can start from, and the exact condition.
 * Shaped as a generic over the two methods it calls, so it fits any
 * table's query builder.
 */
export function pageAfter<Q extends { lte(column: string, value: string): Q; or(filters: string): Q }>(
  query: Q,
  timeColumn: string,
  idColumn: string,
  cursor: Cursor | null | undefined,
): Q {
  if (!cursor) return query;
  return query.lte(timeColumn, cursor.at).or(afterCursor(timeColumn, idColumn, cursor));
}
