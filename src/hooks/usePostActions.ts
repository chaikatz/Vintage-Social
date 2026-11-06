import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useQueries, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { removePostEverywhere, rewritePostEverywhere } from "@/utils/postCache";
import { showAlert } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
import { perfLog, shortId } from "@/utils/perf";
import { stableChunks, type ChunkBook } from "@/utils/stableChunks";
import { deleteOwnPost, fetchCommentPreviews, fetchMyLikes, likePost, unlikePost } from "@/api/posts";
import { blockMember } from "@/api/blocks";
import { holdPost, notePostDeleted } from "@/uploads";
import { INLINE_COMMENTS } from "@/components/PostCard";
import { useSession } from "@/providers/SessionProvider";
import { useEraEdits } from "@/hooks/useEraEdits";
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
  // Your own eras can be arranged from any of your photographs once your
  // arrangement has been read and there is somewhere to keep a change.
  const erasReady = useEraEdits(userId).data?.ready === true;

  // Read in groups that keep their posts (src/utils/stableChunks.ts): a new
  // page of the feed reads its own posts only, and the hearts and previews
  // already drawn stay as they are, their groups unchanged in the cache.
  const book = useRef<ChunkBook>(new Map());
  const chunks = useMemo(() => stableChunks(postIds, book.current), [postIds]);

  const liked = useQueries({
    queries: chunks.map((ids) => ({
      queryKey: ["my-likes", userId, ids.join(",")],
      queryFn: () => fetchMyLikes(userId, [...ids]),
      enabled: Boolean(userId),
    })),
    combine: likedIn,
  });

  const previews = useQueries({
    queries: chunks.map((ids) => ({
      queryKey: ["comment-previews", ids.join(",")],
      queryFn: () => fetchCommentPreviews([...ids], INLINE_COMMENTS),
    })),
    combine: previewsIn,
  });

  const commentsFor = useCallback(
    (post: { id: string }): CommentWithAuthor[] => previews[post.id] ?? [],
    [previews],
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
    (post: { id: string }) => overrides[post.id] ?? liked.has(post.id),
    [overrides, liked],
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
   * While the server is asked, the outbox sends no insert for the post: a
   * retry sent meanwhile could land after the delete and put it back.
   *
   * A refusal leaves everything as it was and says so in the member's
   * words; the database's own stay in the development log.
   */
  const deletePost = useCallback(
    async (post: PostWithAuthor, afterDelete?: () => void) => {
      const what = post.media_type === "video" ? "clip" : "photograph";
      holdPost(post.id, true);
      try {
        await deleteOwnPost(post.id);
      } catch (err) {
        holdPost(post.id, false);
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
   * Your own post can be deleted, after one question, or added to one of
   * your eras (the same sheet as on your Eras page, opened over this one);
   * anyone else's can be reported. Nothing is removed automatically — an
   * admin reviews every report by hand.
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
          ...(erasReady
            ? [{ text: "Add to an era…", onPress: () => router.push({ pathname: "/era-move", params: { postId: post.id } }) }]
            : []),
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
        // A member row-level security hides from the reader comes back as
        // no author; a tap handler that threw on it would close the app.
        const name = post.author?.username ?? "this member";
        showAlert(name, undefined, [
          {
            text: "Report post",
            style: "destructive",
            onPress: () =>
              router.push({ pathname: "/report", params: { targetType: "post", postId: post.id } }),
          },
          {
            text: `Block ${name}`,
            style: "destructive",
            onPress: () =>
              showAlert(
                `Block ${name}?`,
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
    [userId, router, queryClient, seed, deletePost, erasReady],
  );

  return { isLiked, likeCountFor, toggleLike, onMore, onShare, onOpenComments, onOpenPost, onOpenLikes, commentsFor };
}

/**
 * Every group's liked posts as one set. Declared once, outside the hook:
 * react-query runs a `combine` again only when it or a group's answer
 * changes, so the set, and every card drawn from it, stays the same
 * object while nothing has.
 */
function likedIn(results: UseQueryResult<Set<string>>[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const r of results) for (const id of r.data ?? []) out.add(id);
  return out;
}

/** Every group's comment previews, by post. Outside the hook for the same reason. */
function previewsIn(
  results: UseQueryResult<Record<string, CommentWithAuthor[]>>[],
): Readonly<Record<string, CommentWithAuthor[]>> {
  const out: Record<string, CommentWithAuthor[]> = {};
  for (const r of results) if (r.data) Object.assign(out, r.data);
  return out;
}
