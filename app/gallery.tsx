import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { PostCard } from "@/components/PostCard";
import { EmptyState } from "@/components/EmptyState";
import { PostSkeleton } from "@/components/Skeleton";
import { fetchUserPosts } from "@/api/posts";
import { fetchProfileById } from "@/api/profiles";
import { galleryRows } from "@/utils/profileViews";
import { isWarm, warmWindow } from "@/utils/videoWindow";
import { LANDING_STEP_MS, approachOffset, nextLanding, startLanding } from "@/utils/galleryLanding";
import { usePostActions } from "@/hooks/usePostActions";
import { useEraEdits } from "@/hooks/useEraEdits";
import { useSession } from "@/providers/SessionProvider";
import type { PostWithAuthor } from "@/types/db";

/**
 * A member's photographs, full size and scrollable.
 *
 * Tapping a square in a profile grid opens this at that photograph, and you
 * can keep scrolling through the rest of their work from there — up to the
 * ones before it and down to the ones after, in the grid's own order.
 * Opened from an era, it holds that era alone, in the order it was taken.
 * The grid is an index, not a dead end. Comments live one screen deeper, on
 * the single post, so this stays a viewing surface.
 *
 * Landing on the right photograph is done by measuring where it is, not
 * by working out where it ought to be. Out of sight, the cards up to it
 * are drawn, the tapped one's top is measured within the list, and the
 * list is put exactly there; then it is measured again until it holds
 * still, and only then shown (see src/utils/galleryLanding.ts). Deep in a
 * long history, past what is drawn at once, the list first draws its way
 * down to it. Cards have no fixed height — captions and comments make
 * them what they are — so a sum of heights, or adding rows above a visible
 * one and hoping the list holds still, was what kept opening the wrong post.
 * After that, `maintainVisibleContentPosition` keeps the row you are on in
 * place if anything above it grows, such as comment previews arriving.
 */
export default function Gallery() {
  const router = useRouter();
  const { session } = useSession();
  const focused = useIsFocused();
  const userId = session?.user?.id ?? "";
  const { authorId, postId, sort, era } = useLocalSearchParams<{
    authorId: string;
    postId?: string;
    sort?: "posted" | "taken";
    /** Opened from an era on a profile: its key, and the gallery holds the era of `postId` alone. */
    era?: string;
  }>();

  const postsQ = useQuery({
    queryKey: ["user-posts", authorId],
    queryFn: () => fetchUserPosts(authorId ?? ""),
    enabled: Boolean(authorId),
  });
  const authorQ = useQuery({
    queryKey: ["profile-by-id", authorId],
    queryFn: () => fetchProfileById(authorId ?? ""),
    enabled: Boolean(authorId),
  });

  // Opened from an era, it is the era as its author arranged it; the
  // profile it was opened from has already read that arrangement.
  const eraEdits = useEraEdits(authorId, Boolean(era));
  const waiting = Boolean(era) && !eraEdits.isFetched;

  // In the grid's order, or the era's alone (see galleryRows).
  const shown = useMemo(
    () => galleryRows(postsQ.data ?? [], sort, era, postId, eraEdits.data?.edits),
    [postsQ.data, sort, era, postId, eraEdits.data],
  );

  // Every post here shares one author, so the join is a local attach rather
  // than a second round trip per row.
  const posts: PostWithAuthor[] = useMemo(() => {
    const author = authorQ.data;
    // Not drawn until the era is known, so the landing is measured once, on the right rows.
    if (!author || waiting) return [];
    const attached = {
      id: author.id,
      username: author.username,
      full_name: author.full_name,
      avatar_url: author.avatar_url,
    };
    return shown.rows.map((p) => ({ ...p, author: attached }));
  }, [shown, authorQ.data, waiting]);

  const startIndex = useMemo(() => {
    const index = postId ? posts.findIndex((p) => p.id === postId) : -1;
    return index < 0 ? 0 : index;
  }, [posts, postId]);

  // The list and the tapped card: the landing measures where the card is
  // within the list.
  const list = useRef<FlatList<PostWithAuthor>>(null);
  const tapped = useRef<View>(null);
  // Heights of the cards as they report them: to send the list towards a
  // tapped card not drawn yet, and to tell that more have been drawn.
  const heights = useRef(new Map<string, number>());
  // Where the list last said it is, and whether it could go no further.
  const scrolled = useRef<{ offset: number; end: boolean } | null>(null);
  const settled = useRef(false);
  const [ready, setReady] = useState(false);
  // The last card reported on screen once the list was showing; the clips
  // that have a player are the ones around it.
  const [seenId, setSeenId] = useState<string | null>(null);

  useEffect(() => {
    // A different photograph or order: land again.
    heights.current.clear();
    settled.current = false;
    setReady(false);
    setSeenId(null);
  }, [postId, sort, era]);

  // Look where the tapped card is, put the list there, and look again
  // until it holds still (see src/utils/galleryLanding.ts). A photograph
  // no longer in the rows opens the gallery at the top.
  useEffect(() => {
    if (posts.length === 0 || settled.current) return;
    let landing = startLanding(Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    let over = false;
    const scrollTo = (offset: number) => list.current?.scrollToOffset({ offset, animated: false });
    const look = () => {
      let answered = false;
      const answer = (top: number | null) => {
        if (answered || over) return;
        answered = true;
        clearTimeout(timer);
        const at = scrolled.current;
        // As far down as it goes, with every card below the tapped one drawn.
        const end = Boolean(at?.end) && posts.slice(startIndex + 1).every((p) => heights.current.has(p.id));
        const next = nextLanding(landing, {
          index: startIndex,
          top,
          scrolled: at?.offset ?? null,
          end,
          measured: heights.current.size,
          now: Date.now(),
        });
        landing = next.landing;
        const { step } = next;
        if (step.kind === "show") {
          over = true;
          settled.current = true;
          if (step.offset != null) scrollTo(step.offset);
          // Shown one frame after the scroll lands, so the first thing seen is
          // the tapped photograph and not the list on its way there.
          requestAnimationFrame(() => setReady(true));
          return;
        }
        if (step.kind === "approach") {
          scrollTo(approachOffset(posts.slice(0, startIndex).map((p) => heights.current.get(p.id)), LIST_PADDING));
        } else if (step.kind === "place") {
          scrollTo(step.offset);
        }
        timer = setTimeout(look, LANDING_STEP_MS);
      };
      // On the web a measure goes unanswered if the card leaves the list
      // meanwhile; that is a card not drawn, and the landing goes on.
      timer = setTimeout(() => answer(null), LANDING_STEP_MS);
      measureTop(tapped.current, contentOf(list.current), answer);
    };
    look();
    return () => {
      over = true;
      clearTimeout(timer);
    };
    // Whenever the reset above runs, so a different photograph always
    // lands, even one at the same place in the rows.
  }, [posts, startIndex, postId, sort, era]);

  const onCardLayout = useCallback((id: string, e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) heights.current.set(id, h);
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    scrolled.current = {
      offset: contentOffset.y,
      end: contentOffset.y + layoutMeasurement.height >= contentSize.height - 1,
    };
  }, []);

  const postIds = useMemo(() => posts.map((p) => p.id), [posts]);
  const { isLiked, likeCountFor, toggleLike, onMore, onShare, onOpenComments, onOpenLikes, commentsFor } =
    usePostActions(userId, postIds);

  // Only the card on screen plays its video — see PostMedia for why. The
  // tapped row is on screen first, so it starts as the active card.
  const [visibleId, setVisibleId] = useState<string | null>(postId ?? null);
  // And only it and its neighbours have a player at all (see
  // src/utils/videoWindow.ts). The window follows the card reported on
  // screen once the list is showing: what is reported while it is still
  // hidden at the top, being measured, is not where the reader is.
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    const id = (first?.item as { id: string } | undefined)?.id ?? null;
    setVisibleId(id);
    if (id && readyRef.current) setSeenId(id);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 120 }).current;
  const seenIndex = seenId ? posts.findIndex((p) => p.id === seenId) : -1;
  const warm = warmWindow({ ready, startIndex, seenIndex: seenIndex < 0 ? null : seenIndex, count: posts.length });

  const loading = !postsQ.isFetched || !authorQ.isFetched || waiting;

  return (
    <Screen padded={false}>
      {/* An era's gallery is titled with the era; every card still names its author. */}
      <Stack.Screen options={{ title: shown.era ?? authorQ.data?.username ?? "" }} />
      <FlatList
        ref={list}
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        style={ready ? undefined : styles.hidden}
        // Every card up to and past the tapped one is drawn at once, so the
        // tapped one is there to measure straight away and nothing above
        // it is drawn later, under the reader. Capped so a very long
        // history does not draw itself entirely at once; past the cap the
        // list draws its way down to the tapped card, out of sight. A clip
        // among them is its poster, at its own height, and makes no player.
        initialNumToRender={Math.min(startIndex + 3, MEASURE_LIMIT)}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onScroll={onScroll}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        ListEmptyComponent={
          loading ? (
            <>
              <PostSkeleton />
              <PostSkeleton ratio={1} />
            </>
          ) : (
            <EmptyState title="Nothing here yet" body="This member hasn’t posted a photograph." />
          )
        }
        renderItem={({ item, index }) => (
          <View ref={item.id === postId ? tapped : undefined} onLayout={(e) => onCardLayout(item.id, e)}>
            <PostCard
              post={{ ...item, like_count: likeCountFor(item) }}
              likedByMe={isLiked(item)}
              onToggleLike={toggleLike}
              onOpenComments={onOpenComments}
              onOpenProfile={(username) => router.push(`/user/${username}`)}
              onShare={onShare}
        onOpenLikes={onOpenLikes}
              comments={commentsFor(item)}
              onMore={(p) => onMore(p, () => router.back())}
              active={ready && focused && item.id === visibleId}
              warm={isWarm(index, warm)}
              surface="gallery"
            />
          </View>
        )}
      />
      {!ready && !loading && posts.length > 0 ? (
        // What is shown while the gallery lands: a frame the shape of the
        // tapped photograph, so the landing reads as a load.
        <View style={styles.curtain} pointerEvents="none">
          <PostSkeleton ratio={ratioOf(posts[startIndex])} />
        </View>
      ) : null}
    </Screen>
  );
}

/** Top padding of the list, where the first card starts. */
const LIST_PADDING = 8;
/** The most cards drawn at once to land; past this the list draws its way down to the tapped card. */
const MEASURE_LIMIT = 80;

/**
 * What the cards sit in: the list's content, scrolled as one. The phone
 * measures a view only from one that holds it, so the cards are measured
 * from this and not from anything beside them.
 */
function contentOf(list: FlatList<PostWithAuthor> | null): View | null {
  const scroller = list?.getNativeScrollRef() as { getInnerViewRef?: () => View | null } | null | undefined;
  return scroller?.getInnerViewRef?.() ?? null;
}

/**
 * The card's top within the list's content, padding and all, or null
 * while the card is not drawn. Measured within the content, so where the
 * list is scrolled does not enter in.
 */
function measureTop(card: View | null, content: View | null, then: (top: number | null) => void) {
  if (!card || !content) {
    then(null);
    return;
  }
  card.measureLayout(content, (_x, y) => then(y), () => then(null));
}

function ratioOf(post: PostWithAuthor | undefined): number {
  if (!post?.width || !post.height) return 1;
  return Math.min(Math.max(post.width / post.height, 4 / 5), 1.91);
}

const styles = StyleSheet.create({
  list: { paddingVertical: LIST_PADDING },
  hidden: { opacity: 0 },
  curtain: { position: "absolute", top: LIST_PADDING, left: 0, right: 0 },
});
