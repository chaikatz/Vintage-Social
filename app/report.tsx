import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { showAlert } from "@/utils/alert";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { colors, radii, spacing, type } from "@/theme";
import { REPORT_REASONS, submitReport } from "@/api/moderation";
import { useSession } from "@/providers/SessionProvider";
import { removePostEverywhere } from "@/utils/postCache";
import type { ReportTargetType } from "@/types/db";
import { errorMessage } from "@/utils/errorMessage";

// A sheet has no back button: its recover page carries one (src/navigation/Recover.tsx).
export { RecoverPageWithBack as ErrorBoundary } from "@/navigation/Recover";

/**
 * Reporting goes to human admins. Nothing here is automated — reports feed
 * the moderation queue where a person decides what happens.
 *
 * A photograph the member reports leaves their own feed, Explore and grids
 * the moment the report is in, whatever an admin later decides: taken out
 * of what is on screen here, and kept out of every read after by the
 * database (0033), from the member's own reports. Nobody else's view
 * changes. Admins see everything, as they must to act on it.
 *
 * Reported from its own page, the photograph would be there again the
 * moment this screen closed: that page keeps what it shows while it is
 * on screen. So Done closes the page too, back to wherever it was opened
 * from (a thread, Activity, a member's photographs), or, when the page
 * was the first screen (opened from a link), to Home.
 */
export default function Report() {
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { session, isAdmin } = useSession();
  const params = useLocalSearchParams<{
    targetType: ReportTargetType;
    postId?: string;
    commentId?: string;
    profileId?: string;
  }>();

  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  // Checked and set in the tap itself, and kept once the report is in: a
  // second tap before the button went quiet sent the report twice.
  const sending = useRef(false);

  const submit = async () => {
    if (!session?.user?.id || !reason || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await submitReport({
        reporterId: session.user.id,
        targetType: params.targetType ?? "post",
        postId: params.postId,
        commentId: params.commentId,
        profileId: params.profileId,
        reason,
        details,
      });
      const targetType = params.targetType ?? "post";
      const hidden = targetType === "post" && params.postId && !isAdmin ? params.postId : null;
      if (hidden) void removePostEverywhere(queryClient, hidden);
      showAlert("Thank you", "An admin will take a look.", [
        { text: "Done", onPress: () => leave(hidden) },
      ]);
    } catch (err) {
      sending.current = false;
      showAlert("Couldn’t send report", errorMessage(err, "Your report isn’t sent yet. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };

  // Back to the screen beneath, unless it is the page of the photograph
  // just reported (see above): then that page goes too.
  const leave = (hidden: string | null) => {
    const state = navigation.getState();
    const index = state?.index ?? 0;
    const below = state?.routes[index - 1];
    const ownPage =
      hidden != null && below?.name === "post/[id]" && (below.params as { id?: string } | undefined)?.id === hidden;
    if (!ownPage) {
      router.back();
    } else if (index >= 2) {
      router.dismiss(2);
    } else {
      router.dismissAll();
      router.replace("/");
    }
  };

  return (
    <Screen scroll>
      <Text style={styles.intro}>
        VINTAGE is a quiet place. Reports are reviewed by admins — real people,
        not automation.
      </Text>
      {REPORT_REASONS.map((r) => (
        <Pressable
          key={r}
          style={[styles.reason, reason === r && styles.reasonSelected]}
          onPress={() => setReason(r)}
          accessibilityRole="radio"
          accessibilityState={{ checked: reason === r }}
        >
          <Text style={[styles.reasonText, reason === r && styles.reasonTextSelected]}>{r}</Text>
        </Pressable>
      ))}
      <View style={styles.detailsWrap}>
        <TextField
          label="Anything else? (optional)"
          value={details}
          onChangeText={setDetails}
          multiline
        />
      </View>
      <Button title="Send report" onPress={submit} loading={busy} disabled={!reason} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { ...type.caption, marginTop: spacing.lg, marginBottom: spacing.lg },
  reason: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.paperRaised,
  },
  reasonSelected: { borderColor: colors.ink, backgroundColor: colors.paperSunken },
  reasonText: { fontSize: 14, color: colors.inkSoft },
  reasonTextSelected: { color: colors.ink, fontWeight: "600" },
  detailsWrap: { marginTop: spacing.md },
});
