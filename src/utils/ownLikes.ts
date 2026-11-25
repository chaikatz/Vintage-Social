/**
 * A photograph's likes are its author's to see, and nobody else's.
 *
 * Under your own photograph, on every surface that shows its actions (a
 * card on Home or in a gallery, the photograph's own page): how many
 * liked it, and a tap on that opens who did, newest first (app/likes.tsx).
 * Under anyone else's: nothing. No number, no list, nothing for VoiceOver
 * to read. The heart, the double tap and whether you liked it are the
 * same for everyone; only the count is the author's.
 *
 * The database holds the same line for who liked what: a member reads a
 * like only when it is their own or the photograph is theirs (0042).
 *
 * Your own photograph always has the line, so a card is the same height
 * before its first like as after: "No likes yet", quiet, until there is
 * one, and then the count in its place. A card that grew a line when the
 * first like came in pushed everything under it down.
 */

/** What the line under your own photograph says, and does. */
export interface LikesLine {
  /** On the page: "1 like", "12 likes", or "No likes yet". */
  text: string;
  /** What VoiceOver reads for it. */
  label: string;
  /** Whether a tap opens who liked it: only when someone has. */
  opens: boolean;
}

/** The words for no likes yet: quiet, in the line's own place. */
export const NO_LIKES_YET = "No likes yet";

/** Said once, above the names on the likers list (app/likes.tsx). */
export const LIKERS_NOTE = "Only you can see who liked your photograph.";

/** What VoiceOver adds to the count: where a tap goes, and who else sees it. */
export const LIKES_HINT = "Shows who liked it. Only you can see this.";

/**
 * Whether the reader is the photograph's author: the one member who sees
 * its likes. A reader not yet known (signed out, a session still being
 * read) is nobody's author.
 */
export function seesLikes(post: { author_id: string }, viewerId: string | null | undefined): boolean {
  return Boolean(viewerId) && post.author_id === viewerId;
}

/** "1 like", "12 likes". */
export function likesCount(count: number): string {
  const n = Math.max(0, Math.floor(count));
  return `${n} ${n === 1 ? "like" : "likes"}`;
}

/**
 * The line under a photograph for this reader, or null for none: the
 * count (which opens who liked it) or "No likes yet" for its author, and
 * nothing for anyone else. `count` is the one the screen holds, a like
 * still on its way included (usePostActions' likeCountFor).
 */
export function likesLine(
  post: { author_id: string },
  viewerId: string | null | undefined,
  count: number,
): LikesLine | null {
  if (!seesLikes(post, viewerId)) return null;
  if (!(count > 0)) return { text: NO_LIKES_YET, label: NO_LIKES_YET, opens: false };
  const text = likesCount(count);
  return { text, label: text, opens: true };
}
