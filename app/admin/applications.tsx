import React, { useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/providers/SessionProvider";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { undecided, withIds, withRowBack, withoutIds, withoutRow } from "@/components/decidedRows";
import { colors, radii, spacing, type } from "@/theme";
import { decideApplication, fetchApplications } from "@/api/moderation";
import { errorMessage } from "@/utils/errorMessage";
import { postAge } from "@/utils/time";
import type { ApplicationRow, ApplicationStatus } from "@/types/db";
import { showAlert } from "@/utils/alert";

const TABS: ApplicationStatus[] = ["pending", "waitlisted", "approved", "rejected"];

export default function AdminApplications() {
  // Opened by a link by someone who is not an admin: nothing is read for
  // them, and they are sent home below.
  const { isAdmin, profileLoaded } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ApplicationStatus>("pending");

  const apps = useQuery({
    queryKey: ["admin-apps", tab],
    queryFn: () => fetchApplications(tab),
    enabled: isAdmin,
  });

  // The card leaves the list the moment the decision is tapped and comes
  // back if the database refused it, with the reason on screen — a tap
  // that failed quietly used to look like a tap that did nothing.
  // A refusal puts back that card alone: putting back the whole list as
  // it was before the tap also brought back the cards decided since. And
  // while a decision is on its way its card stays off whatever a read
  // brings back, so it cannot be decided twice.
  const [deciding, setDeciding] = useState<ReadonlySet<string>>(() => new Set());
  const decide = useMutation({
    mutationFn: ({ app, decision }: { app: ApplicationRow; decision: Exclude<ApplicationStatus, "pending"> }) =>
      decideApplication(app.id, decision),
    onMutate: async ({ app }) => {
      setDeciding((ids) => withIds(ids, [app.id]));
      const key = ["admin-apps", tab];
      await queryClient.cancelQueries({ queryKey: key });
      const order = (queryClient.getQueryData<ApplicationRow[]>(key) ?? []).map((r) => r.id);
      queryClient.setQueryData<ApplicationRow[]>(key, (rows) => withoutRow(rows, app.id));
      return { key, order };
    },
    onSuccess: async (_done, { app }, ctx) => {
      // Taken: a read that left before it was cannot bring it back.
      await queryClient.cancelQueries({ queryKey: ctx.key });
      queryClient.setQueryData<ApplicationRow[]>(ctx.key, (rows) => withoutRow(rows, app.id));
    },
    onError: (err, { app }, ctx) => {
      if (ctx) queryClient.setQueryData<ApplicationRow[]>(ctx.key, (rows) => withRowBack(rows, app, ctx.order));
      showAlert("That decision didn’t take", errorMessage(err, "The application is back in the list. Try again in a moment."));
    },
    onSettled: (_done, _err, { app }) => {
      setDeciding((ids) => withoutIds(ids, [app.id]));
      return queryClient.invalidateQueries({ queryKey: ["admin-apps"] });
    },
  });

  // After every hook: a member who is not an admin never sees this, even from a link.
  if (profileLoaded && !isAdmin) return <Redirect href="/(tabs)" />;

  return (
    <Screen padded={false}>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Text
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === t }}
          >
            {t}
          </Text>
        ))}
      </View>
      <FlatList
        data={undecided(apps.data, deciding)}
        keyExtractor={(a) => a.id}
        refreshing={apps.isRefetching}
        onRefresh={() => apps.refetch()}
        ListEmptyComponent={
          apps.isError ? (
            <LoadFailed what="the applications" onRetry={() => apps.refetch()} />
          ) : apps.isFetched ? (
            <EmptyState title={`No ${tab} applications`} />
          ) : null
        }
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
                {item.inviter ? <Text style={styles.meta}>invited by {item.inviter}</Text> : null}
              </View>
            </View>
            <Text style={styles.reason}>“{item.reason}”</Text>
            {tab !== "approved" ? (
              <View style={styles.actions}>
                <Button
                  title="Approve"
                  small
                  onPress={() => decide.mutate({ app: item, decision: "approved" })}
                  style={styles.actionButton}
                />
                {tab !== "waitlisted" ? (
                  <Button
                    title="Waitlist"
                    variant="secondary"
                    small
                    onPress={() => decide.mutate({ app: item, decision: "waitlisted" })}
                    style={styles.actionButton}
                  />
                ) : null}
                {tab !== "rejected" ? (
                  <Button
                    title="Reject"
                    variant="danger"
                    small
                    onPress={() => decide.mutate({ app: item, decision: "rejected" })}
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
