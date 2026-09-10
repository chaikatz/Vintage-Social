/**
 * The order a gallery reads in once a square has been tapped.
 *
 * The obvious way — render the whole grid's worth of cards and scroll to
 * the tapped one — is how the wrong photograph kept opening. Post cards
 * have no fixed height (the frame's aspect ratio and the caption both
 * vary), so the list can only estimate where an index lands, and the
 * estimate tends to overshoot into the card below. There is no honest
 * `getItemLayout` to give it.
 *
 * So the list is rotated instead: the tapped post is the first row, the
 * ones after it follow in the grid's order, and the ones before it come
 * round at the end. Nothing is scrolled to, so nothing can miss — the
 * photograph you tapped is the photograph at the top, every time, keyed by
 * its id rather than its position.
 */
export function startAt<T extends { id: string }>(posts: T[], id: string | null | undefined): T[] {
  if (!id) return posts;
  const index = posts.findIndex((p) => p.id === id);
  if (index <= 0) return posts;
  return [...posts.slice(index), ...posts.slice(0, index)];
}
