import React from "react";
import { AppState, Linking, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GateLayout } from "@/components/gate/GateLayout";
import { GateButton } from "@/components/gate/GateButton";
import { Wordmark } from "@/components/Wordmark";
import { colors, spacing, type } from "@/theme";
import { enterApp, useSession } from "@/providers/SessionProvider";
import { describeRedeem, fetchMyApplication, redeemInviteLink } from "@/api/membership";
import { deleteMyAccount } from "@/api/account";
import { slugFromInput } from "@/utils/inviteLink";
import { showAlert, showPrompt } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
import { SUPPORT_EMAIL, supportMailto } from "@/config/launch";
import { awaitsDecision, takesInvitation, waitingRoomState } from "@/components/gate/waitingRoom";
import { checkStatus } from "@/components/gate/checkStatus";
import { DELETION_KEEPS_REPORTS } from "@/legal/documents";

// A page at the door that breaks breaks only itself, not the whole app.
// There is no header and no tab bar here, so the way back is on the page
// (src/navigation/Recover.tsx): to the page before, or to Home, whose
// guard sends anyone not yet let in to the door or the waiting room.
export { RecoverPageWithBack as ErrorBoundary } from "@/navigation/Recover";

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
  // An account with no application of its own: an invitation refused after
  // the account was made, or an application that never reached the admins
  // (the app closed part-way). An invitation is taken here. To apply, the
  // words give the clean way: delete this account and apply afresh, under
  // any name. (Signed out, the Apply form given this account's email and
  // password also carries on with it, under the name it already has: the
  // form's check of the name is given them, src/api/membership.ts.)
  none: {
    title: "NO APPLICATION YET",
    body: "Your account is made, but no application or invitation of yours has reached us.\nIf a member invited you, enter the invitation below. To apply instead, delete this account and apply again.",
  },
};

export default function Pending() {
  const { session, profile, refreshProfile, signOut } = useSession();

  // Read for what it says (waitingRoom.ts): the profile alone told a
  // rejected applicant, and an account that never applied, that an
  // application had been received.
  const application = useQuery({
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
  // Settings is out of reach from here, so an account that is waiting, was
  // not accepted or is suspended is deleted from this screen (App Review
  // Guideline 5.1.1(v): every account the app makes can be deleted in it).
  // Above the redirect below, with the other hooks.
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = React.useState(false);
  // Signing out can wait a few seconds on the network (src/providers/
  // endSession.ts): the button shows it is at work, and a second tap,
  // checked and set in the tap itself, asks nothing more.
  const [signingOut, setSigningOut] = React.useState(false);
  const leaving = React.useRef(false);
  const approved = profile?.status === "approved";
  React.useEffect(() => {
    if (approved) enterApp();
  }, [approved]);

  // The screen also checks by itself: each time the app comes back to the
  // front, and every half minute while it is open. An applicant who is let
  // in while looking at this walks in without touching anything.
  React.useEffect(() => {
    if (!session) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshProfile().catch(() => undefined);
    });
    const t = setInterval(() => refreshProfile().catch(() => undefined), 30_000);
    return () => {
      sub.remove();
      clearInterval(t);
    };
  }, [session, refreshProfile]);

  if (session === null) return <Redirect href="/(gate)/landing" />;

  const status = waitingRoomState(profile?.status, application.isSuccess ? application.data : undefined);
  const copy = COPY[status] ?? COPY.applied;

  const checkAgain = async () => {
    setChecking(true);
    try {
      // The profile's read decides it; the application is read alongside,
      // not waited for (checkStatus.ts): offline it waits for the signal.
      const ok = await checkStatus(refreshProfile, application.refetch);
      setCheckFailed(!ok);
      setCheckedAt(new Date());
    } finally {
      setChecking(false);
    }
  };

  const leave = async () => {
    if (leaving.current) return;
    leaving.current = true;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      leaving.current = false;
      setSigningOut(false);
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
          await enterApp();
        } catch (err) {
          showAlert("Couldn’t join", errorMessage(err, "Your invitation wasn’t taken up. Check your connection and try again."));
        } finally {
          setRedeeming(false);
        }
      },
    );

  // The same two questions as Settings → Delete account. An admin is never
  // here (approved goes in), so there is no only-admin question to ask.
  // What stays is said as Settings says it: a suspended member here may
  // have filed reports, and those are kept (0031).
  const confirmDelete = () =>
    showAlert(
      "Delete your account?",
      `Your account, your application, and anything you posted or sent are removed for good. ${DELETION_KEEPS_REPORTS} This cannot be undone.`,
      [
        {
          text: "Delete account",
          style: "destructive",
          onPress: () =>
            showAlert("Are you sure?", "This is the last step. Your account is deleted now.", [
              {
                text: "Yes, delete my account",
                style: "destructive",
                onPress: async () => {
                  const userId = session?.user?.id;
                  if (!userId) return;
                  setDeleting(true);
                  try {
                    await deleteMyAccount(userId);
                    queryClient.clear();
                    await signOut();
                  } catch (err) {
                    setDeleting(false);
                    // deleteMyAccount removes the files before it asks the
                    // database to close the account, so a failure can come
                    // after the portrait has gone. A second try finishes it.
                    showAlert(
                      "Couldn’t delete the account",
                      errorMessage(
                        err,
                        "Your account is still here, but your portrait or photographs may already have been removed. Try again to finish deleting it.",
                      ),
                    );
                  }
                },
              },
              { text: "Keep my account", style: "cancel" },
            ]),
        },
        { text: "Cancel", style: "cancel" },
      ],
    );

  return (
    // It scrolls, as the other screens at the door do: at the largest text
    // sizes the words and the buttons are taller than the screen, and Sign
    // out and Delete my account, last of all, were below its bottom edge.
    // Where it all fits, the page is laid out exactly as before.
    <GateLayout back={false}>
      <View style={styles.center}>
        <Wordmark size={34} lineHeight={44} tracking={9} rule={24} gap={spacing.lg} style={styles.wordmark} />
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
        {takesInvitation(status) && status !== "none" ? (
          <View style={styles.inviteNote}>
            <Text style={styles.inviteLead}>Already know a member?</Text>
            <Text style={styles.inviteBody}>An invitation grants access.</Text>
          </View>
        ) : null}
        {(status === "suspended" || status === "none") && SUPPORT_EMAIL ? (
          <Text
            style={[styles.body, styles.link]}
            onPress={() =>
              Linking.openURL(supportMailto("VINTAGE membership") ?? "").catch(() =>
                showAlert("Write to us", `No mail account is set up on this phone. Our address is ${SUPPORT_EMAIL}.`),
              )
            }
            accessibilityRole="link"
          >
            {SUPPORT_EMAIL}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        {takesInvitation(status) ? (
          <GateButton title="I have an invitation" variant="solid" onPress={enterInvitation} loading={redeeming} disabled={deleting} />
        ) : null}
        {awaitsDecision(status) ? (
          <>
            <GateButton title="Check status" onPress={checkAgain} loading={checking} disabled={deleting} style={styles.gap} />
            {checkedAt ? (
              <Text style={styles.checked}>
                {checkFailed
                  ? "Couldn’t reach VINTAGE just now. Check your connection and try again."
                  : `Still waiting · checked ${checkedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. The moment a member lets you in, this screen opens the door.`}
              </Text>
            ) : null}
          </>
        ) : null}
        {/* While the account is being deleted, nothing else is asked of it. */}
        <GateButton title="Sign out" variant="quiet" onPress={leave} loading={signingOut} disabled={deleting} style={styles.gap} />
        <GateButton title="Delete my account" variant="quiet" onPress={confirmDelete} loading={deleting} disabled={signingOut} style={styles.gap} />
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
