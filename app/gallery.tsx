import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, type ViewToken } from "react-native";
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
 * Landing on the right photograph is done without scrolling to an index,
 * which cards of no fixed height kept getting wrong. The list first draws
 * from the tapped post onward, so it is the top row by construction; then
 * the earlier posts are put in above it with `maintainVisibleContentPosition`
 * holding the row you are looking at exactly where it is. From then on it
 * is one plain list.
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

  // The rows above the tapped one are added once the first frame is on
  // screen, so the tapped row is what you see and it stays put.
  const [earlierShown, setEarlierShown] = useState(false);
  const data = useMemo(
    () => (earlierShown || startIndex === 0 ? posts : posts.slice(startIndex)),
    [posts, startIndex, earlierShown],
  );
  const revealed = useRef(false);
  const onContentSizeChange = useCallback(() => {
    if (revealed.current || posts.length === 0) return;
    revealed.current = true;
    // One frame later, so the anchored row has been laid out first.
    requestAnimationFrame(() => setEarlierShown(true));
  }, [posts.length]);
  useEffect(() => {
    revealed.current = false;
    setEarlierShown(false);
  }, [postId, sort]);

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
        data={data}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onContentSizeChange={onContentSizeChange}
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
          <PostCard
            post={{ ...item, like_count: likeCountFor(item) }}
            likedByMe={isLiked(item)}
            onToggleLike={toggleLike}
            onOpenComments={onOpenComments}
            onOpenProfile={(username) => router.push(`/user/${username}`)}
            onShare={onShare}
            comments={commentsFor(item)}
            onMore={(p) => onMore(p, () => router.back())}
            active={focused && item.id === visibleId}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
});
