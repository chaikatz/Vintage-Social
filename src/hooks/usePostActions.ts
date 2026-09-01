import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { showAlert } from "@/utils/alert";
import { deleteOwnPost, fetchMyLikes, likePost, unlikePost } from "@/api/posts";
import type { PostWithAuthor } from "@/types/db";

/**
 * Liking and the "…" menu, shared by every surface that shows a post card:
 * the feed, a member's gallery, a single photograph.
 *
 * Likes are applied optimistically and rolled back if the write fails, so
 * a tap never waits on the network. The counts a caller renders come from
 * `likeCountFor`, which folds the optimistic delta into the stored count.
 */
export function usePostActions(userId: string, postIds: string[]) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const likesQuery = useQuery({
    queryKey: ["my-likes", userId, postIds.join(",")],
    queryFn: () => fetchMyLikes(userId, postIds),
    enabled: Boolean(userId) && postIds.length > 0,
  });

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [deltas, setDeltas] = useState<Record<string, number>>({});

  const isLiked = useCallback(
    (post: { id: string }) => overrides[post.id] ?? likesQuery.data?.has(post.id) ?? false,
    [overrides, likesQuery.data],
  );

  const likeCountFor = useCallback(
    (post: { id: string; like_count: number }) =>
      Math.max(0, post.like_count + (deltas[post.id] ?? 0)),
    [deltas],
  );

  const toggleLike = useCallback(
    async (post: PostWithAuthor, next: boolean) => {
      setOverrides((o) => ({ ...o, [post.id]: next }));
      setDeltas((d) => ({ ...d, [post.id]: (d[post.id] ?? 0) + (next ? 1 : -1) }));
      try {
        if (next) await likePost(userId, post.id);
        else await unlikePost(userId, post.id);
      } catch {
        setOverrides((o) => ({ ...o, [post.id]: !next }));
        setDeltas((d) => ({ ...d, [post.id]: (d[post.id] ?? 0) + (next ? -1 : 1) }));
      }
    },
    [userId],
  );

  /**
   * Your own post can be deleted; anyone else's can be reported. Nothing is
   * removed automatically — an admin reviews every report by hand.
   */
  const onMore = useCallback(
    (post: PostWithAuthor, afterDelete?: () => void) => {
      if (post.author_id === userId) {
        showAlert("Your post", undefined, [
          {
            text: "Delete post",
            style: "destructive",
            onPress: async () => {
              await deleteOwnPost(post.id);
              queryClient.invalidateQueries({ queryKey: ["feed"] });
              queryClient.invalidateQueries({ queryKey: ["user-posts"] });
              afterDelete?.();
            },
          },
          { text: "Cancel", style: "cancel" },
        ]);
      } else {
        showAlert(post.author.username, undefined, [
          {
            text: "Report post",
            style: "destructive",
            onPress: () =>
              router.push({ pathname: "/report", params: { targetType: "post", postId: post.id } }),
          },
          { text: "Cancel", style: "cancel" },
        ]);
      }
    },
    [userId, router, queryClient],
  );

  return { isLiked, likeCountFor, toggleLike, onMore };
}
