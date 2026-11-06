import React, { useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { showAlert } from "@/utils/alert";
import { Redirect, useRouter } from "expo-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/providers/SessionProvider";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { colors, radii, spacing, type } from "@/theme";
import {
  fetchReports,
  nextAdminCursor,
  removeComment,
  removePost,
  resolveReport,
  type AdminCursor,
  type ReportWithRefs,
} from "@/api/moderation";
import { fetchProfileById } from "@/api/profiles";
import { undecided, withIds, withoutIds } from "@/components/decidedRows";
import { pagesOf, rowsOf, withRowsBack, withoutRows, type QueuePages } from "@/components/admin/queuePages";
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

/**
 * What a report is about that is gone since it was filed: its reference
 * is cleared when the photograph, comment or account is deleted (0001,
 * on delete set null), and the queue offered nothing but Dismiss without
 * saying why. Null while the thing is there.
 */
function goneSince(report: ReportWithRefs): string | null {
  if (report.target_type === "post" && !report.post_id) return "This photograph has since been deleted. The report can be dismissed.";
  if (report.target_type === "comment" && !report.comment) return "This comment has since been deleted. The report can be dismissed.";
  if (report.target_type === "profile" && !report.profile_id) return "This member’s account no longer exists. The report can be dismissed.";
  return null;
}

export default function AdminReports() {
  const router = useRouter();
  // Opened by a link by someone who is not an admin: nothing is read for
  // them, and they are sent home below.
  const { isAdmin, profileLoaded } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ReportStatus>("open");

  // Fifty at a time, the next fifty as the list nears its end: one read of
  // fifty used to be all the screen ever showed (src/api/moderation.ts).
  const reports = useInfiniteQuery({
    queryKey: ["admin-reports", tab],
    queryFn: ({ pageParam }) => fetchReports(tab, pageParam),
    initialPageParam: null as AdminCursor | null,
    getNextPageParam: (last) => nextAdminCursor(last),
    enabled: isAdmin,
  });
  const rows = useMemo(() => rowsOf(reports.data), [reports.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-reports"] });

  // A report leaves the open list the moment it is acted on, so it cannot
  // be acted on twice (a second Remove sent the author a second notice),
  // and a refusal puts that one back and says why. Dismiss used to fail
  // in silence. While an action is on its way its reports stay off the
  // list whatever a read brings back.
  //
  // A removal also closes the other open reports on the same photograph
  // or comment, in every page read so far: their own Remove removed it
  // again and sent its author another notice. What this screen has
  // removed is remembered, so a report left open (one of those that
  // failed to close, one whose removal went through but whose closing did
  // not, or one on a page not yet read when the removal was made) is
  // closed by its Remove without removing anything again; so is a
  // comment the admins removed before. (A removal made on another screen
  // is made once by the database since 0030.)
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
      if (target && !removed.current.has(target) && !report.comment?.removed_at) {
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
      const held = queryClient.getQueryData<QueuePages<ReportWithRefs>>(openKey);
      const order = rowsOf(held).map((r) => r.id);
      const homes = pagesOf(held, ids);
      queryClient.setQueryData<QueuePages<ReportWithRefs>>(openKey, (pages) => withoutRows(pages, ids));
      return { order, homes };
    },
    onSuccess: async (_done, { report, also }) => {
      // Taken: a read that left before it was cannot bring them back.
      const ids = [report.id, ...also.map((r) => r.id)];
      await queryClient.cancelQueries({ queryKey: openKey });
      queryClient.setQueryData<QueuePages<ReportWithRefs>>(openKey, (pages) => withoutRows(pages, ids));
    },
    onError: (err, { report, also }, ctx) => {
      queryClient.setQueryData<QueuePages<ReportWithRefs>>(openKey, (pages) =>
        withRowsBack(pages, [report, ...also], ctx?.order ?? [], ctx?.homes ?? {}),
      );
      showAlert("Action failed", errorMessage(err, "Nothing changed. Try again in a moment."));
    },
    onSettled: (_done, _err, { report, also }) => {
      setDeciding((d) => withoutIds(d, [report.id, ...also.map((r) => r.id)]));
      return refresh();
    },
  });
  // Every page read so far, so the reports closed with a removal are found
  // wherever they are in the list, not only in its first fifty.
  const shown = undecided(rows, deciding);
  const remove = (report: ReportWithRefs, action: "removePost" | "removeComment") =>
    act.mutate({ report, action, also: sameTarget(shown, report) });

  // A reported comment opens on its photograph's comments, where it was said.
  const openTarget = (report: ReportWithRefs) => {
    if (report.post_id) router.push(`/post/${report.post_id}`);
    else if (report.comment) router.push({ pathname: "/comments", params: { postId: report.comment.post_id } });
  };

  // A member report carries the member's name (fetchReports); a report
  // read without it finds their page by id.
  const openMember = async (report: ReportWithRefs) => {
    if (report.member) {
      router.push(`/user/${report.member.username}`);
      return;
    }
    if (!report.profile_id) return;
    try {
      const member = await fetchProfileById(report.profile_id);
      if (member) router.push(`/user/${member.username}`);
      else showAlert("Not found", "This member’s account no longer exists. The report can be dismissed.");
    } catch (err) {
      showAlert("Couldn’t open the member", errorMessage(err, "Try again in a moment."));
    }
  };

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
        data={shown}
        keyExtractor={(r) => r.id}
        refreshing={reports.isRefetching}
        onRefresh={() => reports.refetch()}
        onEndReached={() => {
          if (reports.hasNextPage && !reports.isFetchingNextPage && !reports.isFetchNextPageError) reports.fetchNextPage();
        }}
        onEndReachedThreshold={1}
        ListFooterComponent={
          reports.isFetchNextPageError ? <LoadFailed what="the rest" onRetry={() => reports.fetchNextPage()} /> : null
        }
        ListEmptyComponent={
          reports.isError && !reports.data ? (
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
            {/* What was reported, so it is never removed or dismissed unseen: the comment's words and who wrote them, the member's name. */}
            {item.comment ? (
              <Text style={styles.resolution}>
                {item.comment.author?.username ?? "unknown"}: “{item.comment.body}”
                {item.comment.removed_at ? " · removed" : ""}
              </Text>
            ) : null}
            {item.member ? <Text style={styles.resolution}>Member: {item.member.username}</Text> : null}
            {tab === "open" && goneSince(item) ? <Text style={styles.details}>{goneSince(item)}</Text> : null}
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
                  <>
                    {item.comment ? (
                      <Button title="View" variant="secondary" small onPress={() => openTarget(item)} style={styles.action} />
                    ) : null}
                    <Button
                      title="Remove comment"
                      variant="danger"
                      small
                      onPress={() => remove(item, "removeComment")}
                      style={styles.action}
                    />
                  </>
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
