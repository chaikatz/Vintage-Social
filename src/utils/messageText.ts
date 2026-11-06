import type { MessageRow } from "@/types/db";

/**
 * What a message says when the photograph it carried cannot be shown.
 *
 * A message is words, a photograph, or both. The photograph can go after
 * it was sent: its author deletes it (the message then keeps its place
 * with neither, migration 0021), a moderator removes it, or it is hidden
 * from the reader by privacy or a block. A message with words still has
 * those to show. One without would be an empty bubble with a time on it,
 * so it says this instead. The words are neutral because the reader is
 * not always allowed to know which of those it was.
 */
export const PHOTOGRAPH_UNAVAILABLE = "This photograph is no longer available.";

/**
 * A message with no words whose photograph the reader cannot see: it shows
 * `PHOTOGRAPH_UNAVAILABLE`. Only null says so: undefined is a photograph
 * whose read failed, and nothing is said of it until it is read.
 */
export function photographUnavailable(message: { body: string; post: unknown }): boolean {
  return message.post === null && !message.body;
}

/**
 * The inbox's line for a thread's last message. The inbox has no
 * photographs to hand, only the row: a post_id still set is a photograph
 * that was sent, and none with no words can only be one that has gone.
 */
export function inboxPreview(last: Pick<MessageRow, "body" | "post_id"> | null): string {
  if (!last) return "Say something.";
  if (last.body) return last.body;
  return last.post_id ? "Sent a photograph" : PHOTOGRAPH_UNAVAILABLE;
}

/**
 * The newest message in a thread, oldest first as it is read, from the
 * other member and not yet seen by the reader: what opening it has to
 * mark read, or null when there is nothing to mark (no write, and no new
 * read of the inbox and its badge after it).
 *
 * The message, not only whether there is one: a second message that
 * arrives before the thread's next read shows the first marked is
 * another message to mark. Taken as a yes or no, the answer stayed yes
 * across both, the mark was never written again, and the second stayed
 * unread, on the badge too, while the member was looking at it.
 */
export function newestUnreadFrom(
  messages: readonly Pick<MessageRow, "id" | "sender_id" | "read_at">[] | undefined,
  readerId: string,
): string | null {
  if (!readerId || !messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.sender_id !== readerId && !m.read_at) return m.id;
  }
  return null;
}
