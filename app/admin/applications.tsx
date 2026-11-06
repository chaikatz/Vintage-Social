import React, { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/providers/SessionProvider";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { undecided, withIds, withoutIds } from "@/components/decidedRows";
import { pagesOf, rowsOf, withRowsBack, withoutRows, type QueuePages } from "@/components/admin/queuePages";
import { colors, radii, spacing, type } from "@/theme";
import { decideApplication, fetchApplications, nextAdminCursor, type AdminCursor } from "@/api/moderation";
import { errorMessage } from "@/utils/errorMessage";
import { postAge } from "@/utils/time";
import type { ApplicationRow, ApplicationStatus } from "@/types/db";
import { showAlert } from "@/utils/alert";
import { useNameFace } from "@/utils/nameFace";

// A row that breaks this page breaks only this page, with the way back on
// it as well as in the header: opened from a report's notification (0032)
// or a link, an admin page is the first in its stack and has no back
// button (src/navigation/Recover.tsx).
export { RecoverPageWithBack as ErrorBoundary } from "@/navigation/Recover";

const TABS: ApplicationStatus[] = ["pending", "waitlisted", "approved", "rejected"];

export default function AdminApplications() {
  // Opened by a link by someone who is not an admin: nothing is read for
  // them, and they are sent home below.
  const { isAdmin, profileLoaded } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ApplicationStatus>("pending");
  // Editorial (Preview): the username each applicant asked for, half bold.
  const face = useNameFace();

  // Fifty at a time (src/api/moderation.ts), the next fifty as the list
  // nears its end: one read of fifty used to be all the screen ever showed.
  const apps = useInfiniteQuery({
    queryKey: ["admin-apps", tab],
    queryFn: ({ pageParam }) => fetchApplications(tab, pageParam),
    initialPageParam: null as AdminCursor | null,
    getNextPageParam: (last) => nextAdminCursor(last),
    enabled: isAdmin,
  });
  const rows = useMemo(() => rowsOf(apps.data), [apps.data]);

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
      const held = queryClient.getQueryData<QueuePages<ApplicationRow>>(key);
      const order = rowsOf(held).map((r) => r.id);
      const homes = pagesOf(held, [app.id]);
      queryClient.setQueryData<QueuePages<ApplicationRow>>(key, (pages) => withoutRows(pages, [app.id]));
      return { key, order, homes };
    },
    onSuccess: async (_done, { app }, ctx) => {
      // Taken: a read that left before it was cannot bring it back.
      await queryClient.cancelQueries({ queryKey: ctx.key });
      queryClient.setQueryData<QueuePages<ApplicationRow>>(ctx.key, (pages) => withoutRows(pages, [app.id]));
    },
    onError: (err, { app }, ctx) => {
      if (ctx) queryClient.setQueryData<QueuePages<ApplicationRow>>(ctx.key, (pages) => withRowsBack(pages, [app], ctx.order, ctx.homes));
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
        data={undecided(rows, deciding)}
        keyExtractor={(a) => a.id}
        refreshing={apps.isRefetching}
        onRefresh={() => apps.refetch()}
        // Not while any read is on its way: asked for during the reread
        // that follows every decision, the next page cancelled that reread
        // (fetchNextPage cancels by default), and what other admins did
        // since stayed off the list until the next one.
        onEndReached={() => {
          if (apps.hasNextPage && !apps.isFetching && !apps.isFetchNextPageError) apps.fetchNextPage();
        }}
        onEndReachedThreshold={1}
        ListFooterComponent={
          apps.isFetchNextPageError ? <LoadFailed what="the rest" onRetry={() => apps.fetchNextPage()} /> : null
        }
        ListEmptyComponent={
          apps.isError && !apps.data ? (
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
                <Text style={[styles.username, face]}>{item.desired_username}</Text>
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
