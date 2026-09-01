import React, { useEffect, useState } from "react";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showAlert } from "@/utils/alert";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { colors, spacing, type } from "@/theme";
import { addComment, deleteOwnComment, fetchComments, fetchPost } from "@/api/posts";
import { removeComment } from "@/api/moderation";
import { useSession } from "@/providers/SessionProvider";
import { postAge } from "@/utils/time";
import { MAX_COMMENT_LENGTH } from "@/utils/validation";
import type { CommentWithAuthor } from "@/types/db";

/**
 * The comments on one photograph.
 *
 * Deliberately without the photograph. You reached this from a post you are
 * already looking at, and showing it again pushes the conversation off the
 * screen — so the caption sits at the top as the first thing said, and the
 * replies follow it.
 */
export default function Comments() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, isAdmin } = useSession();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const userId = session?.user?.id ?? "";
  const [draft, setDraft] = useState("");
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();

  const postQ = useQuery({
    queryKey: ["post", postId],
    queryFn: () => fetchPost(postId ?? ""),
    enabled: Boolean(postId),
  });
  const commentsQ = useQuery({
    queryKey: ["comments", postId],
    queryFn: () => fetchComments(postId ?? ""),
    enabled: Boolean(postId),
  });

  const post = postQ.data;

  const send = useMutation({
    mutationFn: () => addComment(userId, postId ?? "", draft),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["comments", postId] });
      queryClient.invalidateQueries({ queryKey: ["comment-previews"] });
      queryClient.invalidateQueries({ queryKey: ["post", postId] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  const onCommentLongPress = (comment: CommentWithAuthor) => {
    const own = comment.author_id === userId;
    if (own || isAdmin) {
      showAlert("Comment", undefined, [
        {
          text: own ? "Delete comment" : "Remove comment (admin)",
          style: "destructive",
          onPress: async () => {
            if (own) await deleteOwnComment(comment.id);
            else await removeComment(comment.id, "Removed from the comments view");
            queryClient.invalidateQueries({ queryKey: ["comments", postId] });
            queryClient.invalidateQueries({ queryKey: ["comment-previews"] });
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

  if (!post) {
    return <Screen>{postQ.isFetched ? <EmptyState title="This photograph is gone" /> : null}</Screen>;
  }

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
          post.caption ? (
            <View style={styles.captionRow}>
              <Pressable onPress={() => router.push(`/user/${post.author.username}`)}>
                <Avatar
                  path={post.author.avatar_url}
                  username={post.author.username}
                  size={28}
                />
              </Pressable>
              <View style={styles.body}>
                <Text style={styles.text}>
                  <Text style={styles.author}>{post.author.username}</Text> {post.caption}
                </Text>
                <Text style={styles.age}>{postAge(post.created_at)}</Text>
              </View>
            </View>
          ) : null
        }
        ListEmptyComponent={
          commentsQ.isFetched ? (
            <EmptyState title="No comments yet" body="Be the first to say something." />
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.comment} onLongPress={() => onCommentLongPress(item)}>
            <Pressable onPress={() => router.push(`/user/${item.author.username}`)}>
              <Avatar path={item.author.avatar_url} username={item.author.username} size={28} />
            </Pressable>
            <View style={styles.body}>
              <Text style={styles.text}>
                <Text style={styles.author}>{item.author.username}</Text> {item.body}
              </Text>
              <Text style={styles.age}>{postAge(item.created_at)}</Text>
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

/** Keeps the composer clear of the keyboard, and of the home indicator without it. */
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  listContent: { paddingVertical: spacing.sm },
  captionRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  comment: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  body: { flex: 1, marginLeft: spacing.sm + 2 },
  text: { ...type.body, fontSize: 14 },
  author: { fontWeight: "600" },
  age: { fontSize: 11, color: colors.inkFaint, marginTop: 2 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.paper,
    gap: spacing.md,
  },
  input: { flex: 1, maxHeight: 90, fontSize: 14, color: colors.ink, paddingVertical: 6 },
  send: { color: colors.accent, fontWeight: "600", fontSize: 14, paddingBottom: 8 },
  sendDisabled: { opacity: 0.4 },
});
