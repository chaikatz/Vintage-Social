/**
 * What a report is about, for the admins' queue.
 *
 * Several members can report the same photograph or comment, and each
 * report is its own row. Removing the content sends its author a notice
 * every time it is asked (admin_remove_post writes one per call), so once
 * one report's Remove has gone through, the others on the same thing are
 * closed with it rather than removed again.
 */

interface ReportRef {
  id: string;
  post_id: string | null;
  comment_id: string | null;
}

/**
 * The thing a removal acts on, as the queue chooses it: the photograph
 * when there is one, otherwise the comment. Null for a report about a
 * member, which has nothing to remove.
 */
export function removalTarget(report: Pick<ReportRef, "post_id" | "comment_id">): string | null {
  if (report.post_id) return `post:${report.post_id}`;
  if (report.comment_id) return `comment:${report.comment_id}`;
  return null;
}

/** The other reports in the list about the same photograph or comment. */
export function sameTarget<T extends ReportRef>(rows: readonly T[] | undefined, report: ReportRef): T[] {
  const target = removalTarget(report);
  if (!target || !rows) return [];
  return rows.filter((r) => r.id !== report.id && removalTarget(r) === target);
}
