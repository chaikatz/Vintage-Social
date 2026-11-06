import type { InfiniteData } from "@tanstack/react-query";
import { withRowBack, withoutRow } from "@/components/decidedRows";

/**
 * An admin queue (applications, reports) as the screen holds it: pages of
 * fifty rows (src/api/moderation.ts), read one after another as the admin
 * scrolls. A queue used to be read as one page of fifty and offered no
 * more, so the fifty-first application waited unseen.
 *
 * A row decided on the screen leaves whichever page holds it, and a
 * refused decision puts it back in the page it came from, in its place,
 * so the pages stay the pages the server gave: the next page starts after
 * the last row of the one before (nextAdminCursor), and a row put back in
 * another page would be drawn out of order, or twice.
 */
export type QueuePages<T> = InfiniteData<T[], unknown>;

/** Every row held, page after page, each once (a page read again can overlap the next). */
export function rowsOf<T extends { id: string }>(data: QueuePages<T> | undefined): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of data?.pages ?? []) {
    for (const row of page) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

/** The pages without these rows. */
export function withoutRows<T extends { id: string }>(
  data: QueuePages<T> | undefined,
  ids: readonly string[],
): QueuePages<T> | undefined {
  if (!data || !ids.length) return data;
  return { ...data, pages: data.pages.map((page) => ids.reduce((p, id) => withoutRow(p, id) ?? p, page)) };
}

/** The page each of these rows is in, by id: where it goes back if its decision is refused. */
export function pagesOf<T extends { id: string }>(
  data: QueuePages<T> | undefined,
  ids: readonly string[],
): Record<string, number> {
  const homes: Record<string, number> = {};
  (data?.pages ?? []).forEach((page, i) => {
    for (const row of page) if (ids.includes(row.id) && !(row.id in homes)) homes[row.id] = i;
  });
  return homes;
}

/**
 * The pages with refused rows back, each in the page it came from (the
 * first, if that page is no longer held), in its place in `order`, once.
 */
export function withRowsBack<T extends { id: string }>(
  data: QueuePages<T> | undefined,
  rows: readonly T[],
  order: readonly string[],
  homes: Readonly<Record<string, number>>,
): QueuePages<T> | undefined {
  if (!data || !data.pages.length) return data;
  const held = new Set(rowsOf(data).map((r) => r.id));
  const pages = [...data.pages];
  for (const row of rows) {
    if (held.has(row.id)) continue;
    const home = homes[row.id];
    const at = home != null && home < pages.length ? home : 0;
    pages[at] = withRowBack(pages[at], row, order) ?? pages[at];
    held.add(row.id);
  }
  return { ...data, pages };
}
