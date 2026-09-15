import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showAlert } from "@/utils/alert";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { colors, radii, spacing, type } from "@/theme";
import { fetchBlockedProfiles, unblockMember } from "@/api/blocks";
import { useSession } from "@/providers/SessionProvider";

/** The members you have blocked, and the way back. */
export default function Blocked() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";

  const blocked = useQuery({
    queryKey: ["blocked", userId],
    queryFn: () => fetchBlockedProfiles(userId),
    enabled: Boolean(userId),
  });

  const unblock = useMutation({
    mutationFn: (id: string) => unblockMember(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blocked", userId] });
      queryClient.invalidateQueries();
    },
    onError: (err) => showAlert("Couldn’t unblock", err instanceof Error ? err.message : String(err)),
  });

  return (
    <Screen padded={false}>
      <FlatList
        data={blocked.data ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={styles.intro}>
            A blocked member cannot see your photographs or profile, and you will not see theirs. Neither
            of you is told.
          </Text>
        }
        ListEmptyComponent={
          blocked.isFetched ? <EmptyState title="Nobody blocked" body="You can block a member from their profile." /> : null
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Avatar path={item.avatar_url} username={item.username} size={40} />
            <View style={styles.rowText}>
              <Text style={styles.username}>{item.username}</Text>
              {item.full_name ? <Text style={styles.fullName}>{item.full_name}</Text> : null}
            </View>
            <Pressable
              style={styles.unblock}
              onPress={() => unblock.mutate(item.id)}
              disabled={unblock.isPending}
              accessibilityRole="button"
            >
              <Text style={styles.unblockText}>Unblock</Text>
            </Pressable>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.xxl },
  intro: { ...type.caption, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, lineHeight: 19 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  rowText: { flex: 1 },
  username: { fontSize: 15, color: colors.ink },
  fullName: { ...type.caption, marginTop: 1 },
  unblock: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.paperRaised,
  },
  unblockText: { fontSize: 13, fontWeight: "600", color: colors.ink },
});
