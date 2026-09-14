import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showAlert, showPrompt } from "@/utils/alert";
import { Screen } from "@/components/Screen";
import { colors, radii, spacing, type } from "@/theme";
import { fetchApplications, fetchDefaultInviteQuota, fetchReports, setDefaultInviteQuota } from "@/api/moderation";
import { useSession } from "@/providers/SessionProvider";

/** The admin dashboard. Only profiles with role = admin can see this. */
export default function AdminHome() {
  const router = useRouter();
  const { isAdmin, profileLoaded } = useSession();

  const pendingApps = useQuery({
    queryKey: ["admin-apps", "pending"],
    queryFn: () => fetchApplications("pending"),
    enabled: isAdmin,
  });
  const openReports = useQuery({
    queryKey: ["admin-reports", "open"],
    queryFn: () => fetchReports("open"),
    enabled: isAdmin,
  });
  const queryClient = useQueryClient();
  const defaultQuota = useQuery({
    queryKey: ["admin-default-quota"],
    queryFn: fetchDefaultInviteQuota,
    enabled: isAdmin,
  });
  const setDefault = useMutation({
    mutationFn: setDefaultInviteQuota,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-default-quota"] }),
    onError: (err) => showAlert("Failed", err instanceof Error ? err.message : String(err)),
  });
  const promptDefault = () =>
    showPrompt(
      "Invitations per new member",
      "Every member who joins from now on is given this many. Members already inside keep what they have.",
      (value) => {
        const n = Number.parseInt((value ?? "").trim(), 10);
        if (!Number.isInteger(n) || n < 0 || n > 1000) {
          showAlert("Not a number we can use", "Enter a whole number between 0 and 1000.");
          return;
        }
        setDefault.mutate(n);
      },
      String(defaultQuota.data ?? 5),
    );

  if (profileLoaded && !isAdmin) return <Redirect href="/(tabs)" />;

  const rows = [
    {
      icon: "inbox" as const,
      title: "Applications",
      sub: `${pendingApps.data?.length ?? 0} waiting for review`,
      href: "/admin/applications",
    },
    {
      icon: "flag" as const,
      title: "Reports",
      sub: `${openReports.data?.length ?? 0} open`,
      href: "/admin/reports",
    },
    {
      icon: "users" as const,
      title: "Members",
      sub: "Warn, suspend, reinstate",
      href: "/admin/members",
    },
  ];

  return (
    <Screen>
      <Text style={styles.intro}>
        Decisions here are made by people. Nothing in VINTAGE bans or removes
        automatically.
      </Text>
      <Pressable style={styles.row} onPress={promptDefault}>
        <Feather name="mail" size={20} color={colors.ink} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Invitations per member</Text>
          <Text style={styles.rowSub}>
            {defaultQuota.data != null ? `${defaultQuota.data} for each new member` : "The default allowance"}
          </Text>
        </View>
        <Feather name="edit-2" size={16} color={colors.inkFaint} />
      </Pressable>
      {rows.map((row) => (
        <Pressable key={row.href} style={styles.row} onPress={() => router.push(row.href)}>
          <Feather name={row.icon} size={20} color={colors.ink} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{row.title}</Text>
            <Text style={styles.rowSub}>{row.sub}</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.inkFaint} />
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { ...type.caption, marginTop: spacing.lg, marginBottom: spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.paperRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    marginBottom: spacing.md,
  },
  rowText: { flex: 1, marginLeft: spacing.md },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  rowSub: { fontSize: 12, color: colors.inkFaint, marginTop: 2 },
});
