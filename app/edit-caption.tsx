import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showAlert } from "@/utils/alert";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { colors, spacing, type } from "@/theme";
import { fetchPost, updateCaption } from "@/api/posts";
import { MAX_CAPTION_LENGTH } from "@/utils/validation";
import { rewritePostEverywhere } from "@/utils/postCache";

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
  const { postId } = useLocalSearchParams<{ postId: string }>();

  const postQ = useQuery({
    queryKey: ["post", postId],
    queryFn: () => fetchPost(postId ?? ""),
    enabled: Boolean(postId),
  });
  const [draft, setDraft] = useState<string | null>(null);
  const caption = draft ?? postQ.data?.caption ?? "";
  const unchanged = caption.trim() === (postQ.data?.caption ?? "").trim();

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
    onError: (err) => showAlert("Couldn’t save", err instanceof Error ? err.message : String(err)),
  });

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: "Edit caption" }} />
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.body}>
          <Text style={styles.eyebrow}>Caption</Text>
          <TextInput
            value={caption}
            onChangeText={(t) => setDraft(t.slice(0, MAX_CAPTION_LENGTH))}
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
      </KeyboardAvoidingView>
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
});
