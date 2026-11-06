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

/**
 * The filters of the rows after `cursor`, for a query's or=(): older (or
 * as old, with a smaller id) for a list newest first; newer for one
 * oldest first.
 */
export function afterCursor(timeColumn: string, idColumn: string, cursor: Cursor, ascending = false): string {
  const at = quoted(cursor.at);
  const past = ascending ? "gt" : "lt";
  return `${timeColumn}.${past}.${at},and(${timeColumn}.eq.${at},${idColumn}.${past}.${quoted(cursor.id)})`;
}

/**
 * The rows after `cursor` on a PostgREST query: the time on its own
 * (`time <= at`, or `>=` oldest first), which an index on the time can
 * start from, and the exact condition. Shaped as a generic over the
 * methods it calls, so it fits any table's query builder.
 */
export function pageAfter<
  Q extends { lte(column: string, value: string): Q; gte(column: string, value: string): Q; or(filters: string): Q },
>(query: Q, timeColumn: string, idColumn: string, cursor: Cursor | null | undefined, ascending = false): Q {
  if (!cursor) return query;
  const bounded = ascending ? query.gte(timeColumn, cursor.at) : query.lte(timeColumn, cursor.at);
  return bounded.or(afterCursor(timeColumn, idColumn, cursor, ascending));
}

/** Two rows' (time, id) in the order the server reads them, oldest first. */
function compareKeys(a: Cursor, b: Cursor): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * The demo's lists, in the order and a page at a time as the server reads
 * them: sorted by (time, id), newest first unless `ascending`, and each
 * page starting at the first row past the cursor, by the same rule as
 * `afterCursor`, whether or not the cursor's own row is still in the list.
 * (Finding the cursor's row by its id started the list again from the top
 * once that row had left it, and every row came round twice.)
 */
export function demoKeysetPage<T>(rows: T[], keyOf: (row: T) => Cursor, cursor: Cursor | null | undefined, size: number, ascending = false): T[] {
  const sorted = [...rows].sort((a, b) => (ascending ? 1 : -1) * compareKeys(keyOf(a), keyOf(b)));
  if (!cursor) return sorted.slice(0, size);
  const start = sorted.findIndex((row) => (ascending ? 1 : -1) * compareKeys(keyOf(row), cursor) > 0);
  return start === -1 ? [] : sorted.slice(start, start + size);
}
