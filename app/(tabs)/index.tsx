import React, { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, type ViewToken } from "react-native";
import { useRouter } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { PostCard } from "@/components/PostCard";
import { EmptyState } from "@/components/EmptyState";
import { PostSkeleton } from "@/components/Skeleton";
import { FEED_PAGE_SIZE, fetchFeedPage } from "@/api/posts";
import { usePostActions } from "@/hooks/usePostActions";
import { useSession } from "@/providers/SessionProvider";

/**
 * The home feed: the members you follow, newest first, and nothing else on
 * top of it. On This Day lives on the Create tab and the Memories screen,
 * where looking back is the point; the feed is for what is new.
 */
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

  const { isLiked, likeCountFor, toggleLike, onMore, onShare, onOpenComments, commentsFor } =
    usePostActions(userId, postIds);

  // Only the card actually on screen plays its video — see PostMedia for why
  // letting them all autoplay leaves some of them stuck on a black frame.
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    // The most-covered item wins; FlatList reports them top to bottom.
    const first = viewableItems.find((v) => v.isViewable);
    setVisibleId((first?.item as { id: string } | undefined)?.id ?? null);
  }).current;
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
    minimumViewTime: 120,
  }).current;

  const renderItem = useCallback(
    ({ item }: { item: (typeof posts)[number] }) => (
      <PostCard
        post={{ ...item, like_count: likeCountFor(item) }}
        likedByMe={isLiked(item)}
        onToggleLike={toggleLike}
        onOpenComments={onOpenComments}
        onOpenProfile={(username) => router.push(`/user/${username}`)}
        onShare={onShare}
        comments={commentsFor(item)}
        onMore={(p) => onMore(p)}
        active={item.id === visibleId}
      />
    ),
    [likeCountFor, isLiked, toggleLike, onOpenComments, onShare, commentsFor, onMore, router, visibleId],
  );

  return (
    <Screen padded={false}>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        refreshing={feed.isRefetching && !feed.isFetchingNextPage}
        onRefresh={() => feed.refetch()}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.6}
        ListEmptyComponent={
          feed.isLoading ? (
            <>
              <PostSkeleton />
              <PostSkeleton ratio={1} />
            </>
          ) : (
            <EmptyState
              title="A quiet start"
              body="Follow a few members from Search and their photographs will appear here, newest first."
            />
          )
        }
        ListFooterComponent={feed.isFetchingNextPage ? <PostSkeleton ratio={1} /> : null}
        renderItem={renderItem}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
});
