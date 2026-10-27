import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, View, type ViewToken } from "react-native";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { PostCard } from "@/components/PostCard";
import { PendingPostCard } from "@/components/PendingPostCard";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { PostSkeleton } from "@/components/Skeleton";
import { FEED_PAGE_SIZE, fetchFeedPage } from "@/api/posts";
import { usePostActions } from "@/hooks/usePostActions";
import { useSession } from "@/providers/SessionProvider";
import { onHomeAgain } from "@/utils/homeRefresh";
import { notePostsInFeed, setOutboxProfileRefresher, usePendingPosts, type PendingState } from "@/uploads";
import { pendingNeedsTop } from "@/uploads/store";
import type { PostWithAuthor } from "@/types/db";

/**
 * The feed's pages as one list, each post once.
 *
 * Pages are fetched by offset. A post just published is put on top of the
 * first page by hand (see src/uploads/feedCache.ts), which pushes every
 * later post along by one, so the next page fetched starts with a post the
 * list already has. Dropping repeats by id keeps that from showing twice.
 */
function flattenPages(pages: PostWithAuthor[][] | undefined): PostWithAuthor[] {
  const seen = new Set<string>();
  const out: PostWithAuthor[] = [];
  for (const page of pages ?? []) {
    for (const post of page) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      out.push(post);
    }
  }
  return out;
}

/**
 * The home feed: the members you follow, newest first, and nothing else on
 * top of it. On This Day lives on the Create tab and the Memories screen,
 * where looking back is the point; the feed is for what is new.
 *
 * Above it, the member's own posts that are still on their way up. They
 * are a header, never rows of the feed: the feed pages by offset, and a
 * row the server does not know would shift every page and be offered to
 * likes and comments that cannot exist yet. When one is posted, the feed
 * gets the real row and the card steps aside for it.
 */
export default function Home() {
  const router = useRouter();
  const { session, refreshProfile } = useSession();
  const userId = session?.user?.id ?? "";

  // The outbox lives outside React, so the profile re-read that moves the
  // post count is lent to it from here.
  useEffect(() => setOutboxProfileRefresher(refreshProfile), [refreshProfile]);

  const feed = useInfiniteQuery({
    queryKey: ["feed", userId],
    queryFn: ({ pageParam }) => fetchFeedPage(userId, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < FEED_PAGE_SIZE ? undefined : pages.length,
    enabled: Boolean(userId),
  });

  const posts = useMemo(() => flattenPages(feed.data?.pages), [feed.data]);
  const postIds = useMemo(() => posts.map((p) => p.id), [posts]);

  // A post hands over to the feed's row the moment that row is there, so
  // the two are never on screen together. Whatever the card's state: a
  // row in the feed is the server saying the post exists, even when the
  // job never heard back from its insert, and the outbox is told so it can
  // carry on from there rather than sit at "Couldn’t post".
  const outbox = usePendingPosts();
  const pending = useMemo(() => {
    const inFeed = new Set(postIds);
    return outbox.filter((p) => p.draft.userId === userId && !inFeed.has(p.id));
  }, [outbox, postIds, userId]);
  useEffect(() => notePostsInFeed(postIds), [postIds]);

  const { isLiked, likeCountFor, toggleLike, onMore, onShare, onOpenComments, onOpenLikes, commentsFor } =
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

  // A new post's card is the list's header, at the very top. Coming back
  // from compose keeps Home as it was (the tabs are not remounted), so a
  // member who had scrolled down would land mid-feed with no sign of it.
  // Taken to the top when a card appears, and when one fails while Home
  // is out of sight, so the failure is the first thing seen on return
  // (see pendingNeedsTop). Not by onHomeAgain: that also refetches.
  const seenPending = useRef(new Map<string, PendingState>());
  useEffect(() => {
    if (pendingNeedsTop(seenPending.current, pending, focused)) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [pending, focused]);

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
        onOpenLikes={onOpenLikes}
        comments={commentsFor(item)}
        onMore={(p) => onMore(p)}
        active={focused && item.id === visibleId}
      />
    ),
    [likeCountFor, isLiked, toggleLike, onOpenComments, onShare, onOpenLikes, commentsFor, onMore, router, visibleId, focused],
  );

  // Only one clip plays at a time. A pending one may when it is the
  // topmost and no card of the feed has taken the screen.
  const header =
    pending.length > 0 ? (
      <View>
        {pending.map((p, i) => (
          <PendingPostCard
            key={p.id}
            pending={p}
            active={focused && visibleId === null && i === 0}
            // Home stays mounted under the other tabs; a card only speaks up while it is in front.
            focused={focused}
            onOpenProfile={(username) => router.push(`/user/${username}`)}
          />
        ))}
      </View>
    ) : null;

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
        ListHeaderComponent={header}
        ListEmptyComponent={
          feed.isLoading ? (
            <>
              <PostSkeleton />
              <PostSkeleton ratio={1} />
            </>
          ) : feed.isError ? (
            <LoadFailed what="your feed" onRetry={() => feed.refetch()} />
          ) : pending.length > 0 ? null : (
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
