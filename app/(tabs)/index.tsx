import React, { useMemo } from "react";
import { FlatList, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { PostCard } from "@/components/PostCard";
import { EmptyState } from "@/components/EmptyState";
import { FEED_PAGE_SIZE, fetchFeedPage } from "@/api/posts";
import { usePostActions } from "@/hooks/usePostActions";
import { useSession } from "@/providers/SessionProvider";

export default function Home() {
  const router = useRouter();
  const { session } = useSession();
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

  const { isLiked, likeCountFor, toggleLike, onMore, onShare, commentsFor } =
    usePostActions(userId, postIds);

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
            post={{ ...item, like_count: likeCountFor(item) }}
            likedByMe={isLiked(item)}
            onToggleLike={toggleLike}
            onOpenComments={(p) => router.push(`/post/${p.id}`)}
            onOpenProfile={(username) => router.push(`/user/${username}`)}
            onShare={onShare}
            comments={commentsFor(item)}
            onMore={(p) => onMore(p)}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
});
