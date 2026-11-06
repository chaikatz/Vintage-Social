import type { CommentWithAuthor, PostWithAuthor } from "@/types/db";

/**
 * What a list hands its cards, kept the same object from one draw to the
 * next while nothing in it has changed.
 *
 * The feed card is drawn again only when something it shows changes
 * (PostCard is a memo). That holds only if what it is given is the same
 * object when nothing has changed: a post spread into a new object on
 * every draw, a fresh empty list for a post with no comments, or a new
 * arrow for a tap, each make every card on screen draw again whenever
 * the list does, and the list draws again every time a different card
 * comes on screen. On Home that was every card the list held, each time
 * the reader moved from one photograph to the next.
 */

/** The one empty list of comments, for every card that has none. */
export const NO_COMMENTS: CommentWithAuthor[] = Object.freeze([]) as unknown as CommentWithAuthor[];

/** A card's comments, or the shared empty list when there are none. */
export function commentsOrNone(comments: CommentWithAuthor[] | undefined): CommentWithAuthor[] {
  return comments && comments.length > 0 ? comments : NO_COMMENTS;
}

/**
 * The post as its card shows it, with the like count the screen holds
 * (its own count and any like still on its way): the same object as last
 * time for as long as the row and the count are the same. One per list.
 */
export function likeCounted(): (post: PostWithAuthor, likeCount: number) => PostWithAuthor {
  const kept = new Map<string, { from: PostWithAuthor; count: number; shown: PostWithAuthor }>();
  return (post, likeCount) => {
    const last = kept.get(post.id);
    if (last && last.from === post && last.count === likeCount) return last.shown;
    const shown = post.like_count === likeCount ? post : { ...post, like_count: likeCount };
    kept.set(post.id, { from: post, count: likeCount, shown });
    return shown;
  };
}
