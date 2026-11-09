import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { errorMessage } from "@/utils/errorMessage";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { colors, spacing, type } from "@/theme";
import { addComment, fetchComments, fetchPost } from "@/api/posts";
import { showCommentMenu } from "@/utils/commentMenu";
import { useSession } from "@/providers/SessionProvider";
import { postAge } from "@/utils/time";
import { useMinute } from "@/utils/useMinute";
import { rereadCommentPreviewsOf, rewritePostEverywhere } from "@/utils/postCache";
import { MAX_COMMENT_LENGTH } from "@/utils/validation";
import type { CommentWithAuthor, PostWithAuthor } from "@/types/db";
import { KEYBOARD_DONE } from "@/components/KeyboardDone";

// A row that breaks this screen breaks only this screen, with the way back on its
// page as well as in its header: a screen opened from a link has no back button
// (src/navigation/Recover.tsx).
export { RecoverPageWithBack as ErrorBoundary } from "@/navigation/Recover";

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
  // A comment whose author the reader may not see (a profile row-level
  // security keeps from them) comes back without one: left out, rather
  // than breaking the page on a name that is not there.
  const comments = useMemo(() => (commentsQ.data ?? []).filter((c) => c.author != null), [commentsQ.data]);

  // The count under the photograph, moved by one wherever the post is on
  // screen. The feed used to be re-read for it: every page loaded, one
  // after another, for one number. It is marked stale instead, so its
  // next ordinary read confirms the count.
  const countComment = useCallback(
    (step: 1 | -1) => {
      if (!postId) return;
      rewritePostEverywhere<PostWithAuthor>(queryClient, postId, (p) => ({
        ...p,
        comment_count: Math.max(0, p.comment_count + step),
      }));
      void queryClient.invalidateQueries({ queryKey: ["feed"], refetchType: "none" });
    },
    [postId, queryClient],
  );

  const send = useMutation({
    mutationFn: () => addComment(userId, postId ?? "", draft),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["comments", postId] });
      // The previews under this photograph, wherever it is shown; no others.
      void rereadCommentPreviewsOf(queryClient, postId ?? "");
      queryClient.invalidateQueries({ queryKey: ["post", postId] });
      countComment(1);
    },
    // In our words: the server's are an object, which read "[object Object]".
    onError: (err) => showAlert("Couldn’t post the comment", errorMessage(err, "Your words are still here. Try again in a moment.")),
  });

  // One function each for every row, so typing in the field below, which
  // draws this screen again on each letter, leaves the comments as they are.
  const openAuthor = useCallback((username: string) => router.push(`/user/${username}`), [router]);
  // The menu every comment has, wherever it is shown (src/utils/commentMenu.ts).
  const onCommentLongPress = useCallback(
    (comment: CommentWithAuthor) =>
      showCommentMenu(comment, { userId, isAdmin }, () => {
        queryClient.invalidateQueries({ queryKey: ["comments", postId] });
        void rereadCommentPreviewsOf(queryClient, postId ?? "");
        // The count under the photograph lives on the post row.
        queryClient.invalidateQueries({ queryKey: ["post", postId] });
        countComment(-1);
      }),
    [userId, isAdmin, postId, queryClient, countComment],
  );
  const renderComment = useCallback(
    ({ item }: { item: CommentWithAuthor }) => (
      <CommentRow comment={item} onLongPress={onCommentLongPress} onOpenAuthor={openAuthor} />
    ),
    [onCommentLongPress, openAuthor],
  );

  if (!post) {
    return (
      <Screen>
        {postQ.isError ? (
          <LoadFailed what="the comments" onRetry={() => postQ.refetch()} />
        ) : postQ.isFetched ? (
          <EmptyState title="This photograph is gone" />
        ) : null}
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <FlatList
        data={comments}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          post.caption && post.author ? (
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
          // A read that failed is no answer: "No comments yet" would not be true.
          commentsQ.isError ? (
            <LoadFailed what="the comments" onRetry={() => commentsQ.refetch()} />
          ) : commentsQ.isFetched ? (
            <EmptyState title="No comments yet" body="Be the first to say something." />
          ) : null
        }
        renderItem={renderComment}
      />
      <View
        style={[
          styles.composer,
          { paddingBottom: spacing.sm + (keyboardShown ? 0 : insets.bottom) },
        ]}
      >
        <TextInput
          inputAccessoryViewID={KEYBOARD_DONE}
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

const CommentRow = React.memo(function CommentRow({
  comment,
  onLongPress,
  onOpenAuthor,
}: {
  comment: CommentWithAuthor;
  onLongPress: (comment: CommentWithAuthor) => void;
  onOpenAuthor: (username: string) => void;
}) {
  // Its age moves on with the app's one clock, not with the typing below.
  const now = new Date(useMinute());
  return (
    <Pressable style={styles.comment} onLongPress={() => onLongPress(comment)}>
      <Pressable onPress={() => onOpenAuthor(comment.author.username)}>
        <Avatar path={comment.author.avatar_url} username={comment.author.username} size={28} />
      </Pressable>
      <View style={styles.body}>
        <Text style={styles.text}>
          <Text style={styles.author}>{comment.author.username}</Text> {comment.body}
        </Text>
        <Text style={styles.age}>{postAge(comment.created_at, now)}</Text>
      </View>
    </Pressable>
  );
});

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
