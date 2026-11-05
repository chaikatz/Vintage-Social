import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { withRowBack, withoutRow } from "@/components/decidedRows";
import { colors, radii, spacing, type } from "@/theme";
import { decideFollowRequest, fetchPendingRequests } from "@/api/profiles";
import { useSession } from "@/providers/SessionProvider";
import { showAlert } from "@/utils/alert";
import type { ProfileRow } from "@/types/db";

/**
 * Who has asked to follow you, while your account is private. Each one is a
 * decision you make by hand — nothing is accepted for you, and declining
 * simply removes the request rather than recording a rejection.
 */
export default function Requests() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, refreshProfile } = useSession();
  const userId = session?.user?.id ?? "";

  const requests = useQuery({
    queryKey: ["follow-requests", userId],
    queryFn: () => fetchPendingRequests(userId),
    enabled: Boolean(userId),
  });

  // A request leaves the list the moment it is decided, so it cannot be
  // decided twice (Accept, then Decline before the list was read again,
  // deleted the follow just accepted). A refusal puts that one back.
  const key = ["follow-requests", userId];
  const decide = useMutation({
    mutationFn: ({ follower, accept }: { follower: ProfileRow; accept: boolean }) =>
      decideFollowRequest(follower.id, userId, accept),
    onMutate: async ({ follower }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const order = (queryClient.getQueryData<ProfileRow[]>(key) ?? []).map((r) => r.id);
      queryClient.setQueryData<ProfileRow[]>(key, (rows) => withoutRow(rows, follower.id));
      return { order };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activity", userId] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["follows"] });
      refreshProfile().catch(() => undefined);
    },
    onError: (err, { follower }, ctx) => {
      queryClient.setQueryData<ProfileRow[]>(key, (rows) => withRowBack(rows, follower, ctx?.order));
      showAlert("That didn’t work", err instanceof Error ? err.message : String(err));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <Screen padded={false}>
      {requests.isError && !requests.data ? (
        <LoadFailed what="your requests" onRetry={() => requests.refetch()} />
      ) : (
        <FlatList
          data={requests.data ?? []}
          keyExtractor={(p) => p.id}
          ListEmptyComponent={
            requests.isFetched ? (
              <EmptyState
                title="Nothing waiting"
                body="When someone asks to follow you, they'll appear here."
              />
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                style={styles.person}
                onPress={() => router.push(`/user/${item.username}`)}
                accessibilityRole="button"
                accessibilityLabel={item.full_name ? `${item.username}, ${item.full_name}` : item.username}
              >
                <Avatar path={item.avatar_url} username={item.username} size={44} />
                <View style={styles.personText}>
                  <Text style={styles.username}>{item.username}</Text>
                  {item.full_name ? <Text style={styles.fullName}>{item.full_name}</Text> : null}
                </View>
              </Pressable>
              <Pressable
                style={styles.accept}
                onPress={() => decide.mutate({ follower: item, accept: true })}
                accessibilityRole="button"
                accessibilityLabel={`Accept ${item.username}`}
              >
                <Text style={styles.acceptText}>Accept</Text>
              </Pressable>
              <Pressable
                style={styles.decline}
                onPress={() => decide.mutate({ follower: item, accept: false })}
                accessibilityRole="button"
                accessibilityLabel={`Decline ${item.username}`}
              >
                <Text style={styles.declineText}>Decline</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  person: { flexDirection: "row", alignItems: "center", flex: 1, gap: spacing.md },
  personText: { flex: 1 },
  username: { fontSize: 15, color: colors.ink },
  fullName: { ...type.caption, marginTop: 1 },
  accept: {
    backgroundColor: colors.shutter,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  acceptText: { color: colors.onShutter, fontSize: 13, fontWeight: "600" },
  decline: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  declineText: { color: colors.inkSoft, fontSize: 13 },
});
