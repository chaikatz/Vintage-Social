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
import { EditorialPostCard } from "@/components/feed/EditorialPostCard";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { readState } from "@/components/readState";
import { PostSkeleton } from "@/components/Skeleton";
import { fetchUserPosts } from "@/api/posts";
import { fetchProfileById } from "@/api/profiles";
import { galleryEra, galleryRows } from "@/utils/profileViews";
import { isWarm, videoFocus, warmWindow } from "@/utils/videoWindow";
import { cardAtOffset, idsAround, nextStandInFocus, pictureWindow, standInWindow } from "@/media/cardWindow";
import { commentsOrNone, likeCounted } from "@/media/stableCards";
import {
  LANDING_STEP_MS,
  approachOffset,
  atListEnd,
  nextLanding,
  playingCard,
  startLanding,
} from "@/utils/galleryLanding";
import { usePostActions } from "@/hooks/usePostActions";
import { useEraEdits } from "@/hooks/useEraEdits";
import { useSession } from "@/providers/SessionProvider";
import { useFeedLayout } from "@/utils/feedLayout";
import { useFeedBackground } from "@/utils/feedPaper";
import { useNameTitleStyle } from "@/utils/nameFace";
import type { PostWithAuthor } from "@/types/db";

// A row that breaks this screen breaks only this screen, with the way back on its
// page as well as in its header: a screen opened from a link has no back button
// (src/navigation/Recover.tsx).
export { RecoverPageWithBack as ErrorBoundary } from "@/navigation/Recover";

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

  // The era it opened on, by its key: found once the rows and the
  // arrangement are in, and kept from then on, so a photograph moved to
  // another era from this gallery's "…" leaves it rather than taking the
  // gallery with it. Found while drawing, so the list is drawn once, on
  // the right rows.
  const [pin, setPin] = useState<{ era: string; postId: string | undefined; key: string | null } | null>(null);
  const found = pin && pin.era === era && pin.postId === postId ? pin : null;
  if (era && !waiting && postsQ.data && !found) {
    setPin({ era, postId, key: galleryEra(postsQ.data, era, postId, eraEdits.data?.edits)?.key ?? null });
  }
  const pinned = found?.key ?? null;

  // In the grid's order, or the era's alone (see galleryRows).
  const shown = useMemo(
    () => galleryRows(postsQ.data ?? [], sort, era, postId, eraEdits.data?.edits, pinned),
    [postsQ.data, sort, era, postId, eraEdits.data, pinned],
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
  // Where the list last said it is, and how tall it and its content last
  // said they are: together, whether it can go any further.
  const scrolled = useRef<number | null>(null);
  const viewport = useRef(0);
  const content = useRef(0);
  const settled = useRef(false);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // The last card reported on screen once the list was showing; the clips
  // that have a player are the ones around it.
  const [seenId, setSeenId] = useState<string | null>(null);
  // The card the scroll itself is at, moved every few cards: the small
  // copies standing in follow it (see standInWindow), so a quick scroll
  // finds them already there.
  const [scrollFocus, setScrollFocus] = useState<number | null>(null);
  const scrollFocusRef = useRef<number | null>(null);
  // Only the card on screen plays its video — see PostMedia for why. The
  // tapped row is on screen first, so it starts as the active card.
  const [visibleId, setVisibleId] = useState<string | null>(postId ?? null);
  // The cards the list last reported on screen, in order. While it is
  // hidden, being measured, that is not where the reader is, and it is
  // only noted here: setting it would draw every card again at each step
  // of the landing. It is read when the list shows (see playingCard).
  const onScreen = useRef<string[]>([]);
  // Whether the reader is still on the tapped card.
  const onTapped = useRef(true);

  useEffect(() => {
    // A different photograph or order: land again.
    heights.current.clear();
    settled.current = false;
    setReady(false);
    setSeenId(null);
    scrollFocusRef.current = null;
    setScrollFocus(null);
    setVisibleId(postId ?? null);
    onScreen.current = [];
    onTapped.current = true;
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
        // As far down as it goes now, with every card below the tapped one
        // drawn. Read from the list as it is at this look: cards drawn
        // below since it last moved let it go further, and say nothing.
        const end =
          atListEnd(at, viewport.current, content.current) &&
          posts.slice(startIndex + 1).every((p) => heights.current.has(p.id));
        const next = nextLanding(landing, {
          index: startIndex,
          top,
          scrolled: at,
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
          // the tapped photograph and not the list on its way there. The
          // clip that plays is chosen then, from what the list last reported.
          requestAnimationFrame(() => {
            const id = playingCard(onScreen.current, postId, onTapped.current);
            if (id) {
              setVisibleId(id);
              setSeenId(id);
            }
            setReady(true);
          });
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

  const postsRef = useRef(posts);
  postsRef.current = posts;
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrolled.current = e.nativeEvent.contentOffset.y;
    // Once it shows: the card at the middle of the view, from the heights
    // the cards reported, for the small copies.
    if (!readyRef.current) return;
    const rows = postsRef.current;
    const at = cardAtOffset(scrolled.current + viewport.current / 2, rows.length, (i) => heights.current.get(rows[i].id), LIST_PADDING);
    const next = nextStandInFocus(scrollFocusRef.current, at);
    if (next !== scrollFocusRef.current) {
      scrollFocusRef.current = next;
      setScrollFocus(next);
    }
  }, []);
  const onListLayout = useCallback((e: LayoutChangeEvent) => {
    viewport.current = e.nativeEvent.layout.height;
  }, []);
  const onContentSizeChange = useCallback((_width: number, height: number) => {
    content.current = height;
  }, []);

  const postIds = useMemo(() => posts.map((p) => p.id), [posts]);
  const seenIndex = seenId ? posts.findIndex((p) => p.id === seenId) : -1;
  // Likes and comment previews for the cards around the reader, not the
  // author's every photograph (see src/media/cardWindow.ts).
  const actionIds = useMemo(
    () => idsAround(postIds, videoFocus({ ready, startIndex, seenIndex: seenIndex < 0 ? null : seenIndex })),
    [postIds, ready, startIndex, seenIndex],
  );
  const { isLiked, likeCountFor, toggleLike, onMore, onShare, onOpenComments, onCommentLongPress, onOpenLikes, commentsFor } =
    usePostActions(userId, actionIds);
  // The same objects for a card while nothing about it has changed, so the
  // list drawing again draws again only the cards that did change (see
  // src/media/stableCards.ts).
  const [counted] = useState(likeCounted);
  const openProfile = useCallback((username: string) => router.push(`/user/${username}`), [router]);
  const more = useCallback((p: PostWithAuthor) => onMore(p, () => router.back()), [onMore, router]);

  // Only the card on screen plays (visibleId, above), and only it and its
  // neighbours have a player at all (see src/utils/videoWindow.ts). The
  // window follows the card reported on screen once the list is showing:
  // what is reported while it is still hidden, being measured, is noted
  // and nothing more.
  const tappedId = useRef(postId);
  tappedId.current = postId;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    onScreen.current = viewableItems.filter((v) => v.isViewable).map((v) => (v.item as { id: string }).id);
    if (!readyRef.current) return;
    const id = playingCard(onScreen.current, tappedId.current, onTapped.current);
    // Moved off the tapped card: from here on the first on screen plays.
    if (id !== tappedId.current) onTapped.current = false;
    setVisibleId(id);
    if (id) setSeenId(id);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 120 }).current;
  const warm = warmWindow({ ready, startIndex, seenIndex: seenIndex < 0 ? null : seenIndex, count: posts.length });
  // And only the cards around the reader draw their photograph: the rest
  // are their frames, at the same height (see src/media/cardWindow.ts).
  const pictures = pictureWindow({ ready, startIndex, seenIndex: seenIndex < 0 ? null : seenIndex, count: posts.length });
  // Once it shows, the frames near the scroll hold the grid's small copy
  // until their photograph is drawn, so a quick scroll never comes to rest
  // on empty frames while the window catches up.
  const standIns = standInWindow({ ready, startIndex, seenIndex: scrollFocus ?? (seenIndex < 0 ? null : seenIndex), count: posts.length });

  const loading = !postsQ.isFetched || !authorQ.isFetched || waiting;
  // The photographs, whose they are and, opened from an era, how it is
  // arranged: any of them that could not be read leaves nothing to draw,
  // and says so (src/components/readState.ts). It was "This member hasn’t
  // posted a photograph", and a read that failed with no signal left the
  // skeleton up for good.
  const read = era ? readState(postsQ, authorQ, eraEdits) : readState(postsQ, authorQ);
  const readAgain = () => {
    if (postsQ.isError) postsQ.refetch();
    if (authorQ.isError) authorQ.refetch();
    if (eraEdits.isError) eraEdits.refetch();
  };

  // Editorial (Preview), as on Home: the same props, set out by another
  // card, on the paper chosen with it, under a bar on that paper too.
  const FeedCard = useFeedLayout() === "editorial" ? EditorialPostCard : PostCard;
  const paper = useFeedBackground();
  // Editorial (Preview): the title, when it is the author's username, not bold; an era's keeps the stack's own.
  const titleStyle = useNameTitleStyle(!shown.era);

  return (
    <Screen padded={false} style={paper}>
      {/* An era's gallery is titled with the era; every card still names its author. */}
      <Stack.Screen options={{ title: shown.era ?? authorQ.data?.username ?? "", headerStyle: paper as { backgroundColor: string }, headerTitleStyle: titleStyle }} />
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
        // list draws its way down to the tapped card, out of sight. Only the
        // cards around the tapped one draw their photograph; the rest are
        // frames at their own height, and a clip among them makes no player.
        initialNumToRender={Math.min(startIndex + 3, MEASURE_LIMIT)}
        // While it is hidden it draws twice as many cards at a time: no one
        // is scrolling it, and the cards it walks past are frames, quick to
        // draw.
        maxToRenderPerBatch={ready ? undefined : WALK_BATCH}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onScroll={onScroll}
        onLayout={onListLayout}
        onContentSizeChange={onContentSizeChange}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        ListEmptyComponent={
          read === "failed" ? (
            <LoadFailed what="these photographs" onRetry={readAgain} />
          ) : loading ? (
            <>
              <PostSkeleton />
              <PostSkeleton ratio={1} />
            </>
          ) : !authorQ.data ? (
            // Read, and not there: a member this one may not see, as their profile says.
            <EmptyState title="Member not found" />
          ) : (
            <EmptyState title="Nothing here yet" body="This member hasn’t posted a photograph." />
          )
        }
        renderItem={({ item, index }) => (
          <View ref={item.id === postId ? tapped : undefined} onLayout={(e) => onCardLayout(item.id, e)}>
            <FeedCard
              post={counted(item, likeCountFor(item))}
              likedByMe={isLiked(item)}
              onToggleLike={toggleLike}
              onOpenComments={onOpenComments}
              onOpenProfile={openProfile}
              onShare={onShare}
              onOpenLikes={onOpenLikes}
              comments={commentsOrNone(commentsFor(item))}
              onCommentLongPress={onCommentLongPress}
              onMore={more}
              active={ready && focused && item.id === visibleId}
              warm={isWarm(index, warm)}
              // A card away from the reader is its frame, the same height:
              // on the way down to the tapped one nobody sees it, and its
              // picture would only hold the tapped one back; once the
              // gallery shows, the photographs come in a few cards ahead.
              frameOnly={!isWarm(index, pictures)}
              standIn={isWarm(index, standIns)}
              priority={item.id === postId ? "high" : "normal"}
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
/** The most cards the list draws at a time while it is hidden, twice its usual ten. */
const WALK_BATCH = 20;

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
  // Out of reach as well as out of sight. The phone already ignores
  // touches on a clear view; the browser does not, so it is said here.
  hidden: { opacity: 0, pointerEvents: "none" },
  curtain: { position: "absolute", top: LIST_PADDING, left: 0, right: 0 },
});
