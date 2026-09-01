import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { colors, radii, spacing, type } from "@/theme";
import { decideFollowRequest, fetchPendingRequests } from "@/api/profiles";
import { useSession } from "@/providers/SessionProvider";

/**
 * Who has asked to follow you, while your account is private. Each one is a
 * decision you make by hand — nothing is accepted for you, and declining
 * simply removes the request rather than recording a rejection.
 */
export default function Requests() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";

  const requests = useQuery({
    queryKey: ["follow-requests", userId],
    queryFn: () => fetchPendingRequests(userId),
    enabled: Boolean(userId),
  });

  const decide = useMutation({
    mutationFn: ({ followerId, accept }: { followerId: string; accept: boolean }) =>
      decideFollowRequest(followerId, userId, accept),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-requests", userId] });
      queryClient.invalidateQueries({ queryKey: ["activity", userId] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  return (
    <Screen padded={false}>
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
            >
              <Avatar path={item.avatar_url} username={item.username} size={44} />
              <View style={styles.personText}>
                <Text style={styles.username}>{item.username}</Text>
                {item.full_name ? <Text style={styles.fullName}>{item.full_name}</Text> : null}
              </View>
            </Pressable>
            <Pressable
              style={styles.accept}
              onPress={() => decide.mutate({ followerId: item.id, accept: true })}
            >
              <Text style={styles.acceptText}>Accept</Text>
            </Pressable>
            <Pressable
              style={styles.decline}
              onPress={() => decide.mutate({ followerId: item.id, accept: false })}
            >
              <Text style={styles.declineText}>Decline</Text>
            </Pressable>
          </View>
        )}
      />
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
