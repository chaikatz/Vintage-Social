import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { colors, radii, spacing, type } from "@/theme";
import { REPORT_REASONS, submitReport } from "@/api/moderation";
import { useSession } from "@/providers/SessionProvider";
import type { ReportTargetType } from "@/types/db";

/**
 * Reporting goes to human admins. Nothing here is automated — reports feed
 * the moderation queue where a person decides what happens.
 */
export default function Report() {
  const router = useRouter();
  const { session } = useSession();
  const params = useLocalSearchParams<{
    targetType: ReportTargetType;
    postId?: string;
    commentId?: string;
    profileId?: string;
  }>();

  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!session?.user?.id || !reason) return;
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
      Alert.alert("Thank you", "An admin will take a look.", [
        { text: "Done", onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert("Couldn’t send report", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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
