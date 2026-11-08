import { router } from "expo-router";
import { deleteOwnComment } from "@/api/posts";
import { removeComment } from "@/api/moderation";
import { showAlert } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
import type { CommentRow } from "@/types/db";

/**
 * Press and hold on a comment: the one menu, wherever the comment is
 * shown. On the Comments screen, and under a photograph in the feed, in a
 * member's gallery and on the photograph's own page, where a press and
 * hold used to open Comments on release instead (App Review is told to
 * press and hold a comment to report it).
 *
 * Your own comment, or anyone's for an admin, is removed after one more
 * tap, and `removed` then puts the screens right. Anyone else's is
 * reported: nothing is removed automatically, an admin reviews every
 * report by hand.
 */
export function showCommentMenu(
  comment: Pick<CommentRow, "id" | "author_id">,
  viewer: { userId: string; isAdmin: boolean },
  removed: () => void,
): void {
  const own = comment.author_id === viewer.userId;
  if (own || viewer.isAdmin) {
    showAlert("Comment", undefined, [
      {
        text: own ? "Delete comment" : "Remove comment (admin)",
        style: "destructive",
        onPress: async () => {
          try {
            if (own) await deleteOwnComment(comment.id);
            else await removeComment(comment.id, "Removed from the comments view");
          } catch (err) {
            showAlert("Couldn’t remove the comment", errorMessage(err, "It’s still there. Try again in a moment."));
            return;
          }
          removed();
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  } else {
    showAlert("Comment", undefined, [
      {
        text: "Report comment",
        style: "destructive",
        onPress: () =>
          router.push({
            pathname: "/report",
            params: { targetType: "comment", commentId: comment.id },
          }),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }
}
