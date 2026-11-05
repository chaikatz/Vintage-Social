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
