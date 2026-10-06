import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { GateLayout } from "@/components/gate/GateLayout";
import { GateButton } from "@/components/gate/GateButton";
import { Wordmark } from "@/components/Wordmark";
import { colors, spacing, type } from "@/theme";
import { useSession } from "@/providers/SessionProvider";
import { describeRedeem, fetchMyApplication, redeemInviteLink } from "@/api/membership";
import { slugFromInput } from "@/utils/inviteLink";
import { showAlert, showPrompt } from "@/utils/alert";
import { SUPPORT_EMAIL, supportMailto } from "@/config/launch";

const COPY: Record<string, { title: string; body: string }> = {
  applied: {
    title: "APPLICATION RECEIVED",
    body: "Membership is currently limited.\nWe’ll be in touch if a place becomes available.",
  },
  waitlisted: {
    title: "APPLICATION RECEIVED",
    body: "Membership is currently limited.\nWe’ll be in touch if a place becomes available.",
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
  // Somebody on the waitlist who is then handed an invitation should not
  // have to make a second account. The code goes in here, with the account
  // they already have; the database grants membership, or says why not.
  // (Declared above the redirect below: a hook after an early return is
  // rendered on some passes and not others, and React throws — which was
  // "Sign out crashes the waitlist screen".)
  const [redeeming, setRedeeming] = React.useState(false);
  // "Check status": the profile is re-read, and the screen says what it
  // found. It used to replace itself with the root, which sent anyone still
  // waiting straight back here with nothing to show for the tap — so the
  // button looked broken. Now a member who has been let in is taken in,
  // and anyone still waiting is told so, with the time of the check.
  const [checking, setChecking] = React.useState(false);
  const [checkedAt, setCheckedAt] = React.useState<Date | null>(null);
  const [checkFailed, setCheckFailed] = React.useState(false);
  const approved = profile?.status === "approved";
  React.useEffect(() => {
    if (approved) router.replace("/");
  }, [approved, router]);

  if (session === null) return <Redirect href="/(gate)/landing" />;

  const status = profile?.status ?? "applied";
  const copy = COPY[status] ?? COPY.applied;

  const checkAgain = async () => {
    setChecking(true);
    try {
      const ok = await refreshProfile();
      setCheckFailed(!ok);
      setCheckedAt(new Date());
    } finally {
      setChecking(false);
    }
  };

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
        <Wordmark size={34} lineHeight={44} tracking={9} rule={24} gap={spacing.lg} style={styles.wordmark} />
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
        {status === "applied" || status === "waitlisted" ? (
          <View style={styles.inviteNote}>
            <Text style={styles.inviteLead}>Already know a member?</Text>
            <Text style={styles.inviteBody}>An invitation grants access.</Text>
          </View>
        ) : null}
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
            <GateButton title="Check status" onPress={checkAgain} loading={checking} style={styles.gap} />
            {checkedAt ? (
              <Text style={styles.checked}>
                {checkFailed
                  ? "Couldn’t check just now — try again in a moment."
                  : `Checked at ${checkedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} — still being read. We’ll let you know.`}
              </Text>
            ) : null}
          </>
        ) : null}
        <GateButton title="Sign out" variant="quiet" onPress={signOut} style={styles.gap} />
      </View>
    </GateLayout>
  );
}

const styles = StyleSheet.create({
  link: { textDecorationLine: "underline", marginTop: 0 },
  checked: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
    textAlign: "center",
    marginTop: spacing.md,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  wordmark: { marginBottom: spacing.lg },
  title: { fontFamily: type.serif, fontSize: 19, color: colors.ink },
  body: {
    fontFamily: type.serif,
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSoft,
    textAlign: "center",
    marginTop: spacing.md,
    maxWidth: 290,
  },
  inviteNote: { alignItems: "center", marginTop: spacing.xl },
  inviteLead: { fontFamily: type.serif, fontSize: 14, color: colors.ink, textAlign: "center" },
  inviteBody: { fontFamily: type.serif, fontSize: 14, lineHeight: 22, color: colors.inkSoft, textAlign: "center", marginTop: 3 },
  actions: { paddingBottom: spacing.md },
  gap: { marginTop: spacing.sm },
});
