import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, View, type LayoutChangeEvent, type ViewToken } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { PostCard } from "@/components/PostCard";
import { EmptyState } from "@/components/EmptyState";
import { PostSkeleton } from "@/components/Skeleton";
import { fetchUserPosts } from "@/api/posts";
import { fetchProfileById } from "@/api/profiles";
import { sortByTaken } from "@/utils/memories";
import { usePostActions } from "@/hooks/usePostActions";
import { useSession } from "@/providers/SessionProvider";
import type { PostWithAuthor } from "@/types/db";

/**
 * A member's photographs, full size and scrollable.
 *
 * Tapping a square in a profile grid opens this at that photograph, and you
 * can keep scrolling through the rest of their work from there — up to the
 * ones before it and down to the ones after, in the grid's own order. The
 * grid is an index, not a dead end. Comments live one screen deeper, on
 * the single post, so this stays a viewing surface.
 *
 * Landing on the right photograph is done by measuring, not guessing.
 * Every card above the tapped one is drawn first (out of sight), reports
 * its height, and once they all have, the list is put at exactly their
 * sum and shown. Cards have no fixed height — captions and comments make
 * them what they are — so an estimate, or adding rows above a visible one
 * and hoping the list holds still, was what kept opening the wrong post.
 * After that, `maintainVisibleContentPosition` keeps the row you are on in
 * place if anything above it grows, such as comment previews arriving.
 */
export default function Gallery() {
  const router = useRouter();
  const { session } = useSession();
  const focused = useIsFocused();
  const userId = session?.user?.id ?? "";
  const { authorId, postId, sort } = useLocalSearchParams<{
    authorId: string;
    postId?: string;
    sort?: "posted" | "taken";
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

  // Every post here shares one author, so the join is a local attach rather
  // than a second round trip per row.
  const posts: PostWithAuthor[] = useMemo(() => {
    const author = authorQ.data;
    if (!author) return [];
    const attached = {
      id: author.id,
      username: author.username,
      full_name: author.full_name,
      avatar_url: author.avatar_url,
    };
    const rows = postsQ.data ?? [];
    return (sort === "taken" ? sortByTaken(rows) : rows).map((p) => ({ ...p, author: attached }));
  }, [postsQ.data, authorQ.data, sort]);

  const startIndex = useMemo(() => {
    const index = postId ? posts.findIndex((p) => p.id === postId) : -1;
    return index < 0 ? 0 : index;
  }, [posts, postId]);

  // Heights of the cards above the tapped one, as they report them.
  const list = useRef<FlatList<PostWithAuthor>>(null);
  const heights = useRef(new Map<string, number>());
  const settled = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // A different photograph or order: measure again.
    heights.current.clear();
    settled.current = false;
    setReady(false);
  }, [postId, sort]);

  const settle = useCallback(() => {
    if (settled.current || posts.length === 0) return;
    let offset = LIST_PADDING;
    for (let i = 0; i < startIndex; i++) {
      const h = heights.current.get(posts[i].id);
      if (h == null) return; // not every card above has been measured yet
      offset += h;
    }
    settled.current = true;
    if (offset > LIST_PADDING) {
      list.current?.scrollToOffset({ offset, animated: false });
    }
    // Shown one frame after the scroll lands, so the first thing seen is
    // the tapped photograph and not the top of the list on its way there.
    requestAnimationFrame(() => setReady(true));
  }, [posts, startIndex]);

  // With nothing above the tapped row, there is nothing to measure.
  useEffect(() => {
    if (posts.length > 0 && startIndex === 0 && !settled.current) {
      settled.current = true;
      setReady(true);
    }
  }, [posts.length, startIndex]);

  const onCardLayout = useCallback(
    (id: string, e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h <= 0) return;
      const before = heights.current.get(id);
      heights.current.set(id, h);
      if (before !== h) settle();
    },
    [settle],
  );

  const postIds = useMemo(() => posts.map((p) => p.id), [posts]);
  const { isLiked, likeCountFor, toggleLike, onMore, onShare, onOpenComments, commentsFor } =
    usePostActions(userId, postIds);

  // Only the card on screen plays its video — see PostMedia for why. The
  // tapped row is on screen first, so it starts as the active card.
  const [visibleId, setVisibleId] = useState<string | null>(postId ?? null);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    setVisibleId((first?.item as { id: string } | undefined)?.id ?? null);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 120 }).current;

  const loading = !postsQ.isFetched || !authorQ.isFetched;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: authorQ.data?.username ?? "" }} />
      <FlatList
        ref={list}
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        style={ready ? undefined : styles.hidden}
        // Every card up to and past the tapped one is drawn at once, so the
        // ones above it can be measured. Capped so a very long history
        // does not draw itself entirely before showing anything.
        initialNumToRender={Math.min(startIndex + 3, MEASURE_LIMIT)}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
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
        renderItem={({ item }) => (
          <View onLayout={(e) => onCardLayout(item.id, e)}>
            <PostCard
              post={{ ...item, like_count: likeCountFor(item) }}
              likedByMe={isLiked(item)}
              onToggleLike={toggleLike}
              onOpenComments={onOpenComments}
              onOpenProfile={(username) => router.push(`/user/${username}`)}
              onShare={onShare}
              comments={commentsFor(item)}
              onMore={(p) => onMore(p, () => router.back())}
              active={ready && focused && item.id === visibleId}
            />
          </View>
        )}
      />
      {!ready && !loading && posts.length > 0 ? (
        // What is shown while the cards above are measured: a frame the
        // shape of the tapped photograph, so the landing reads as a load.
        <View style={styles.curtain} pointerEvents="none">
          <PostSkeleton ratio={ratioOf(posts[startIndex])} />
        </View>
      ) : null}
    </Screen>
  );
}

/** Top padding of the list, counted into the landing offset. */
const LIST_PADDING = 8;
/** Beyond this many cards above the tapped one, the landing is measured as far as it can be. */
const MEASURE_LIMIT = 80;

function ratioOf(post: PostWithAuthor | undefined): number {
  if (!post?.width || !post.height) return 1;
  return Math.min(Math.max(post.width / post.height, 4 / 5), 1.91);
}

const styles = StyleSheet.create({
  list: { paddingVertical: LIST_PADDING },
  hidden: { opacity: 0 },
  curtain: { position: "absolute", top: LIST_PADDING, left: 0, right: 0 },
});
