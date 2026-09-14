import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, type ViewToken } from "react-native";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { PostCard } from "@/components/PostCard";
import { EmptyState } from "@/components/EmptyState";
import { PostSkeleton } from "@/components/Skeleton";
import { FEED_PAGE_SIZE, fetchFeedPage } from "@/api/posts";
import { usePostActions } from "@/hooks/usePostActions";
import { useSession } from "@/providers/SessionProvider";
import { onHomeAgain } from "@/utils/homeRefresh";

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

  // Leaving the feed — another tab, a profile, a single post — pauses it.
  // The tab stays mounted underneath, and a clip you can no longer see
  // should not go on talking.
  const focused = useIsFocused();

  // Home tapped while on Home: to the top, and one refetch — never a second
  // while the first is still out, however many times the icon is tapped.
  const listRef = useRef<FlatList<(typeof posts)[number]>>(null);
  const refetchRef = useRef(feed.refetch);
  refetchRef.current = feed.refetch;
  const fetchingRef = useRef(false);
  fetchingRef.current = feed.isFetching;
  useEffect(
    () =>
      onHomeAgain(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
        if (!fetchingRef.current) void refetchRef.current();
      }),
    [],
  );

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
        active={focused && item.id === visibleId}
      />
    ),
    [likeCountFor, isLiked, toggleLike, onOpenComments, onShare, commentsFor, onMore, router, visibleId, focused],
  );

  return (
    <Screen padded={false}>
      <FlatList
        ref={listRef}
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
