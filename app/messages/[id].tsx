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
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, radii, spacing, type } from "@/theme";
import { mediaUrl } from "@/api/media";
import {
  fetchConversationPeer,
  fetchMessages,
  markConversationRead,
  sendMessage,
} from "@/api/messages";
import { useSession } from "@/providers/SessionProvider";
import { postAge } from "@/utils/time";
import { MAX_MESSAGE_LENGTH } from "@/utils/validation";
import type { MessageWithPost } from "@/types/db";

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

  const peerQ = useQuery({
    queryKey: ["conversation-peer", id, userId],
    queryFn: () => fetchConversationPeer(id ?? "", userId),
    enabled: Boolean(id && userId),
  });
  const messagesQ = useQuery({
    queryKey: ["messages", id],
    queryFn: () => fetchMessages(id ?? ""),
    enabled: Boolean(id),
  });

  // Opening the thread is what marks it read.
  useEffect(() => {
    if (id && userId) {
      markConversationRead(id, userId).then(() => {
        queryClient.invalidateQueries({ queryKey: ["conversations", userId] });
        queryClient.invalidateQueries({ queryKey: ["unread-messages", userId] });
      });
    }
  }, [id, userId, messagesQ.data, queryClient]);

  const send = useMutation({
    mutationFn: () => sendMessage(id ?? "", userId, draft),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["messages", id] });
      queryClient.invalidateQueries({ queryKey: ["conversations", userId] });
    },
  });

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen options={{ title: peerQ.data?.username ?? "" }} />
      <FlatList
        data={messagesQ.data ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Bubble
            message={item}
            mine={item.sender_id === userId}
            onOpenPost={(postId) => router.push(`/post/${postId}`)}
          />
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

function Bubble({
  message,
  mine,
  onOpenPost,
}: {
  message: MessageWithPost;
  mine: boolean;
  onOpenPost: (postId: string) => void;
}) {
  const shared = message.post;
  const thumb = shared
    ? mediaUrl("thumbnails", shared.thumb_path) ?? mediaUrl("media", shared.media_path)
    : null;

  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {shared ? (
          <Pressable style={styles.shared} onPress={() => onOpenPost(shared.id)}>
            {thumb ? <Image source={thumb} style={styles.sharedImage} contentFit="cover" /> : null}
            <Text style={[styles.sharedCaption, mine && styles.textMine]} numberOfLines={1}>
              {shared.author.username}
            </Text>
          </Pressable>
        ) : null}
        {message.body ? (
          <Text style={[styles.body, mine && styles.textMine]}>{message.body}</Text>
        ) : null}
        <Text style={[styles.age, mine && styles.ageMine]}>{postAge(message.created_at)}</Text>
      </View>
    </View>
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
  age: { fontSize: 10, color: colors.inkFaint, marginTop: 4, textAlign: "right" },
  ageMine: { color: "rgba(242, 235, 221, 0.55)" },
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
