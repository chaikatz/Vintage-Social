import React, { useEffect } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { colors, spacing } from "@/theme";
import { fetchActivity, markActivityRead } from "@/api/activity";
import { mediaUrl } from "@/api/media";
import { postAge } from "@/utils/time";
import { useSession } from "@/providers/SessionProvider";
import type { ActivityWithRefs } from "@/types/db";

function line(item: ActivityWithRefs): string {
  switch (item.type) {
    case "like":
      return "liked your photograph.";
    case "comment":
      return "commented on your photograph.";
    case "follow":
      return "started following you.";
    case "follow_request":
      return "asked to follow you.";
    case "message":
      return "sent you a message.";
    case "moderation":
      return item.message ?? "A note from the admins.";
  }
}

export default function Activity() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";

  const activity = useQuery({
    queryKey: ["activity", userId],
    queryFn: () => fetchActivity(userId),
    enabled: Boolean(userId),
  });

  // The pager keeps screens mounted, so clear the badge on each visit
  // rather than once at mount — and never while the tab is only preloaded.
  const isFocused = useIsFocused();
  useEffect(() => {
    if (isFocused && userId && activity.isFetched) {
      markActivityRead(userId).then(() =>
        queryClient.invalidateQueries({ queryKey: ["activity-unread"] }),
      );
    }
  }, [isFocused, userId, activity.isFetched, queryClient]);

  const open = (item: ActivityWithRefs) => {
    if (item.post) router.push(`/post/${item.post.id}`);
    else if (item.actor) router.push(`/user/${item.actor.username}`);
  };

  return (
    <Screen padded={false}>
      <FlatList
        data={activity.data ?? []}
        keyExtractor={(a) => a.id}
        refreshing={activity.isRefetching}
        onRefresh={() => activity.refetch()}
        ListEmptyComponent={
          activity.isFetched ? (
            <EmptyState title="Nothing yet" body="Likes, comments and new followers appear here." />
          ) : null
        }
        renderItem={({ item }) => {
          const thumb = item.post
            ? mediaUrl("thumbnails", item.post.thumb_path) ?? mediaUrl("media", item.post.media_path)
            : null;
          const isModeration = item.type === "moderation";
          return (
            <Pressable style={[styles.row, !item.read_at && styles.unread]} onPress={() => open(item)}>
              {isModeration ? (
                <View style={styles.moderationDot} />
              ) : (
                <Avatar path={item.actor?.avatar_url} username={item.actor?.username ?? "?"} size={40} />
              )}
              <View style={styles.text}>
                <Text style={styles.line}>
                  {!isModeration && item.actor ? (
                    <Text style={styles.actor}>{item.actor.username} </Text>
                  ) : (
                    <Text style={styles.actor}>VINTAGE </Text>
                  )}
                  {line(item)}
                </Text>
                <Text style={styles.age}>{postAge(item.created_at)}</Text>
              </View>
              {thumb ? <Image source={thumb} style={styles.thumb} /> : null}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  unread: { backgroundColor: colors.paperSunken },
  moderationDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.paperSunken,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  text: { flex: 1, marginHorizontal: spacing.md },
  line: { fontSize: 13, color: colors.ink, lineHeight: 18 },
  actor: { fontWeight: "600" },
  age: { fontSize: 11, color: colors.inkFaint, marginTop: 2 },
  thumb: { width: 40, height: 40, backgroundColor: colors.paperSunken },
});
