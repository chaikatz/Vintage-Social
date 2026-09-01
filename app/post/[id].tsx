import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { showAlert } from "@/utils/alert";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { PostCard } from "@/components/PostCard";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { colors, spacing, type } from "@/theme";
import { addComment, deleteOwnComment, fetchComments, fetchPost } from "@/api/posts";
import { removeComment } from "@/api/moderation";
import { usePostActions } from "@/hooks/usePostActions";
import { useSession } from "@/providers/SessionProvider";
import { postAge } from "@/utils/time";
import { MAX_COMMENT_LENGTH } from "@/utils/validation";
import type { CommentWithAuthor } from "@/types/db";

/**
 * Keeps the composer clear of the keyboard, and of the home indicator when
 * the keyboard is down. Without the second half the "Add a comment" row
 * sits half under the indicator on every modern iPhone.
 */
function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () =>
      setShown(true),
    );
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () =>
      setShown(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

export default function PostDetail() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, isAdmin } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = session?.user?.id ?? "";
  const [draft, setDraft] = useState("");
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();

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
  const post = postQ.data;
  const postIds = useMemo(() => (id ? [id] : []), [id]);
  const { isLiked, likeCountFor, toggleLike, onMore } = usePostActions(userId, postIds);

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
      keyboardVerticalOffset={headerHeight}
    >
      <FlatList
        data={commentsQ.data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <PostCard
            post={{ ...post, like_count: likeCountFor(post) }}
            likedByMe={isLiked(post)}
            onToggleLike={toggleLike}
            onOpenComments={() => undefined}
            onOpenProfile={(username) => router.push(`/user/${username}`)}
            onMore={(p) => onMore(p, () => router.back())}
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
      <View
        style={[
          styles.composer,
          { paddingBottom: spacing.sm + (keyboardShown ? 0 : insets.bottom) },
        ]}
      >
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
  listContent: { paddingBottom: spacing.md },
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
