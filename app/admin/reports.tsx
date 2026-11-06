import React, { useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { showAlert } from "@/utils/alert";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { colors, radii, spacing, type } from "@/theme";
import { fetchReports, removeComment, removePost, resolveReport, type ReportWithRefs } from "@/api/moderation";
import { fetchProfileById } from "@/api/profiles";
import { undecided, withIds, withRowBack, withoutIds, withoutRow } from "@/components/decidedRows";
import { removalTarget, sameTarget } from "@/components/reportTargets";
import { errorMessage } from "@/utils/errorMessage";
import { postAge } from "@/utils/time";
import type { ReportStatus } from "@/types/db";

/**
 * What an admin can do with an open report. A reported photograph can be
 * removed, and so can a reported comment, which used to offer only
 * Dismiss; a reported member is opened, to be warned or suspended from
 * their profile or Members.
 */
type ReportAction = "dismiss" | "removePost" | "removeComment";

const TABS: ReportStatus[] = ["open", "resolved", "dismissed"];

export default function AdminReports() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ReportStatus>("open");

  const reports = useQuery({
    queryKey: ["admin-reports", tab],
    queryFn: () => fetchReports(tab),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-reports"] });

  // A report leaves the open list the moment it is acted on, so it cannot
  // be acted on twice (a second Remove sent the author a second notice),
  // and a refusal puts that one back and says why. Dismiss used to fail
  // in silence. While an action is on its way its reports stay off the
  // list whatever a read brings back.
  //
  // A removal also closes the other open reports on the same photograph
  // or comment: their own Remove removed it again and sent its author
  // another notice. What this screen has removed is remembered, so a
  // report left open (one of those that failed to close, or one whose
  // removal went through but whose closing did not) is closed by its
  // Remove without removing anything again.
  const removed = useRef(new Set<string>());
  const [deciding, setDeciding] = useState<ReadonlySet<string>>(() => new Set());
  const openKey = ["admin-reports", "open"];
  const act = useMutation({
    mutationFn: async ({ report, action, also }: { report: ReportWithRefs; action: ReportAction; also: ReportWithRefs[] }) => {
      const note = `Removed after report: ${report.reason}`;
      if (action === "dismiss") {
        await resolveReport(report.id, "dismissed", "No action needed");
        return;
      }
      const target = removalTarget(report);
      if (target && !removed.current.has(target)) {
        if (action === "removePost" && report.post_id) await removePost(report.post_id, note);
        if (action === "removeComment" && report.comment_id) await removeComment(report.comment_id, note);
        removed.current.add(target);
      }
      await resolveReport(report.id, "resolved", "Content removed");
      await Promise.allSettled(also.map((r) => resolveReport(r.id, "resolved", "Content removed")));
    },
    onMutate: async ({ report, also }) => {
      const ids = [report.id, ...also.map((r) => r.id)];
      setDeciding((d) => withIds(d, ids));
      await queryClient.cancelQueries({ queryKey: openKey });
      const order = (queryClient.getQueryData<ReportWithRefs[]>(openKey) ?? []).map((r) => r.id);
      queryClient.setQueryData<ReportWithRefs[]>(openKey, (rows) => ids.reduce((list, id) => withoutRow(list, id), rows));
      return { order };
    },
    onSuccess: async (_done, { report, also }) => {
      // Taken: a read that left before it was cannot bring them back.
      const ids = [report.id, ...also.map((r) => r.id)];
      await queryClient.cancelQueries({ queryKey: openKey });
      queryClient.setQueryData<ReportWithRefs[]>(openKey, (rows) => ids.reduce((list, id) => withoutRow(list, id), rows));
    },
    onError: (err, { report, also }, ctx) => {
      queryClient.setQueryData<ReportWithRefs[]>(openKey, (rows) =>
        [report, ...also].reduce((list, r) => withRowBack(list, r, ctx?.order), rows),
      );
      showAlert("Action failed", errorMessage(err, "Nothing changed. Try again in a moment."));
    },
    onSettled: (_done, _err, { report, also }) => {
      setDeciding((d) => withoutIds(d, [report.id, ...also.map((r) => r.id)]));
      return refresh();
    },
  });
  const shown = undecided(reports.data, deciding);
  const remove = (report: ReportWithRefs, action: "removePost" | "removeComment") =>
    act.mutate({ report, action, also: sameTarget(shown, report) });

  const openTarget = (report: ReportWithRefs) => {
    if (report.post_id) router.push(`/post/${report.post_id}`);
  };

  // The report names the member by id only; their page is found by name.
  const openMember = async (report: ReportWithRefs) => {
    if (!report.profile_id) return;
    try {
      const member = await fetchProfileById(report.profile_id);
      if (member) router.push(`/user/${member.username}`);
      else showAlert("Not found", "This member’s account no longer exists. The report can be dismissed.");
    } catch (err) {
      showAlert("Couldn’t open the member", errorMessage(err, "Try again in a moment."));
    }
  };

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
        data={shown}
        keyExtractor={(r) => r.id}
        refreshing={reports.isRefetching}
        onRefresh={() => reports.refetch()}
        ListEmptyComponent={
          reports.isError ? (
            <LoadFailed what="the reports" onRetry={() => reports.refetch()} />
          ) : reports.isFetched ? (
            <EmptyState title={`No ${tab} reports`} />
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.headline}>
              {item.target_type} · reported by {item.reporter?.username ?? "unknown"} ·{" "}
              {postAge(item.created_at)}
            </Text>
            <Text style={styles.reason}>{item.reason}</Text>
            {item.details ? <Text style={styles.details}>“{item.details}”</Text> : null}
            {item.resolution_note ? (
              <Text style={styles.resolution}>Resolution: {item.resolution_note}</Text>
            ) : null}
            {tab === "open" ? (
              <View style={styles.actions}>
                {item.post_id ? (
                  <>
                    <Button title="View" variant="secondary" small onPress={() => openTarget(item)} style={styles.action} />
                    <Button
                      title="Remove content"
                      variant="danger"
                      small
                      onPress={() => remove(item, "removePost")}
                      style={styles.action}
                    />
                  </>
                ) : item.comment_id ? (
                  <Button
                    title="Remove comment"
                    variant="danger"
                    small
                    onPress={() => remove(item, "removeComment")}
                    style={styles.action}
                  />
                ) : item.profile_id ? (
                  <Button title="View member" variant="secondary" small onPress={() => openMember(item)} style={styles.action} />
                ) : null}
                <Button
                  title="Dismiss"
                  variant="secondary"
                  small
                  onPress={() => act.mutate({ report: item, action: "dismiss", also: [] })}
                  style={styles.action}
                />
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
  },
  headline: { fontSize: 12, color: colors.inkFaint },
  reason: { fontSize: 15, fontWeight: "600", color: colors.ink, marginTop: spacing.xs },
  details: { ...type.body, fontSize: 13, fontStyle: "italic", color: colors.inkSoft, marginTop: spacing.xs },
  resolution: {
    fontSize: 12,
    color: colors.inkSoft,
    marginTop: spacing.sm,
    backgroundColor: colors.paperSunken,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  actions: { flexDirection: "row", marginTop: spacing.md, gap: spacing.sm },
  action: { flex: 1 },
});
