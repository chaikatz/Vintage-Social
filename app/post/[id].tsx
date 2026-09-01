import React, { useMemo } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { PostCard } from "@/components/PostCard";
import { EmptyState } from "@/components/EmptyState";
import { colors, spacing } from "@/theme";
import { fetchPost } from "@/api/posts";
import { usePostActions } from "@/hooks/usePostActions";
import { useSession } from "@/providers/SessionProvider";

/**
 * One photograph on its own — where a link lands: a notification, or a
 * post someone sent you. It is the same card the feed draws, so the
 * comment bubble opens the conversation on its own screen rather than
 * repeating the picture underneath it.
 */
export default function PostDetail() {
  const router = useRouter();
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = session?.user?.id ?? "";

  const postQ = useQuery({
    queryKey: ["post", id],
    queryFn: () => fetchPost(id ?? ""),
    enabled: Boolean(id),
  });

  const postIds = useMemo(() => (id ? [id] : []), [id]);
  const { isLiked, likeCountFor, toggleLike, onMore, onShare, onOpenComments, commentsFor } =
    usePostActions(userId, postIds);

  const post = postQ.data;
  if (!post) {
    return <Screen>{postQ.isFetched ? <EmptyState title="This photograph is gone" /> : null}</Screen>;
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <PostCard
        post={{ ...post, like_count: likeCountFor(post) }}
        likedByMe={isLiked(post)}
        onToggleLike={toggleLike}
        onOpenComments={onOpenComments}
        onOpenProfile={(username) => router.push(`/user/${username}`)}
        onShare={onShare}
        comments={commentsFor(post)}
        onMore={(p) => onMore(p, () => router.back())}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingVertical: spacing.sm },
});
