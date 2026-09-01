import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { GateLayout } from "@/components/gate/GateLayout";
import { GateButton } from "@/components/gate/GateButton";
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
    <GateLayout back={false} scroll={false}>
      <View style={styles.center}>
        <Text style={styles.wordmark}>Vintage</Text>
        <View style={styles.rule} />
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
      </View>
      <View style={styles.actions}>
        {status === "applied" || status === "waitlisted" ? (
          <GateButton title="Check status" onPress={checkAgain} />
        ) : null}
        <GateButton title="Sign out" variant="quiet" onPress={signOut} style={styles.gap} />
      </View>
    </GateLayout>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  wordmark: { fontFamily: type.script, fontSize: 52, lineHeight: 74, color: colors.gold },
  rule: {
    width: 48,
    height: 1,
    backgroundColor: colors.goldSoft,
    opacity: 0.55,
    marginVertical: spacing.lg,
  },
  title: { fontFamily: type.serif, fontSize: 19, color: colors.gold },
  body: {
    fontFamily: type.serif,
    fontSize: 14,
    lineHeight: 22,
    color: colors.goldSoft,
    textAlign: "center",
    marginTop: spacing.md,
    maxWidth: 290,
  },
  actions: { paddingBottom: spacing.md },
  gap: { marginTop: spacing.sm },
});
