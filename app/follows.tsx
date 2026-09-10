import React, { useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { UserRow } from "@/components/UserRow";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Bone } from "@/components/Skeleton";
import { spacing } from "@/theme";
import { fetchFollowers, fetchFollowing, follow, unfollow } from "@/api/profiles";
import { useSession } from "@/providers/SessionProvider";
import type { FollowStatus, ProfileRow } from "@/types/db";

/**
 * Who follows a member, and who they follow.
 *
 * A plain list: face, name, and — for anyone who isn't you — the same
 * Follow button their profile carries. Tapping a row goes through to the
 * profile. There is no count of mutuals, no "suggested", nothing sorted
 * by anything but who they are.
 */
export default function Follows() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const myId = session?.user?.id ?? "";
  const { userId, kind, username } = useLocalSearchParams<{
    userId: string;
    kind: "followers" | "following";
    username?: string;
  }>();
  const followers = kind === "followers";

  const list = useQuery({
    queryKey: ["follows", userId, kind],
    queryFn: () => (followers ? fetchFollowers(userId ?? "") : fetchFollowing(userId ?? "")),
    enabled: Boolean(userId),
  });

  // Who I already follow, so every row can say so without a query each.
  const mine = useQuery({
    queryKey: ["following", myId],
    queryFn: () => fetchFollowing(myId),
    enabled: Boolean(myId),
  });
  const followingIds = useMemo(() => new Set((mine.data ?? []).map((p) => p.id)), [mine.data]);

  // What a tap did, until the lists are re-read: a private member's Follow
  // becomes "Requested", not "Following".
  const [decided, setDecided] = useState<Record<string, FollowStatus | null>>({});

  const toggle = useMutation({
    mutationFn: async ({ target, next }: { target: ProfileRow; next: boolean }) => {
      if (next) return follow(myId, target.id);
      await unfollow(myId, target.id);
      return null;
    },
    onSuccess: (status, { target }) => {
      setDecided((d) => ({ ...d, [target.id]: status }));
      queryClient.invalidateQueries({ queryKey: ["following", myId] });
      queryClient.invalidateQueries({ queryKey: ["follow-state", myId, target.id] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  const stateFor = (p: ProfileRow): FollowStatus | null =>
    p.id in decided ? decided[p.id] : followingIds.has(p.id) ? "accepted" : null;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: followers ? "Followers" : "Following" }} />
      <FlatList
        data={list.data ?? []}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={
          list.isFetched ? (
            <EmptyState
              title={followers ? "No followers yet" : "Not following anyone"}
              body={
                followers
                  ? username
                    ? `Nobody follows ${username} yet.`
                    : undefined
                  : username
                    ? `${username} isn't following anyone yet.`
                    : undefined
              }
            />
          ) : (
            <View style={styles.skeleton}>
              {[0, 1, 2, 3, 4].map((i) => (
                <View key={i} style={styles.skeletonRow}>
                  <Bone style={styles.skeletonAvatar} />
                  <View style={styles.skeletonText}>
                    <Bone style={styles.skeletonName} />
                    <Bone style={styles.skeletonMeta} />
                  </View>
                </View>
              ))}
            </View>
          )
        }
        renderItem={({ item }) => {
          const status = stateFor(item);
          const busy = toggle.isPending && toggle.variables?.target.id === item.id;
          return (
            <UserRow
              username={item.username}
              avatarPath={item.avatar_url}
              title={item.full_name}
              subtitle={item.city}
              onPress={() => router.push(`/user/${item.username}`)}
              right={
                item.id === myId ? undefined : (
                  <Button
                    title={status === "accepted" ? "Following" : status === "pending" ? "Requested" : "Follow"}
                    variant={status ? "secondary" : "primary"}
                    small
                    loading={busy}
                    onPress={() => toggle.mutate({ target: item, next: status === null })}
                    style={styles.button}
                  />
                )
              }
            />
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  button: { minWidth: 96 },
  skeleton: { paddingTop: spacing.sm },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  skeletonAvatar: { width: 44, height: 44, borderRadius: 22 },
  skeletonText: { flex: 1, marginLeft: spacing.md, gap: 6 },
  skeletonName: { width: 110, height: 11 },
  skeletonMeta: { width: 70, height: 9 },
});
