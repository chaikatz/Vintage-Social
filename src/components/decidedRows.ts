/**
 * A list of things waiting on a decision (follow requests, reports), as a
 * screen shows it while decisions are on their way to the server.
 *
 * A decided row leaves the list the moment it is tapped, so it cannot be
 * decided twice: a follow request used to stay on screen with both of its
 * buttons live until the list was read again, and Accept then Decline in
 * quick succession deleted the follow just accepted. A refused decision
 * puts back that row alone. Putting back the whole list as it was before
 * the tap would also bring back the rows decided since, which the server
 * had taken.
 */

/**
 * The rows to draw: any with a decision still on its way are left out.
 *
 * Taking a row out of the cached list is not enough on its own. Another
 * decision that settles first reads the list again, and if that read
 * reaches the server before this decision does, it brings the row back
 * with its buttons live, to be decided a second time.
 */
export function undecided<T extends { id: string }>(rows: T[] | undefined, deciding: ReadonlySet<string>): T[] {
  const list = rows ?? [];
  return deciding.size ? list.filter((r) => !deciding.has(r.id)) : list;
}

/** The ids with a decision on its way, with these added. */
export function withIds(deciding: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> {
  const next = new Set(deciding);
  for (const id of ids) next.add(id);
  return next;
}

/** The ids with a decision on its way, without these. */
export function withoutIds(deciding: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> {
  if (!ids.some((id) => deciding.has(id))) return deciding;
  const next = new Set(deciding);
  for (const id of ids) next.delete(id);
  return next;
}

/** The list without the row being decided. */
export function withoutRow<T extends { id: string }>(rows: T[] | undefined, id: string): T[] | undefined {
  return rows?.filter((r) => r.id !== id);
}

/** The list with a refused row back in its place in `order` (or at the end), once. */
export function withRowBack<T extends { id: string }>(rows: T[] | undefined, row: T, order?: readonly string[]): T[] | undefined {
  if (!rows) return rows;
  if (rows.some((r) => r.id === row.id)) return rows;
  const next = [...rows, row];
  if (!order) return next;
  const at = new Map(order.map((id, i) => [id, i]));
  return next.sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity));
}
