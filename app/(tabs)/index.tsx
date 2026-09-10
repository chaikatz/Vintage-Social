import React, { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Platform, StyleSheet, type ViewToken } from "react-native";
import { useRouter } from "expo-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { PostCard } from "@/components/PostCard";
import { EmptyState } from "@/components/EmptyState";
import { PostSkeleton } from "@/components/Skeleton";
import { MemoryStrip } from "@/components/MemoryStrip";
import { FEED_PAGE_SIZE, fetchFeedPage, fetchUserPosts } from "@/api/posts";
import { onThisDay } from "@/utils/memories";
import { libraryGranted, photosOnThisDay } from "@/utils/library";
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

  const { isLiked, likeCountFor, toggleLike, onMore, onShare, onOpenComments, commentsFor } =
    usePostActions(userId, postIds);

  // On this day: the member's own photographs first, then — only if the
  // library has already been allowed — whatever the phone has from this
  // date. The strip stays silent unless one of them has something.
  const mine = useQuery({
    queryKey: ["user-posts", userId],
    queryFn: () => fetchUserPosts(userId),
    enabled: Boolean(userId),
  });
  const dayKey = new Date().toDateString();
  const library = useQuery({
    queryKey: ["library-on-this-day", dayKey],
    queryFn: async () => ((await libraryGranted(false)) ? photosOnThisDay() : []),
    enabled: Platform.OS !== "web",
    staleTime: 60 * 60_000,
  });
  const memories = useMemo(() => onThisDay(mine.data ?? []), [mine.data]);
  const libraryCount = useMemo(
    () => (library.data ?? []).reduce((n, day) => n + day.photos.length, 0),
    [library.data],
  );
  const strip =
    memories.length > 0 || libraryCount > 0 ? (
      <MemoryStrip
        memory={memories[0] ?? null}
        extra={
          libraryCount > 0
            ? memories.length > 0
              ? `and ${libraryCount} more in your library`
              : `${libraryCount} ${libraryCount === 1 ? "photograph" : "photographs"} in your library from this day.`
            : null
        }
        onPress={() => router.push("/memories")}
      />
    ) : null;

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
        ListHeaderComponent={strip}
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
