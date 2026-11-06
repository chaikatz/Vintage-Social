/**
 * Rows that name a member the reader may not see.
 *
 * A post, a comment or a tag is read with the member it belongs to joined
 * in (`author`, `member`). Row-level security can let the row through and
 * keep the member back: a profile is read only while its member is in
 * good standing (approved or suspended, migration 0003) and never by
 * someone they have blocked (0018). The row then comes back naming nobody,
 * and drawing `post.author.username` threw, which replaced the whole page
 * with the recover page. These say which rows can be drawn; the rest are
 * left out, as the comments screen already leaves out a comment whose
 * author cannot be seen.
 */

/** Whether the post's author came back with it, so the post can say whose it is. */
export function authorShown(row: { author?: unknown }): boolean {
  return row.author != null;
}

/** The rows whose author came back with them: comments under a photograph. */
export function withAuthors<T extends { author?: unknown }>(rows: readonly T[]): T[] {
  return rows.filter(authorShown);
}

/** The tags whose member came back with them: "with …" under a photograph. */
export function withMembers<T extends { member?: unknown }>(tags: readonly T[]): T[] {
  return tags.filter((tag) => tag.member != null);
}
