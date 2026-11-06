import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, radii, spacing, type } from "@/theme";
import { mediaUrl } from "@/api/media";
import {
  fetchConversationPeer,
  fetchMessages,
  fetchMessagesSince,
  markConversationRead,
  sendMessage,
} from "@/api/messages";
import { markedRead, readThread, unreadIds } from "@/utils/threadPoll";
import { useSession } from "@/providers/SessionProvider";
import { showAlert } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
import { PHOTOGRAPH_UNAVAILABLE, newestUnreadFrom, photographUnavailable } from "@/utils/messageText";
import { postAge } from "@/utils/time";
import { useMinute } from "@/utils/useMinute";
import { MAX_MESSAGE_LENGTH } from "@/utils/validation";
import type { MessageWithPost } from "@/types/db";
import { KEYBOARD_DONE } from "@/components/KeyboardDone";
import { useImageRetry } from "@/media/imageRetry";

// A row that breaks this screen breaks only this screen (src/navigation/Recover.tsx).
export { RecoverPage as ErrorBoundary } from "@/navigation/Recover";

/**
 * One conversation. Messages are plain: words, or a photograph passed along
 * with a line about it. No reactions, no read receipts beyond marking the
 * thread seen, no typing indicators — the point is to say something, not to
 * be watched saying it.
 */
export default function Thread() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";
  const { id } = useLocalSearchParams<{ id: string }>();
  const [draft, setDraft] = useState("");
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  const focused = useIsFocused();

  const peerQ = useQuery({
    queryKey: ["conversation-peer", id, userId],
    queryFn: () => fetchConversationPeer(id ?? "", userId),
    enabled: Boolean(id && userId),
  });
  // When this screen last read the whole thread: it reads it whole as it
  // opens, and then only what is new (src/utils/threadPoll.ts).
  const lastWholeAt = useRef(0);
  const messagesQ = useQuery({
    queryKey: ["messages", id],
    queryFn: async () => {
      const key = ["messages", id];
      const read = await readThread({
        held: queryClient.getQueryData<MessageWithPost[]>(key),
        // Something said the thread changed, or the last read failed.
        invalidated: queryClient.getQueryState(key)?.isInvalidated ?? false,
        lastWholeAt: lastWholeAt.current,
        now: Date.now(),
        whole: () => fetchMessages(id ?? ""),
        since: (from, limit) => fetchMessagesSince(id ?? "", from, limit),
      });
      if (read.whole) lastWholeAt.current = Date.now();
      return read.messages;
    },
    enabled: Boolean(id),
    // A reply that arrives while the thread is open shows up on its own —
    // only while it is the screen on view.
    refetchInterval: focused ? 5000 : false,
  });
  // Newest at the bottom, and the list opens there: an inverted list is
  // laid out from its end, so the latest message and anything sent or
  // received lands on screen rather than below it.
  const newestFirst = useMemo(() => [...(messagesQ.data ?? [])].reverse(), [messagesQ.data]);

  // Opening the thread is what marks it read: once there is something of
  // theirs unread in it, and again for each new one that arrives, keyed
  // on the newest (messageText.ts). It used to be written on every read
  // of the thread, before it had even loaded, and each write sent the
  // inbox and the badge to read every message again.
  const newestUnread = useMemo(() => newestUnreadFrom(messagesQ.data, userId), [messagesQ.data, userId]);
  useEffect(() => {
    if (!id || !userId || !newestUnread) return;
    // What this mark is for: the messages unread as it is sent. One a poll
    // adds while it is on its way may land after the server has marked the
    // thread, and keeps its own mark (src/utils/threadPoll.ts).
    const marking = unreadIds(queryClient.getQueryData<MessageWithPost[]>(["messages", id]), userId);
    markConversationRead(id, userId)
      .then(() => {
        // Marked here too: the polls bring only new messages, and these
        // would otherwise stay unread in the thread held, to be marked
        // again the next time it is opened.
        const at = new Date().toISOString();
        queryClient.setQueryData<MessageWithPost[]>(["messages", id], (held) =>
          held ? markedRead(held, userId, at, marking) : held,
        );
        queryClient.invalidateQueries({ queryKey: ["conversations", userId] });
        queryClient.invalidateQueries({ queryKey: ["unread-messages", userId] });
      })
      // Not marked this time; the next message, or the next visit, marks it.
      .catch(() => undefined);
  }, [id, userId, newestUnread, queryClient]);

  // The same function for every row, so typing in the field below, which
  // draws this screen again on each letter, leaves the bubbles as they are.
  const openPost = useCallback((postId: string) => router.push(`/post/${postId}`), [router]);
  const renderBubble = useCallback(
    ({ item }: { item: MessageWithPost }) => (
      <Bubble message={item} mine={item.sender_id === userId} onOpenPost={openPost} />
    ),
    [userId, openPost],
  );

  const send = useMutation({
    mutationFn: () => sendMessage(id ?? "", userId, draft),
    onSuccess: () => {
      setDraft("");
      // What is new, the message just sent with it: read now, not whole.
      void queryClient.refetchQueries({ queryKey: ["messages", id] });
      queryClient.invalidateQueries({ queryKey: ["conversations", userId] });
    },
    onError: (err) => showAlert("Couldn’t send", errorMessage(err, "Your words are still here. Try again in a moment.")),
  });

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen options={{ title: peerQ.data?.username ?? "" }} />
      <FlatList
        data={newestFirst}
        inverted
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        renderItem={renderBubble}
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
          onChangeText={(t) => setDraft(t.slice(0, MAX_MESSAGE_LENGTH))}
          placeholder="Write something…"
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
            Send
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const Bubble = React.memo(function Bubble({
  message,
  mine,
  onOpenPost,
}: {
  message: MessageWithPost;
  mine: boolean;
  onOpenPost: (postId: string) => void;
}) {
  // Its age moves on with the app's one clock, not with whatever else on
  // the screen happens to be drawn again.
  const now = new Date(useMinute());
  const shared = message.post;
  const thumb = shared
    ? mediaUrl("thumbnails", shared.thumb_path) ?? mediaUrl("media", shared.media_path)
    : null;
  // A photograph that fails to load is asked for again (src/media/imageRetry.ts).
  const retry = useImageRetry(thumb);

  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {shared ? (
          <Pressable style={styles.shared} onPress={() => onOpenPost(shared.id)}>
            {thumb ? (
              <Image
                source={thumb}
                style={styles.sharedImage}
                contentFit="cover"
                // In memory as well as on disk: a bubble scrolled back to
                // was read from disk and decoded again each time.
                cachePolicy="memory-disk"
                key={retry.attempt}
                onError={retry.onError}
              />
            ) : null}
            {/* A photograph whose author the reader may not see comes without one. */}
            {shared.author ? (
              <Text style={[styles.sharedCaption, mine && styles.textMine]} numberOfLines={1}>
                {shared.author.username}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
        {message.body ? (
          <Text style={[styles.body, mine && styles.textMine]}>{message.body}</Text>
        ) : null}
        {photographUnavailable(message) ? (
          <Text style={[styles.unavailable, mine && styles.unavailableMine]}>{PHOTOGRAPH_UNAVAILABLE}</Text>
        ) : null}
        <Text style={[styles.age, mine && styles.ageMine]}>{postAge(message.created_at, now)}</Text>
      </View>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  listContent: { paddingVertical: spacing.md },
  bubbleRow: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  rowMine: { alignItems: "flex-end" },
  rowTheirs: { alignItems: "flex-start" },
  bubble: {
    maxWidth: "78%",
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleTheirs: { backgroundColor: colors.paperRaised, borderColor: colors.border },
  bubbleMine: { backgroundColor: colors.shutter, borderColor: colors.shutter },
  body: { ...type.body, fontSize: 14 },
  textMine: { color: colors.onShutter },
  unavailable: { fontFamily: type.serif, fontStyle: "italic", fontSize: 13, color: colors.inkSoft },
  unavailableMine: { color: colors.onShutter, opacity: 0.75 },
  age: { fontSize: 10, color: colors.inkFaint, marginTop: 4, textAlign: "right" },
  ageMine: { color: colors.onShutter, opacity: 0.6 },
  shared: { marginBottom: spacing.xs + 2 },
  sharedImage: {
    width: 180,
    height: 180,
    borderRadius: radii.sm,
    backgroundColor: colors.paperSunken,
  },
  sharedCaption: { fontSize: 11, color: colors.inkFaint, marginTop: 4 },
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
