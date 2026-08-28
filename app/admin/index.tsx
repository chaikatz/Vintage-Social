import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { colors, radii, spacing, type } from "@/theme";
import { fetchApplications, fetchReports } from "@/api/moderation";
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
