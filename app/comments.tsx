import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type AccessibilityActionEvent,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showAlert } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { MentionText, NameEdge, NameLink } from "@/components/MemberText";
import { MENTION_ROW_HEIGHT, MentionSuggestions } from "@/components/MentionSuggestions";
import { colors, spacing, type } from "@/theme";
import { addComment, fetchComments, fetchPost } from "@/api/posts";
import { showCommentMenu } from "@/utils/commentMenu";
import { useSession } from "@/providers/SessionProvider";
import { useOpenProfile } from "@/hooks/useOpenProfile";
import { useMentionField } from "@/hooks/useMentionField";
import { postAge } from "@/utils/time";
import { useNameFace } from "@/utils/nameFace";
import { useMinute } from "@/utils/useMinute";
import { rereadCommentPreviewsOf, rewritePostEverywhere } from "@/utils/postCache";
import { MAX_COMMENT_LENGTH } from "@/utils/validation";
import { insertAtCaret, mentionedUsernames } from "@/utils/mentions";
import { nameActions, nameFromAction } from "@/utils/nameActions";
import { QUICK_REACTIONS } from "@/utils/commentReactions";
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
  const queryClient = useQueryClient();
  const { session, isAdmin } = useSession();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const userId = session?.user?.id ?? "";
  const headerHeight = useHeaderHeight();
  // Editorial (Preview): who wrote each line, and every @name in it, in the names' face, at the size of the line (14 pt).
  const face = useNameFace();

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

  // A comment posted from the field below.
  const onPosted = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["comments", postId] });
    // The previews under this photograph, wherever it is shown; no others.
    void rereadCommentPreviewsOf(queryClient, postId ?? "");
    queryClient.invalidateQueries({ queryKey: ["post", postId] });
    countComment(1);
  }, [postId, queryClient, countComment]);

  // One function each for every row, so typing in the field below leaves
  // the comments as they are. A name opens its member's page, never a
  // second copy of the one just under this screen (src/hooks/useOpenProfile.ts).
  const openAuthor = useOpenProfile();
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
      <CommentRow comment={item} face={face} onLongPress={onCommentLongPress} onOpenAuthor={openAuthor} />
    ),
    [onCommentLongPress, openAuthor, face],
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
              <Pressable
                onPress={() => openAuthor(post.author.username)}
                accessibilityRole="button"
                accessibilityLabel={`${post.author.username}’s profile`}
              >
                <Avatar
                  path={post.author.avatar_url}
                  username={post.author.username}
                  size={28}
                />
              </Pressable>
              <View style={styles.body}>
                <Text style={styles.text}>
                  <NameEdge name={post.author.username} size={14} />
                  <NameLink username={post.author.username} onOpenProfile={openAuthor} style={[styles.author, face(14)]} />{" "}
                  <MentionText text={post.caption} onOpenProfile={openAuthor} size={14} />
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
      <Composer postId={postId ?? ""} userId={userId} onPosted={onPosted} />
    </KeyboardAvoidingView>
  );
}

const CommentRow = React.memo(function CommentRow({
  comment,
  face,
  onLongPress,
  onOpenAuthor,
}: {
  comment: CommentWithAuthor;
  /** Editorial (Preview): the face of the author's name (read once, by Comments). */
  face: ReturnType<typeof useNameFace>;
  onLongPress: (comment: CommentWithAuthor) => void;
  onOpenAuthor: (username: string) => void;
}) {
  // Its age moves on with the app's one clock, not with the typing below.
  const now = new Date(useMinute());
  const hold = () => onLongPress(comment);
  // To VoiceOver the row is one element: a double tap opens the comment's
  // menu, as a hold does, never a name under the middle of the row; the
  // names in it are its actions (src/utils/nameActions.ts).
  const actions = useMemo(
    () => nameActions([comment.author.username, ...mentionedUsernames(comment.body)]),
    [comment.author.username, comment.body],
  );
  const onAction = (e: AccessibilityActionEvent) => {
    const username = nameFromAction(e.nativeEvent.actionName);
    if (username) onOpenAuthor(username);
  };
  return (
    <Pressable
      style={styles.comment}
      onLongPress={() => onLongPress(comment)}
      onAccessibilityTap={hold}
      accessibilityActions={actions}
      onAccessibilityAction={onAction}
      accessibilityHint="Opens the comment’s options"
    >
      <Pressable
        onPress={() => onOpenAuthor(comment.author.username)}
        onLongPress={hold}
        accessibilityRole="button"
        accessibilityLabel={`${comment.author.username}’s profile`}
      >
        <Avatar path={comment.author.avatar_url} username={comment.author.username} size={28} />
      </Pressable>
      <View style={styles.body}>
        <Text style={styles.text}>
          {/* Held, a name or an @name opens the comment's menu, as the rest of the row does. */}
          <NameEdge name={comment.author.username} size={14} />
          <NameLink username={comment.author.username} onOpenProfile={onOpenAuthor} onLongPress={hold} style={[styles.author, face(14)]} />{" "}
          <MentionText text={comment.body} onOpenProfile={onOpenAuthor} onLongPress={hold} size={14} />
        </Text>
        <Text style={styles.age}>{postAge(comment.created_at, now)}</Text>
      </View>
    </Pressable>
  );
});

/**
 * Where a comment is written: the row of quick reactions, then the
 * member's own face beside a tall, rounded field with Post at its end,
 * clear of the home indicator, and over the keyboard while it is up. A
 * name started with @ swaps the reactions for the members it could be.
 *
 * The words live here, not on the screen, so typing draws this bar again
 * and nothing above it.
 */
function Composer({ postId, userId, onPosted }: { postId: string; userId: string; onPosted: () => void }) {
  const { profile } = useSession();
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  const input = useRef<TextInput>(null);
  const [draft, setDraft] = useState("");
  const field = useMentionField(draft, setDraft, MAX_COMMENT_LENGTH);

  const send = useMutation({
    mutationFn: (body: string) => addComment(userId, postId, body),
    onSuccess: () => {
      field.setCaret(0);
      setDraft("");
      onPosted();
    },
    // In our words: the server's are an object, which read "[object Object]".
    onError: (err) => showAlert("Couldn’t post the comment", errorMessage(err, "Your words are still here. Try again in a moment.")),
  });
  const ready = Boolean(draft.trim()) && !send.isPending;

  // A reaction goes in where the caret is, and the field is ready for more.
  // The same function for the whole of the bar's life, so the row of
  // reactions is not drawn again with every letter.
  const latest = useRef(draft);
  latest.current = draft;
  const { caretAt, setCaret, pick } = field;
  const react = useCallback(
    (emoji: string) => {
      const next = insertAtCaret(latest.current, caretAt(), emoji, MAX_COMMENT_LENGTH);
      if (!next) return;
      setCaret(next.caret);
      setDraft(next.text);
      input.current?.focus();
    },
    [caretAt, setCaret],
  );
  // A member chosen for an @name: written in, and the field ready for the rest.
  const choose = useCallback(
    (username: string) => {
      pick(username);
      input.current?.focus();
    },
    [pick],
  );

  return (
    <View
      style={[
        styles.composer,
        // Over the keyboard while it is up; otherwise clear of the home indicator, with room to spare.
        { paddingBottom: keyboardShown ? spacing.sm : insets.bottom + spacing.sm },
      ]}
    >
      <MentionSuggestions
        mention={field.mention}
        myId={userId}
        onPick={choose}
        fallback={<Reactions onReact={react} />}
      />
      <View style={styles.inputRow}>
        <View style={styles.me} accessible={false} importantForAccessibility="no-hide-descendants">
          <Avatar path={profile?.avatar_url} username={profile?.username ?? "?"} size={34} />
        </View>
        <View style={styles.field}>
          <TextInput
            ref={input}
            inputAccessoryViewID={KEYBOARD_DONE}
            value={draft}
            onChangeText={(t) => setDraft(t.slice(0, MAX_COMMENT_LENGTH))}
            onSelectionChange={field.onSelectionChange}
            onFocus={field.onFocus}
            onBlur={field.onBlur}
            placeholder="Add a comment…"
            placeholderTextColor={colors.inkFaint}
            style={styles.input}
            accessibilityLabel="Comment"
            multiline
          />
          <Pressable
            disabled={!ready}
            onPress={() => send.mutate(draft)}
            hitSlop={8}
            style={styles.post}
            accessibilityRole="button"
            accessibilityLabel="Post comment"
            accessibilityState={{ disabled: !ready, busy: send.isPending }}
          >
            {send.isPending ? (
              <ActivityIndicator size="small" color={colors.inkSoft} />
            ) : (
              <Text style={[styles.send, !ready && styles.sendDisabled]} maxFontSizeMultiplier={POST_TYPE_CAP}>
                Post
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * The quick reactions, edge to edge over the field (src/utils/commentReactions.ts).
 * They share the row: each as wide as REACTION_MAX at most, narrower on a
 * phone too small for eight of those, so the last is never cut off.
 */
const Reactions = React.memo(function Reactions({ onReact }: { onReact: (emoji: string) => void }) {
  return (
    <View style={styles.reactions}>
      {QUICK_REACTIONS.map((r) => (
        <Pressable
          key={r.name}
          onPress={() => onReact(r.emoji)}
          hitSlop={4}
          style={({ pressed }) => [styles.reaction, pressed && styles.reactionPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Add ${r.name.toLowerCase()}`}
        >
          <Text style={styles.reactionText} allowFontScaling={false}>
            {r.emoji}
          </Text>
        </Pressable>
      ))}
    </View>
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

/** The field's height for a single line: a comfortable thumb's width, past the 44 points iOS asks of a target. */
const FIELD_HEIGHT = 46;
/** The widest a reaction's target grows; on a 320-point phone the eight share what is left between the margins. */
const REACTION_MAX = 44;
/** How far Post's word grows with the reader's text size: past it the word would outgrow the field. */
const POST_TYPE_CAP = 1.8;

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
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    backgroundColor: colors.paper,
    gap: spacing.xs,
  },
  // As tall as the row of members that takes its place while an @name is
  // written, so the field does not move under the thumb as one starts or ends.
  reactions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: MENTION_ROW_HEIGHT,
  },
  reaction: {
    flex: 1,
    maxWidth: REACTION_MAX,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  reactionPressed: { backgroundColor: colors.paperSunken },
  reactionText: { fontSize: 24 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm + 2 },
  // The face sits level with the field's first line, however tall the field grows.
  me: { height: FIELD_HEIGHT, justifyContent: "center" },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    minHeight: FIELD_HEIGHT,
    borderRadius: FIELD_HEIGHT / 2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.paperRaised,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
  },
  input: {
    flex: 1,
    minHeight: FIELD_HEIGHT - 2,
    maxHeight: 120,
    fontSize: 15,
    color: colors.ink,
    paddingTop: 12,
    paddingBottom: 12,
  },
  post: {
    minWidth: 52,
    minHeight: FIELD_HEIGHT - 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  send: { color: colors.accent, fontWeight: "600", fontSize: 15 },
  // Waiting for words: still there to be seen, in the faint ink, not washed out.
  sendDisabled: { color: colors.inkFaint },
});
