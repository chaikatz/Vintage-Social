import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import { colors, spacing, type } from "@/theme";
import { useSession } from "@/providers/SessionProvider";
import { fetchMyApplication } from "@/api/membership";

const COPY: Record<string, { title: string; body: string }> = {
  applied: {
    title: "Application received",
    body: "An admin will review your application. We keep VINTAGE small on purpose, so this can take a little while.",
  },
  waitlisted: {
    title: "You’re on the waitlist",
    body: "We liked your application, but membership is limited right now. We’ll be in touch when a place opens.",
  },
  rejected: {
    title: "Not this time",
    body: "Your application wasn’t accepted. Thank you for your interest in VINTAGE.",
  },
  suspended: {
    title: "Account suspended",
    body: "Your membership is currently suspended. If you believe this is a mistake, contact the admins.",
  },
};

export default function Pending() {
  const router = useRouter();
  const { session, profile, refreshProfile, signOut } = useSession();

  useQuery({
    queryKey: ["my-application", session?.user?.id],
    queryFn: () => fetchMyApplication(session!.user.id),
    enabled: Boolean(session?.user?.id),
  });

  const status = profile?.status ?? "applied";
  const copy = COPY[status] ?? COPY.applied;

  const checkAgain = async () => {
    await refreshProfile();
    router.replace("/");
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <Text style={type.wordmark}>VINTAGE</Text>
        <View style={styles.rule} />
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
      </View>
      <View style={styles.actions}>
        {status === "applied" || status === "waitlisted" ? (
          <Button title="Check status" variant="secondary" onPress={checkAgain} />
        ) : null}
        <Button title="Sign out" variant="quiet" onPress={signOut} style={styles.gap} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: spacing.xl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  rule: { width: 56, height: 1, backgroundColor: colors.borderStrong, marginVertical: spacing.lg },
  title: { fontFamily: type.serif, fontSize: 18, color: colors.ink },
  body: { ...type.caption, textAlign: "center", marginTop: spacing.md, maxWidth: 280, lineHeight: 20 },
  actions: { paddingBottom: spacing.xl },
  gap: { marginTop: spacing.sm },
});
