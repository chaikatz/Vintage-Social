import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { colors, spacing, type } from "@/theme";
import { fetchConversations } from "@/api/messages";
import { useSession } from "@/providers/SessionProvider";
import { postAge } from "@/utils/time";
import type { ConversationWithPeer } from "@/types/db";

/**
 * The inbox. One thread per member, newest first — no folders, no requests
 * queue, no "primary" and "general". If you can see someone on VINTAGE you
 * can write to them, and they will see it.
 */
export default function Messages() {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";

  const conversations = useQuery({
    queryKey: ["conversations", userId],
    queryFn: () => fetchConversations(userId),
    enabled: Boolean(userId),
  });

  return (
    <Screen padded={false}>
      <FlatList
        data={conversations.data ?? []}
        keyExtractor={(c) => c.id}
        refreshing={conversations.isRefetching}
        onRefresh={() => conversations.refetch()}
        ListEmptyComponent={
          conversations.isFetched ? (
            <EmptyState
              title="No messages"
              body="Open a member's profile and write to them, or send a photograph from the feed."
            />
          ) : null
        }
        renderItem={({ item }) => (
          <ConversationRow
            conversation={item}
            onPress={() => router.push(`/messages/${item.id}`)}
          />
        )}
      />
    </Screen>
  );
}

function ConversationRow({
  conversation,
  onPress,
}: {
  conversation: ConversationWithPeer;
  onPress: () => void;
}) {
  const last = conversation.last_message;
  const unread = conversation.unread_count > 0;
  const preview = last
    ? last.body || (last.post_id ? "Sent a photograph" : "")
    : "Say something.";

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Avatar
        path={conversation.peer.avatar_url}
        username={conversation.peer.username}
        size={46}
      />
      <View style={styles.rowText}>
        <Text style={[styles.username, unread && styles.unreadText]}>
          {conversation.peer.username}
        </Text>
        <Text style={[styles.preview, unread && styles.unreadText]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      {last ? <Text style={styles.age}>{postAge(last.created_at)}</Text> : null}
      {unread ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowText: { flex: 1 },
  username: { fontSize: 15, color: colors.ink },
  preview: { ...type.caption, marginTop: 2, color: colors.inkFaint },
  unreadText: { color: colors.ink, fontWeight: "600" },
  age: { ...type.caption, color: colors.inkFaint },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginLeft: spacing.xs,
  },
});
