import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { GateLayout } from "@/components/gate/GateLayout";
import { GateButton } from "@/components/gate/GateButton";
import { colors, spacing, type } from "@/theme";
import { useSession } from "@/providers/SessionProvider";
import { describeRedeem, fetchMyApplication, redeemInviteLink } from "@/api/membership";
import { slugFromInput } from "@/utils/inviteLink";
import { showAlert, showPrompt } from "@/utils/alert";
import { SUPPORT_EMAIL, supportMailto } from "@/config/launch";

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
    body: "Your membership is currently suspended. If you believe this is a mistake, write to us.",
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

  // Signing out from here has to actually leave. Without this the waitlist
  // screen stays on top of the stack with no session behind it, and the
  // applicant is stranded on "Application received" with no way back to the
  // door — the tab layout's guard never runs, because this is not a tab.
  if (session === null) return <Redirect href="/(gate)/landing" />;

  const status = profile?.status ?? "applied";
  const copy = COPY[status] ?? COPY.applied;

  const checkAgain = async () => {
    await refreshProfile();
    router.replace("/");
  };

  // Somebody on the waitlist who is then handed an invitation should not
  // have to make a second account. The code goes in here, with the account
  // they already have; the database grants membership, or says why not.
  const [redeeming, setRedeeming] = React.useState(false);
  const enterInvitation = () =>
    showPrompt(
      "Your invitation",
      "Enter the code or paste the link a member sent you.",
      async (input) => {
        const slug = slugFromInput(input ?? "");
        if (!slug) return;
        setRedeeming(true);
        try {
          const result = await redeemInviteLink(slug);
          const problem = describeRedeem(result);
          if (problem) {
            showAlert("Not this one", problem);
            return;
          }
          await refreshProfile();
          router.replace("/");
        } catch (err) {
          showAlert("Couldn’t join", err instanceof Error ? err.message : String(err));
        } finally {
          setRedeeming(false);
        }
      },
    );

  return (
    <GateLayout back={false} scroll={false}>
      <View style={styles.center}>
        <Text style={styles.wordmark}>Vintage</Text>
        <View style={styles.rule} />
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
        {status === "suspended" && SUPPORT_EMAIL ? (
          <Text
            style={[styles.body, styles.link]}
            onPress={() => Linking.openURL(supportMailto("VINTAGE membership") ?? "")}
            accessibilityRole="link"
          >
            {SUPPORT_EMAIL}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        {status === "applied" || status === "waitlisted" ? (
          <>
            <GateButton title="I have an invitation" variant="solid" onPress={enterInvitation} loading={redeeming} />
            <GateButton title="Check status" onPress={checkAgain} style={styles.gap} />
          </>
        ) : null}
        <GateButton title="Sign out" variant="quiet" onPress={signOut} style={styles.gap} />
      </View>
    </GateLayout>
  );
}

const styles = StyleSheet.create({
  link: { textDecorationLine: "underline", marginTop: 0 },
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
