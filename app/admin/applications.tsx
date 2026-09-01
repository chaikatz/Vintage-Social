import React, { useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { colors, radii, spacing, type } from "@/theme";
import { decideApplication, fetchApplications } from "@/api/moderation";
import { postAge } from "@/utils/time";
import type { ApplicationStatus } from "@/types/db";

const TABS: ApplicationStatus[] = ["pending", "waitlisted", "approved", "rejected"];

export default function AdminApplications() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ApplicationStatus>("pending");

  const apps = useQuery({
    queryKey: ["admin-apps", tab],
    queryFn: () => fetchApplications(tab),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: Exclude<ApplicationStatus, "pending"> }) =>
      decideApplication(id, decision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-apps"] }),
  });

  return (
    <Screen padded={false}>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Text
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabActive]}
          >
            {t}
          </Text>
        ))}
      </View>
      <FlatList
        data={apps.data ?? []}
        keyExtractor={(a) => a.id}
        refreshing={apps.isRefetching}
        onRefresh={() => apps.refetch()}
        ListEmptyComponent={apps.isFetched ? <EmptyState title={`No ${tab} applications`} /> : null}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Avatar path={item.avatar_url} username={item.desired_username} size={44} />
              <View style={styles.cardHeaderText}>
                <Text style={styles.username}>{item.desired_username}</Text>
                <Text style={styles.meta}>
                  {item.full_name}
                  {item.city ? ` · ${item.city}` : ""} · {postAge(item.created_at)}
                </Text>
                {item.social_handle ? <Text style={styles.meta}>{item.social_handle}</Text> : null}
                {item.inviter ? <Text style={styles.meta}>nominated by {item.inviter}</Text> : null}
              </View>
            </View>
            <Text style={styles.reason}>“{item.reason}”</Text>
            {tab !== "approved" ? (
              <View style={styles.actions}>
                <Button
                  title="Approve"
                  small
                  onPress={() => decide.mutate({ id: item.id, decision: "approved" })}
                  style={styles.actionButton}
                />
                {tab !== "waitlisted" ? (
                  <Button
                    title="Waitlist"
                    variant="secondary"
                    small
                    onPress={() => decide.mutate({ id: item.id, decision: "waitlisted" })}
                    style={styles.actionButton}
                  />
                ) : null}
                {tab !== "rejected" ? (
                  <Button
                    title="Reject"
                    variant="danger"
                    small
                    onPress={() => decide.mutate({ id: item.id, decision: "rejected" })}
                    style={styles.actionButton}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.lg,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  tab: { ...type.label, paddingVertical: 4 },
  tabActive: { color: colors.ink, fontWeight: "700" },
  card: {
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    backgroundColor: colors.paper,
  },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  cardHeaderText: { marginLeft: spacing.md, flex: 1 },
  username: { fontSize: 15, fontWeight: "600", color: colors.ink },
  meta: { fontSize: 12, color: colors.inkFaint, marginTop: 1 },
  reason: {
    ...type.body,
    fontSize: 14,
    fontStyle: "italic",
    color: colors.inkSoft,
    marginTop: spacing.md,
    backgroundColor: colors.paperSunken,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  actions: { flexDirection: "row", marginTop: spacing.md, gap: spacing.sm },
  actionButton: { flex: 1 },
});
