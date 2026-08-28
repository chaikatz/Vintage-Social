import React, { useState } from "react";
import { FlatList, StyleSheet, TextInput, View } from "react-native";
import { showAlert, showPrompt } from "@/utils/alert";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { UserRow } from "@/components/UserRow";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { colors, radii, spacing } from "@/theme";
import { fetchMembers, setSuspension, warnMember } from "@/api/moderation";
import type { ProfileRow } from "@/types/db";

/**
 * Member moderation: warnings and suspensions, each an explicit admin
 * decision with a note the member sees in their activity.
 */
export default function AdminMembers() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");

  const members = useQuery({
    queryKey: ["admin-members", q],
    queryFn: () => fetchMembers(q),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-members"] });

  const warn = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => warnMember(id, note),
    onSuccess: () => showAlert("Warning sent"),
    onError: (err) => showAlert("Failed", err instanceof Error ? err.message : String(err)),
  });

  const suspend = useMutation({
    mutationFn: ({ id, suspended, note }: { id: string; suspended: boolean; note: string }) =>
      setSuspension(id, suspended, note),
    onSuccess: refresh,
    onError: (err) => showAlert("Failed", err instanceof Error ? err.message : String(err)),
  });

  const promptWarn = (member: ProfileRow) => {
    showPrompt(
      `Warn ${member.username}`,
      "The member sees this note in their activity.",
      (note) => warn.mutate({ id: member.id, note }),
      "Please keep VINTAGE quiet and personal — this is a gentle warning from the admins.",
    );
  };

  const toggleSuspension = (member: ProfileRow) => {
    const suspending = member.status !== "suspended";
    showAlert(
      suspending ? `Suspend ${member.username}?` : `Reinstate ${member.username}?`,
      suspending
        ? "They will lose access until reinstated. This is a human decision — make it carefully."
        : "They will regain full access.",
      [
        {
          text: suspending ? "Suspend" : "Reinstate",
          style: suspending ? "destructive" : "default",
          onPress: () =>
            suspend.mutate({
              id: member.id,
              suspended: suspending,
              note: suspending ? "Suspended by admin decision" : "Reinstated by admin decision",
            }),
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  };

  return (
    <Screen padded={false}>
      <View style={styles.searchWrap}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search members"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          style={styles.input}
        />
      </View>
      <FlatList
        data={members.data ?? []}
        keyExtractor={(m) => m.id}
        ListEmptyComponent={members.isFetched ? <EmptyState title="No members found" /> : null}
        renderItem={({ item }) => (
          <UserRow
            username={item.username}
            avatarPath={item.avatar_url}
            title={item.full_name}
            subtitle={`${item.status} · ${item.post_count} posts`}
            onPress={() => router.push(`/user/${item.username}`)}
            right={
              <View style={styles.actions}>
                <Button title="Warn" variant="secondary" small onPress={() => promptWarn(item)} />
                <Button
                  title={item.status === "suspended" ? "Reinstate" : "Suspend"}
                  variant="danger"
                  small
                  onPress={() => toggleSuspension(item)}
                />
              </View>
            }
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  input: {
    backgroundColor: colors.paperRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.ink,
  },
  actions: { flexDirection: "row", gap: spacing.xs },
});
