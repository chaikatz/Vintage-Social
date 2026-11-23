import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showAlert } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { colors, spacing, type } from "@/theme";
import { fetchPost, updateCaption } from "@/api/posts";
import { MAX_CAPTION_LENGTH } from "@/utils/validation";
import { rewritePostEverywhere } from "@/utils/postCache";
import { KEYBOARD_DONE } from "@/components/KeyboardDone";
import { MentionSuggestions } from "@/components/MentionSuggestions";
import { useMentionField } from "@/hooks/useMentionField";
import { useSession } from "@/providers/SessionProvider";
import { useSheetKeyboardLift } from "@/hooks/useSheetKeyboardLift";

// A row that breaks this sheet breaks only this sheet, with the way back on its
// page: a sheet has no back button (src/navigation/Recover.tsx).
export { RecoverPageWithBack as ErrorBoundary } from "@/navigation/Recover";

/**
 * Change the words under your own photograph.
 *
 * Nothing else moves: the picture, the place, the dates, the likes and the
 * comments stay exactly as they were. The database admits the author
 * alone; this screen just holds the draft — and keeps holding it if the
 * save fails, so a dropped connection costs a retry, not the words.
 */
export default function EditCaption() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const { postId } = useLocalSearchParams<{ postId: string }>();

  const postQ = useQuery({
    queryKey: ["post", postId],
    queryFn: () => fetchPost(postId ?? ""),
    enabled: Boolean(postId),
  });
  const [draft, setDraft] = useState<string | null>(null);
  const caption = draft ?? postQ.data?.caption ?? "";
  const unchanged = caption.trim() === (postQ.data?.caption ?? "").trim();
  // An @name in the caption: the members it could be, over Cancel and Save while it is written.
  const captionField = useMentionField(caption, setDraft, MAX_CAPTION_LENGTH);
  // The sheet rises by as far as the keyboard comes up, so Cancel and Save,
  // and the members offered over them, sit just above it. KeyboardAvoidingView
  // measured this sheet from its own top and left all three under the keyboard.
  const lift = useSheetKeyboardLift();

  const save = useMutation({
    mutationFn: () => updateCaption(postId ?? "", caption),
    onSuccess: () => {
      // Every list that holds this post shows the new words at once —
      // the feed, the grids, explore, the single page — no restart, no
      // refetch first. The refetch follows to confirm.
      rewritePostEverywhere(queryClient, postId ?? "", (p) => ({ ...p, caption: caption.trim() }));
      queryClient.invalidateQueries({ queryKey: ["post", postId] });
      router.back();
    },
    // In our words: "Only the author can change a caption." (updateCaption) is
    // shown as it is; the database's own text, or an error object printed as
    // "[object Object]", never is (src/utils/errorMessage.ts).
    onError: (err) => showAlert("Couldn’t save", errorMessage(err, "Your words are still here. Try again in a moment.")),
  });

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: "Edit caption" }} />
      <View style={[styles.root, { paddingBottom: lift }]}>
        <View style={styles.body}>
          <Text style={styles.eyebrow}>Caption</Text>
          <TextInput
            inputAccessoryViewID={KEYBOARD_DONE}
            value={caption}
            onChangeText={(t) => setDraft(t.slice(0, MAX_CAPTION_LENGTH))}
            onSelectionChange={captionField.onSelectionChange}
            onFocus={captionField.onFocus}
            onBlur={captionField.onBlur}
            multiline
            autoFocus
            placeholder="Optional — keep it quiet."
            placeholderTextColor={colors.inkFaint}
            style={styles.input}
            editable={!save.isPending && postQ.isFetched}
          />
          <Text style={styles.count}>
            {caption.length}/{MAX_CAPTION_LENGTH}
          </Text>
        </View>
        <View style={styles.suggestions}>
          <MentionSuggestions mention={captionField.mention} myId={session?.user?.id ?? ""} onPick={captionField.pick} />
        </View>
        <View style={styles.footer}>
          <Button title="Cancel" variant="secondary" onPress={() => router.back()} style={styles.half} disabled={save.isPending} />
          <Button
            title="Save"
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={unchanged || !postQ.isFetched}
            style={styles.half}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  eyebrow: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  input: {
    ...type.body,
    fontFamily: type.serif,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
    minHeight: 140,
    // A long caption scrolls in its own space, the line being written kept
    // in sight, rather than running on under the names and Save.
    flexShrink: 1,
    textAlignVertical: "top",
    paddingVertical: spacing.md,
  },
  count: { ...type.caption, fontSize: 12, color: colors.inkFaint, textAlign: "right" },
  footer: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  half: { flex: 1 },
  suggestions: { paddingHorizontal: spacing.lg },
});
