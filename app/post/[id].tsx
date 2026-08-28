import React, { useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { showAlert } from "@/utils/alert";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { PostCard } from "@/components/PostCard";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { colors, spacing, type } from "@/theme";
import {
  addComment,
  deleteOwnComment,
  deleteOwnPost,
  fetchComments,
  fetchMyLikes,
  fetchPost,
  likePost,
  unlikePost,
} from "@/api/posts";
import { removeComment } from "@/api/moderation";
import { useSession } from "@/providers/SessionProvider";
import { postAge } from "@/utils/time";
import { MAX_COMMENT_LENGTH } from "@/utils/validation";
import type { CommentWithAuthor } from "@/types/db";

export default function PostDetail() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, isAdmin } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = session?.user?.id ?? "";
  const [draft, setDraft] = useState("");

  const postQ = useQuery({
    queryKey: ["post", id],
    queryFn: () => fetchPost(id ?? ""),
    enabled: Boolean(id),
  });
  const commentsQ = useQuery({
    queryKey: ["comments", id],
    queryFn: () => fetchComments(id ?? ""),
    enabled: Boolean(id),
  });
  const likedQ = useQuery({
    queryKey: ["my-likes", userId, id],
    queryFn: () => fetchMyLikes(userId, [id ?? ""]),
    enabled: Boolean(userId && id),
  });

  const [likeOverride, setLikeOverride] = useState<boolean | null>(null);
  const [likeDelta, setLikeDelta] = useState(0);

  const post = postQ.data;
  const liked = likeOverride ?? likedQ.data?.has(id ?? "") ?? false;

  const send = useMutation({
    mutationFn: () => addComment(userId, id ?? "", draft),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["comments", id] });
      queryClient.invalidateQueries({ queryKey: ["post", id] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  if (!post) {
    return <Screen>{postQ.isFetched ? <EmptyState title="This photograph is gone" /> : null}</Screen>;
  }

  const toggleLike = async (_p: unknown, next: boolean) => {
    setLikeOverride(next);
    setLikeDelta((d) => d + (next ? 1 : -1));
    try {
      if (next) await likePost(userId, post.id);
      else await unlikePost(userId, post.id);
    } catch {
      setLikeOverride(!next);
      setLikeDelta((d) => d + (next ? -1 : 1));
    }
  };

  const onMore = () => {
    if (post.author_id === userId) {
      showAlert("Your post", undefined, [
        {
          text: "Delete post",
          style: "destructive",
          onPress: async () => {
            await deleteOwnPost(post.id);
            queryClient.invalidateQueries({ queryKey: ["feed"] });
            queryClient.invalidateQueries({ queryKey: ["user-posts"] });
            router.back();
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    } else {
      showAlert(post.author.username, undefined, [
        {
          text: "Report post",
          style: "destructive",
          onPress: () =>
            router.push({ pathname: "/report", params: { targetType: "post", postId: post.id } }),
        },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  const onCommentLongPress = (comment: CommentWithAuthor) => {
    const own = comment.author_id === userId;
    if (own || isAdmin) {
      showAlert("Comment", undefined, [
        {
          text: own ? "Delete comment" : "Remove comment (admin)",
          style: "destructive",
          onPress: async () => {
            if (own) await deleteOwnComment(comment.id);
            else await removeComment(comment.id, "Removed from post view");
            queryClient.invalidateQueries({ queryKey: ["comments", id] });
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    } else {
      showAlert("Comment", undefined, [
        {
          text: "Report comment",
          style: "destructive",
          onPress: () =>
            router.push({
              pathname: "/report",
              params: { targetType: "comment", commentId: comment.id },
            }),
        },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={commentsQ.data ?? []}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={
          <PostCard
            post={{ ...post, like_count: Math.max(0, post.like_count + likeDelta) }}
            likedByMe={liked}
            onToggleLike={toggleLike}
            onOpenComments={() => undefined}
            onOpenProfile={(username) => router.push(`/user/${username}`)}
            onMore={onMore}
          />
        }
        renderItem={({ item }) => (
          <Pressable style={styles.comment} onLongPress={() => onCommentLongPress(item)}>
            <Avatar path={item.author.avatar_url} username={item.author.username} size={28} />
            <View style={styles.commentBody}>
              <Text style={styles.commentText}>
                <Text style={styles.commentAuthor}>{item.author.username}</Text> {item.body}
              </Text>
              <Text style={styles.commentAge}>{postAge(item.created_at)}</Text>
            </View>
          </Pressable>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={(t) => setDraft(t.slice(0, MAX_COMMENT_LENGTH))}
          placeholder="Add a comment…"
          placeholderTextColor={colors.inkFaint}
          style={styles.input}
          multiline
        />
        <Pressable
          disabled={!draft.trim() || send.isPending}
          onPress={() => send.mutate()}
          hitSlop={8}
        >
          <Text style={[styles.send, (!draft.trim() || send.isPending) && styles.sendDisabled]}>
            Post
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  comment: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  commentBody: { flex: 1, marginLeft: spacing.sm + 2 },
  commentText: { ...type.body, fontSize: 14 },
  commentAuthor: { fontWeight: "600" },
  commentAge: { fontSize: 11, color: colors.inkFaint, marginTop: 2 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.paper,
    gap: spacing.md,
  },
  input: {
    flex: 1,
    maxHeight: 90,
    fontSize: 14,
    color: colors.ink,
    paddingTop: 6,
    paddingBottom: 6,
  },
  send: { color: colors.accent, fontWeight: "600", fontSize: 14, paddingBottom: 8 },
  sendDisabled: { opacity: 0.4 },
});
