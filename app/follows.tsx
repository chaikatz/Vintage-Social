import React, { useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { UserRow } from "@/components/UserRow";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { Bone } from "@/components/Skeleton";
import { spacing } from "@/theme";
import { fetchFollowPage, fetchFollowStates, follow, unfollow, type FollowCursor, type MemberRow } from "@/api/profiles";
import { useSession } from "@/providers/SessionProvider";
import { showAlert } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
import type { FollowStatus } from "@/types/db";

/**
 * Who follows a member, and who they follow.
 *
 * A plain list: face, name, and — for anyone who isn't you — the same
 * Follow button their profile carries. Tapping a row goes through to the
 * profile. There is no count of mutuals, no "suggested", nothing sorted
 * by anything but who they are.
 *
 * A page at a time, the newest follow first, the next asked for as the
 * reader nears the end: a member followed by thousands is read fifty rows
 * at a time, and none is cut off at PostgREST's thousand. Each page brings
 * where the reader stands with the members on it, so a row's button is
 * right without reading every follow the reader has made.
 */
export default function Follows() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, refreshProfile } = useSession();
  const myId = session?.user?.id ?? "";
  const { userId, kind, username } = useLocalSearchParams<{
    userId: string;
    kind: "followers" | "following";
    username?: string;
  }>();
  const followers = kind === "followers";

  const list = useInfiniteQuery({
    queryKey: ["follows", userId, kind, "pages"],
    queryFn: async ({ pageParam }) => {
      const page = await fetchFollowPage(followers ? "followers" : "following", userId ?? "", pageParam);
      // Where I stand with the members on this page. Everyone on my own
      // Following is followed; for anyone else's list, one read of these rows.
      const mine: Record<string, FollowStatus> =
        !followers && userId === myId
          ? Object.fromEntries(page.members.map((m) => [m.id, "accepted" as const]))
          : await fetchFollowStates(myId, page.members.map((m) => m.id));
      return { ...page, mine };
    },
    initialPageParam: null as FollowCursor | null,
    getNextPageParam: (last) => last.next,
    enabled: Boolean(userId),
  });
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (list.data?.pages ?? []).flatMap((p) => p.members).filter((m) => !seen.has(m.id) && Boolean(seen.add(m.id)));
  }, [list.data]);
  const standing = useMemo(
    () => Object.assign({}, ...(list.data?.pages ?? []).map((p) => p.mine)) as Record<string, FollowStatus>,
    [list.data],
  );

  // What a tap did, until the lists are re-read: a private member's Follow
  // becomes "Requested", not "Following".
  const [decided, setDecided] = useState<Record<string, FollowStatus | null>>({});

  const toggle = useMutation({
    mutationFn: async ({ target, next }: { target: MemberRow; next: boolean }) => {
      if (next) return follow(myId, target.id);
      await unfollow(myId, target.id);
      return null;
    },
    onSuccess: (status, { target }) => {
      setDecided((d) => ({ ...d, [target.id]: status }));
      queryClient.invalidateQueries({ queryKey: ["following", myId] });
      queryClient.invalidateQueries({ queryKey: ["follow-state", myId, target.id] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      refreshProfile().catch(() => undefined);
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
    // The button goes back to what it said; the member is told why.
    onError: (err, { next }) =>
      showAlert(next ? "Couldn’t follow" : "Couldn’t unfollow", errorMessage(err, "Nothing changed. Try again in a moment.")),
  });

  const stateFor = (p: MemberRow): FollowStatus | null =>
    p.id in decided ? decided[p.id] : standing[p.id] ?? null;

  if (list.isError && !list.data) {
    return (
      <Screen padded={false}>
        <Stack.Screen options={{ title: followers ? "Followers" : "Following" }} />
        <LoadFailed what={followers ? "the followers" : "who they follow"} onRetry={() => list.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: followers ? "Followers" : "Following" }} />
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) list.fetchNextPage();
        }}
        onEndReachedThreshold={1}
        ListFooterComponent={
          list.isFetchNextPageError ? (
            <LoadFailed what="the rest" onRetry={() => list.fetchNextPage()} />
          ) : null
        }
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
