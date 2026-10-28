import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { removePostEverywhere, rewritePostEverywhere } from "@/utils/postCache";
import { showAlert } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
import { perfLog, shortId } from "@/utils/perf";
import { deleteOwnPost, fetchCommentPreviews, fetchMyLikes, likePost, unlikePost } from "@/api/posts";
import { blockMember } from "@/api/blocks";
import { notePostDeleted } from "@/uploads";
import { INLINE_COMMENTS } from "@/components/PostCard";
import { useSession } from "@/providers/SessionProvider";
import type { CommentWithAuthor, PostWithAuthor } from "@/types/db";

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
  const { refreshProfile } = useSession();

  const likesQuery = useQuery({
    queryKey: ["my-likes", userId, postIds.join(",")],
    queryFn: () => fetchMyLikes(userId, postIds),
    enabled: Boolean(userId) && postIds.length > 0,
    // A new page means a new key; the hearts already drawn keep their state
    // while the wider answer arrives instead of blinking to outline.
    placeholderData: keepPreviousData,
  });

  const previewsQuery = useQuery({
    queryKey: ["comment-previews", postIds.join(",")],
    queryFn: () => fetchCommentPreviews(postIds, INLINE_COMMENTS),
    enabled: postIds.length > 0,
    placeholderData: keepPreviousData,
  });

  const commentsFor = useCallback(
    (post: { id: string }): CommentWithAuthor[] => previewsQuery.data?.[post.id] ?? [],
    [previewsQuery.data],
  );

  // Comments open on their own screen. Pushing the post again would show
  // the photograph you are already looking at and shove the conversation
  // off the bottom.
  // The next screen asks for this same post by id. Handing it the row we
  // already hold means it draws at once and only re-reads in the background.
  const seed = useCallback(
    (post: PostWithAuthor) => queryClient.setQueryData(["post", post.id], post),
    [queryClient],
  );

  const onOpenComments = useCallback(
    (post: PostWithAuthor) => {
      seed(post);
      router.push({ pathname: "/comments", params: { postId: post.id } });
    },
    [router, seed],
  );

  const onShare = useCallback(
    (post: PostWithAuthor) => {
      seed(post);
      router.push({ pathname: "/share", params: { postId: post.id } });
    },
    [router, seed],
  );

  // The names behind the count, for your own photographs only. On anyone
  // else's the count stays a number.
  const onOpenLikes = useCallback(
    (post: PostWithAuthor) => {
      if (post.author_id !== userId) return;
      router.push({ pathname: "/likes", params: { postId: post.id, authorId: post.author_id } });
    },
    [router, userId],
  );

  const onOpenPost = useCallback(
    (post: PostWithAuthor) => {
      seed(post);
      router.push(`/post/${post.id}`);
    },
    [router, seed],
  );

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

  // The delta carries the like only while the write is in flight. Once it
  // lands, the count is written into every cached copy of the post and the
  // delta is dropped — otherwise the next refetch, whose count already
  // includes the like, had the delta added on top and showed one too many.
  // The set of liked ids is rewritten the same way, so the heart holds on
  // every screen that shows this post.
  const toggleLike = useCallback(
    async (post: PostWithAuthor, next: boolean) => {
      const step = next ? 1 : -1;
      setOverrides((o) => ({ ...o, [post.id]: next }));
      setDeltas((d) => ({ ...d, [post.id]: (d[post.id] ?? 0) + step }));
      try {
        if (next) await likePost(userId, post.id);
        else await unlikePost(userId, post.id);
        rewritePostEverywhere<PostWithAuthor>(queryClient, post.id, (p) => ({
          ...p,
          like_count: Math.max(0, p.like_count + step),
        }));
        queryClient.setQueriesData<Set<string>>({ queryKey: ["my-likes", userId] }, (liked) => {
          if (!liked) return liked;
          const copy = new Set(liked);
          if (next) copy.add(post.id);
          else copy.delete(post.id);
          return copy;
        });
        setDeltas((d) => ({ ...d, [post.id]: (d[post.id] ?? 0) - step }));
      } catch {
        setOverrides((o) => ({ ...o, [post.id]: !next }));
        setDeltas((d) => ({ ...d, [post.id]: (d[post.id] ?? 0) - step }));
      }
    },
    [userId, queryClient],
  );

  /**
   * Your own post deleted, for good, once the server says so. The outbox
   * lets go of anything it still holds for it, then the post leaves every
   * screen at once and the screen it was deleted from closes.
   *
   * A refusal leaves everything as it was and says so in the member's
   * words; the database's own stay in the development log.
   */
  const deletePost = useCallback(
    async (post: PostWithAuthor, afterDelete?: () => void) => {
      const what = post.media_type === "video" ? "clip" : "photograph";
      try {
        await deleteOwnPost(post.id);
      } catch (err) {
        const e = err as { code?: unknown; status?: unknown } | null;
        perfLog("post delete failed", { id: shortId(post.id), code: e?.code ?? null, status: e?.status ?? null });
        showAlert(`Couldn’t delete this ${what}`, errorMessage(err, "Nothing was removed. Try again in a moment."));
        return;
      }
      notePostDeleted(post.id);
      afterDelete?.();
      void removePostEverywhere(queryClient, post.id);
      refreshProfile().catch(() => undefined);
    },
    [queryClient, refreshProfile],
  );

  /**
   * Your own post can be deleted, after one question; anyone else's can be
   * reported. Nothing is removed automatically — an admin reviews every
   * report by hand.
   */
  const onMore = useCallback(
    (post: PostWithAuthor, afterDelete?: () => void) => {
      if (post.author_id === userId) {
        const what = post.media_type === "video" ? "clip" : "photograph";
        showAlert("Your post", undefined, [
          {
            text: "Edit caption",
            onPress: () => {
              seed(post);
              router.push({ pathname: "/edit-caption", params: { postId: post.id } });
            },
          },
          {
            text: "Delete post",
            style: "destructive",
            onPress: () =>
              showAlert(
                `Delete this ${what}?`,
                "It’s removed for good. A message it was sent in says it’s no longer available.",
                [
                  { text: "Delete", style: "destructive", onPress: () => void deletePost(post, afterDelete) },
                  { text: "Cancel", style: "cancel" },
                ],
              ),
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
          {
            text: `Block ${post.author.username}`,
            style: "destructive",
            onPress: () =>
              showAlert(
                `Block ${post.author.username}?`,
                "They won't see your photographs or profile, and you won't see theirs. You can unblock from Settings.",
                [
                  {
                    text: "Block",
                    style: "destructive",
                    onPress: async () => {
                      try {
                        await blockMember(post.author_id);
                        queryClient.invalidateQueries();
                      } catch (err) {
                        showAlert("That didn’t work", errorMessage(err, "Try again in a moment."));
                      }
                    },
                  },
                  { text: "Cancel", style: "cancel" },
                ],
              ),
          },
          { text: "Cancel", style: "cancel" },
        ]);
      }
    },
    [userId, router, queryClient, seed, deletePost],
  );

  return { isLiked, likeCountFor, toggleLike, onMore, onShare, onOpenComments, onOpenPost, onOpenLikes, commentsFor };
}
