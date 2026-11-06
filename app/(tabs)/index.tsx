import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, View, type ViewToken } from "react-native";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { focusManager, onlineManager, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
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
import { idsAround } from "@/media/cardWindow";
import { commentsOrNone, likeCounted } from "@/media/stableCards";
import { refreshFromFirstPage, refreshOnReturn } from "@/media/feedPages";
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
    // Coming back to the app, or back online, is decided below: left to
    // the query, it read every page loaded again, one after another.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // A refresh starts the feed again from its newest page: one request,
  // not one for every page the reader has loaded, and those pages back as
  // they were if it cannot be read (src/media/feedPages.ts).
  const queryClient = useQueryClient();
  const feedRefetch = feed.refetch;
  const refreshFromTop = useCallback(
    () => refreshFromFirstPage(queryClient, ["feed", userId], feedRefetch),
    [queryClient, userId, feedRefetch],
  );

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

  // Likes and comment previews are read for the cards around the reader,
  // not every post loaded (see src/media/cardWindow.ts): the last card
  // reported on screen, kept while nothing is. And for the list's first
  // draw, which it keeps however far down the reader goes: without them
  // those cards lost their previews and grew shorter above the reader.
  const [seenId, setSeenId] = useState<string | null>(null);
  const seenIndex = useMemo(() => (seenId ? postIds.indexOf(seenId) : -1), [postIds, seenId]);
  const actionIds = useMemo(
    () => idsAround(postIds, Math.max(0, seenIndex), { keepFirst: HOME_FIRST_DRAW }),
    [postIds, seenIndex],
  );
  const { isLiked, likeCountFor, toggleLike, onMore, onShare, onOpenComments, onOpenLikes, commentsFor } =
    usePostActions(userId, actionIds);

  // Leaving the feed — another tab, a profile, a single post — pauses it.
  // The tab stays mounted underneath, and a clip you can no longer see
  // should not go on talking.
  const focused = useIsFocused();

  // Home tapped while on Home: to the top, and one refetch — never a second
  // while the first is still out, however many times the icon is tapped.
  const listRef = useRef<FlatList<(typeof posts)[number]>>(null);
  const refetchRef = useRef(refreshFromTop);
  refetchRef.current = refreshFromTop;
  const fetchingRef = useRef(false);
  fetchingRef.current = feed.isFetching;
  // Where the reader is, for the refreshes that are not asked for.
  const seenIndexRef = useRef(seenIndex);
  seenIndexRef.current = seenIndex;
  useEffect(() => {
    let settle: ReturnType<typeof setTimeout> | undefined;
    const off = onHomeAgain(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      if (fetchingRef.current) return;
      // From further down, the pages below the first are let go once the
      // list is back at the top, not under it while it is on its way.
      clearTimeout(settle);
      if (seenIndexRef.current <= 0) void refetchRef.current();
      else
        settle = setTimeout(() => {
          if (!fetchingRef.current) void refetchRef.current();
        }, HOME_AGAIN_SETTLE_MS);
    });
    return () => {
      off();
      clearTimeout(settle);
    };
  }, []);

  // Back in the app, or back online: the newest page for a reader at the
  // top whose feed has gone stale; a reader further down keeps their place.
  useEffect(() => {
    const back = (now: boolean) => {
      if (!now || !userId || fetchingRef.current) return;
      const state = queryClient.getQueryState(["feed", userId]);
      const stale = refreshOnReturn({
        seenIndex: seenIndexRef.current,
        updatedAt: state?.dataUpdatedAt ?? 0,
        now: Date.now(),
        staleMs: FEED_STALE_MS,
      });
      if (stale) void refetchRef.current();
    };
    const offFocus = focusManager.subscribe((isFocused) => back(isFocused));
    const offOnline = onlineManager.subscribe((isOnline) => back(isOnline));
    return () => {
      offFocus();
      offOnline();
    };
  }, [queryClient, userId]);

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
    const id = (first?.item as { id: string } | undefined)?.id ?? null;
    setVisibleId(id);
    if (id) setSeenId(id);
  }).current;
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
    minimumViewTime: 120,
  }).current;

  // Each card is handed the same objects while nothing about it has
  // changed, so only the cards whose state did change are drawn again when
  // the list is: the one that stopped playing and the one that started,
  // not every card held (see src/media/stableCards.ts).
  const [counted] = useState(likeCounted);
  const openProfile = useCallback((username: string) => router.push(`/user/${username}`), [router]);
  const more = useCallback((p: PostWithAuthor) => onMore(p), [onMore]);
  const renderItem = useCallback(
    ({ item, index }: { item: (typeof posts)[number]; index: number }) => (
      <PostCard
        post={counted(item, likeCountFor(item))}
        likedByMe={isLiked(item)}
        onToggleLike={toggleLike}
        onOpenComments={onOpenComments}
        onOpenProfile={openProfile}
        onShare={onShare}
        onOpenLikes={onOpenLikes}
        comments={commentsOrNone(commentsFor(item))}
        onMore={more}
        active={focused && item.id === visibleId}
        // The photographs on the first screen are fetched ahead of the
        // ones drawn below it, waiting for the reader.
        priority={index < FIRST_SCREEN ? "high" : "normal"}
      />
    ),
    [counted, likeCountFor, isLiked, toggleLike, onOpenComments, onShare, onOpenLikes, commentsFor, more, openProfile, visibleId, focused],
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
        onRefresh={() => void refreshFromTop()}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
        }}
        // The next page is asked for two screens before the end, so it is
        // usually there before the reader is.
        onEndReachedThreshold={2}
        // Cards are drawn four screens either side of the reader and let go
        // past that, their photographs and players with them; the list's
        // default is ten screens either side, every card of a first page
        // and more, each holding a full-width photograph and any clip's
        // player. Four screens ahead is still several cards: they are
        // drawn, and their photographs fetched, before they are reached.
        windowSize={HOME_WINDOW}
        // The list keeps its first draw for good; four cards are more than
        // the first screen, and the rest are drawn a few at a time.
        initialNumToRender={HOME_FIRST_DRAW}
        maxToRenderPerBatch={HOME_BATCH}
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

/** The query's own staleness (src/lib/queryClient.ts): a feed older than this is refreshed on return. */
const FEED_STALE_MS = 30_000;
/** How long a scroll back to the top is given before the pages below the first are let go. */
const HOME_AGAIN_SETTLE_MS = 400;

/** Screens of cards drawn around the reader: four either side, and the one in view. */
const HOME_WINDOW = 9;
/** Cards in the list's first draw, which it keeps for good. */
const HOME_FIRST_DRAW = 4;
/** Cards drawn at a time as the reader goes on. */
const HOME_BATCH = 4;
/** Cards whose photographs are fetched first: what the first screen shows. */
const FIRST_SCREEN = 2;

const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
});
