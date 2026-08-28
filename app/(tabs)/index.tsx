import React, { useCallback, useMemo, useState } from "react";
import { FlatList, StyleSheet } from "react-native";
import { showAlert } from "@/utils/alert";
import { useRouter } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { PostCard } from "@/components/PostCard";
import { EmptyState } from "@/components/EmptyState";
import {
  FEED_PAGE_SIZE,
  fetchFeedPage,
  fetchMyLikes,
  likePost,
  unlikePost,
  deleteOwnPost,
} from "@/api/posts";
import { useSession } from "@/providers/SessionProvider";
import type { PostWithAuthor } from "@/types/db";

export default function Home() {
  const router = useRouter();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const userId = session?.user?.id ?? "";

  const feed = useInfiniteQuery({
    queryKey: ["feed", userId],
    queryFn: ({ pageParam }) => fetchFeedPage(userId, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < FEED_PAGE_SIZE ? undefined : pages.length,
    enabled: Boolean(userId),
  });

  const posts = useMemo(() => (feed.data?.pages ?? []).flat(), [feed.data]);
  const postIds = useMemo(() => posts.map((p) => p.id), [posts]);

  const likesQuery = useQuery({
    queryKey: ["my-likes", userId, postIds.join(",")],
    queryFn: () => fetchMyLikes(userId, postIds),
    enabled: Boolean(userId) && postIds.length > 0,
  });

  // Optimistic overrides so likes feel instant.
  const [likeOverrides, setLikeOverrides] = useState<Record<string, boolean>>({});
  const [countDeltas, setCountDeltas] = useState<Record<string, number>>({});

  const isLiked = useCallback(
    (post: PostWithAuthor) => likeOverrides[post.id] ?? likesQuery.data?.has(post.id) ?? false,
    [likeOverrides, likesQuery.data],
  );

  const toggleLike = useCallback(
    async (post: PostWithAuthor, next: boolean) => {
      setLikeOverrides((o) => ({ ...o, [post.id]: next }));
      setCountDeltas((d) => ({ ...d, [post.id]: (d[post.id] ?? 0) + (next ? 1 : -1) }));
      try {
        if (next) await likePost(userId, post.id);
        else await unlikePost(userId, post.id);
      } catch {
        setLikeOverrides((o) => ({ ...o, [post.id]: !next }));
        setCountDeltas((d) => ({ ...d, [post.id]: (d[post.id] ?? 0) + (next ? -1 : 1) }));
      }
    },
    [userId],
  );

  const onMore = useCallback(
    (post: PostWithAuthor) => {
      if (post.author_id === userId) {
        showAlert("Your post", undefined, [
          {
            text: "Delete post",
            style: "destructive",
            onPress: async () => {
              await deleteOwnPost(post.id);
              queryClient.invalidateQueries({ queryKey: ["feed"] });
            },
          },
          { text: "Cancel", style: "cancel" },
        ]);
      } else {
        showAlert(post.author.username, undefined, [
          {
            text: "Report post",
            style: "destructive",
            onPress: () => router.push({ pathname: "/report", params: { targetType: "post", postId: post.id } }),
          },
          { text: "Cancel", style: "cancel" },
        ]);
      }
    },
    [userId, router, queryClient],
  );

  return (
    <Screen padded={false}>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        refreshing={feed.isRefetching}
        onRefresh={() => feed.refetch()}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.6}
        ListEmptyComponent={
          feed.isLoading ? null : (
            <EmptyState
              title="A quiet start"
              body="Follow a few members from Search and their photographs will appear here, newest first."
            />
          )
        }
        renderItem={({ item }) => (
          <PostCard
            post={{ ...item, like_count: Math.max(0, item.like_count + (countDeltas[item.id] ?? 0)) }}
            likedByMe={isLiked(item)}
            onToggleLike={toggleLike}
            onOpenComments={(p) => router.push(`/post/${p.id}`)}
            onOpenProfile={(username) => router.push(`/user/${username}`)}
            onMore={onMore}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
});
