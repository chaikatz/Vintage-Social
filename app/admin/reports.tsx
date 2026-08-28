import React, { useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { colors, radii, spacing, type } from "@/theme";
import { fetchReports, removePost, resolveReport, type ReportWithRefs } from "@/api/moderation";
import { postAge } from "@/utils/time";
import type { ReportStatus } from "@/types/db";

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

  const resolve = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: "resolved" | "dismissed"; note: string }) =>
      resolveReport(id, status, note),
    onSuccess: refresh,
  });

  const removeReportedPost = useMutation({
    mutationFn: async (report: ReportWithRefs) => {
      if (report.post_id) await removePost(report.post_id, `Removed after report: ${report.reason}`);
      await resolveReport(report.id, "resolved", "Content removed");
    },
    onSuccess: refresh,
    onError: (err) => Alert.alert("Action failed", err instanceof Error ? err.message : String(err)),
  });

  const openTarget = (report: ReportWithRefs) => {
    if (report.post_id) router.push(`/post/${report.post_id}`);
  };

  return (
    <Screen padded={false}>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Text key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            {t}
          </Text>
        ))}
      </View>
      <FlatList
        data={reports.data ?? []}
        keyExtractor={(r) => r.id}
        refreshing={reports.isRefetching}
        onRefresh={() => reports.refetch()}
        ListEmptyComponent={reports.isFetched ? <EmptyState title={`No ${tab} reports`} /> : null}
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
                      onPress={() => removeReportedPost.mutate(item)}
                      style={styles.action}
                    />
                  </>
                ) : null}
                <Button
                  title="Dismiss"
                  variant="secondary"
                  small
                  onPress={() => resolve.mutate({ id: item.id, status: "dismissed", note: "No action needed" })}
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
