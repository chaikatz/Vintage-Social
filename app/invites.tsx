import React from "react";
import { Alert, FlatList, Share, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { colors, radii, spacing, type } from "@/theme";
import { createInvite, fetchMyInvites } from "@/api/membership";
import { useSession } from "@/providers/SessionProvider";

/**
 * Approved members receive a small number of invitations. Each code admits
 * one person, immediately.
 */
export default function Invites() {
  const queryClient = useQueryClient();
  const { session, profile } = useSession();
  const userId = session?.user?.id ?? "";

  const invites = useQuery({
    queryKey: ["invites", userId],
    queryFn: () => fetchMyInvites(userId),
    enabled: Boolean(userId),
  });

  const mint = useMutation({
    mutationFn: createInvite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invites", userId] }),
    onError: (err) =>
      Alert.alert("No invitations left", err instanceof Error ? err.message : String(err)),
  });

  const used = (invites.data ?? []).filter((i) => i.used_by).length;
  const minted = (invites.data ?? []).length;
  const remaining = Math.max(0, (profile?.invite_quota ?? 0) - minted);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Text style={styles.headline}>
          {remaining} invitation{remaining === 1 ? "" : "s"} left
        </Text>
        <Text style={styles.sub}>
          {minted} created · {used} used. Choose people who love photographs.
        </Text>
        <Button
          title="Create an invitation code"
          variant="secondary"
          onPress={() => mint.mutate()}
          loading={mint.isPending}
          disabled={remaining <= 0}
          style={styles.mintButton}
        />
      </View>
      <FlatList
        data={invites.data ?? []}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={
          invites.isFetched ? (
            <EmptyState title="No codes yet" body="Create one and pass it along quietly." />
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.inviteRow}>
            <Text style={[styles.code, item.used_by && styles.codeUsed]}>{item.code}</Text>
            {item.used_by ? (
              <Text style={styles.usedLabel}>used</Text>
            ) : (
              <Button
                title="Share"
                variant="quiet"
                small
                onPress={() =>
                  Share.share({
                    message: `You’re invited to VINTAGE. Use code ${item.code} in the app.`,
                  })
                }
              />
            )}
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  headline: { ...type.title },
  sub: { ...type.caption, marginTop: spacing.xs },
  mintButton: { marginTop: spacing.lg },
  inviteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  code: {
    fontFamily: type.mono,
    fontSize: 16,
    letterSpacing: 2,
    color: colors.ink,
    backgroundColor: colors.paperSunken,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  codeUsed: { color: colors.inkFaint, textDecorationLine: "line-through" },
  usedLabel: { ...type.caption, color: colors.inkFaint },
});
