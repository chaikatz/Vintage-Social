import React, { useEffect, useMemo, useRef } from "react";
import { FlatList, StyleSheet } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { PostCard } from "@/components/PostCard";
import { EmptyState } from "@/components/EmptyState";
import { fetchUserPosts } from "@/api/posts";
import { fetchProfileById } from "@/api/profiles";
import { usePostActions } from "@/hooks/usePostActions";
import { useSession } from "@/providers/SessionProvider";
import type { PostWithAuthor } from "@/types/db";

/**
 * A member's photographs, full size and scrollable.
 *
 * Tapping a square in a profile grid opens this at that photograph, and you
 * can keep scrolling through the rest of their work from there — the grid is
 * an index, not a dead end. Comments live one screen deeper, on the single
 * post, so this stays a viewing surface.
 */
export default function Gallery() {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";
  const { authorId, postId } = useLocalSearchParams<{ authorId: string; postId?: string }>();

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
    return (postsQ.data ?? []).map((p) => ({ ...p, author: attached }));
  }, [postsQ.data, authorQ.data]);

  const postIds = useMemo(() => posts.map((p) => p.id), [posts]);
  const { isLiked, likeCountFor, toggleLike, onMore, onShare, onOpenComments, commentsFor } =
    usePostActions(userId, postIds);

  const listRef = useRef<FlatList<PostWithAuthor>>(null);
  const startIndex = postId ? posts.findIndex((p) => p.id === postId) : 0;

  // Post cards have no fixed height — the media aspect ratio and caption
  // length both vary — so there is no honest getItemLayout to give. Jump
  // once the rows exist instead, and let onScrollToIndexFailed cover the
  // case where they don't yet.
  useEffect(() => {
    if (startIndex > 0) {
      listRef.current?.scrollToIndex({ index: startIndex, animated: false });
    }
  }, [startIndex]);

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: authorQ.data?.username ?? "" }} />
      <FlatList
        ref={listRef}
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        initialNumToRender={Math.max(1, startIndex + 1)}
        onScrollToIndexFailed={({ index }) => {
          setTimeout(() => listRef.current?.scrollToIndex({ index, animated: false }), 60);
        }}
        ListEmptyComponent={
          postsQ.isFetched && authorQ.isFetched ? (
            <EmptyState title="Nothing here yet" body="This member hasn’t posted a photograph." />
          ) : null
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
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
});
