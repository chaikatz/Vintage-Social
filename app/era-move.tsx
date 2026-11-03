import React, { useMemo, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, type } from "@/theme";
import { fetchUserPosts } from "@/api/posts";
import { useSession } from "@/providers/SessionProvider";
import { useEraEditor, useEraEdits } from "@/hooks/useEraEdits";
import { NO_EDITS } from "@/utils/eraEdits";
import { EraSheetBody } from "@/components/EraMoveSheet";
import { LoadFailed } from "@/components/LoadFailed";
import { eraMoveStage, eraSheetView, madeNote, movedNote, takenOutNote, type EraSheetState } from "@/components/eraSheet";

/**
 * Add to an era, from the "…" on a photograph of your own, wherever it is
 * shown: the sheet your Eras page arranges them in, opened on this
 * photograph as Move to, with "New era…" to begin one. Your photographs
 * and your arrangement are read from the same places your page reads them,
 * and changed by the same editor, so your Eras already show the change
 * when you next look. One change, and it closes.
 *
 * Offered only once your arrangement has been read and can be saved
 * (usePostActions), and only on your own photographs. Your photographs
 * are read afresh each time it opens, and it says the photograph is not
 * yours only once a read has answered without it (eraMoveStage). Close is
 * there whatever it shows.
 */
export default function EraMove() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";
  const { postId } = useLocalSearchParams<{ postId: string }>();

  const posts = useQuery({
    queryKey: ["user-posts", userId],
    queryFn: () => fetchUserPosts(userId),
    enabled: Boolean(userId),
    // A list read before this photograph was posted would not have it.
    refetchOnMount: "always",
  });
  const eraEdits = useEraEdits(userId);
  const editor = useEraEditor(userId, posts.data);
  const post = useMemo(() => posts.data?.find((p) => p.id === postId), [posts.data, postId]);

  // Move to, on this photograph, until "New era…" turns the sheet to a new one.
  const [turned, setTurned] = useState<EraSheetState | null>(null);
  const sheet = useMemo<EraSheetState | null>(() => turned ?? (post ? { kind: "move", post } : null), [turned, post]);
  const view = useMemo(
    () => eraSheetView(posts.data ?? [], eraEdits.data?.edits ?? NO_EDITS, sheet),
    [posts.data, eraEdits.data, sheet],
  );

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
  // Said only when the editor made the change; closed either way.
  const after = (words: string | null) => {
    if (words) AccessibilityInfo.announceForAccessibility(words);
    close();
  };

  const top = { paddingTop: Platform.OS === "ios" ? 0 : insets.top };
  const stage = eraMoveStage({
    answered: posts.isFetched && eraEdits.isFetched,
    reading: posts.fetchStatus !== "idle",
    failed: posts.isError || !posts.data,
    found: post != null,
    arrangeable: editor != null && view != null,
  });
  if (stage !== "sheet" || !post || !editor || !view) {
    return (
      <View style={[styles.root, styles.centre, top]} testID={stage === "reading" ? "era-move-reading" : "era-move-unavailable"}>
        {stage === "reading" ? (
          <ActivityIndicator color={colors.inkFaint} />
        ) : stage === "readFailed" ? (
          <LoadFailed what="your photographs" onRetry={() => void posts.refetch()} />
        ) : (
          <Text style={styles.words}>
            {stage === "notYours" ? "This photograph isn’t among yours any more." : "Your eras can’t be arranged just now. Try again in a moment."}
          </Text>
        )}
        <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.closeButton}>
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, top]}>
      <EraSheetBody
        view={view}
        live
        onMove={(key) => {
          const to = view.kind === "move" ? view.choices.find((c) => c.key === key && !c.newEra) : undefined;
          after(to && editor.move(post, key) ? movedNote(to.title) : null);
        }}
        onTakeOut={() => {
          const out = view.kind === "move" ? view.out : null;
          after(out && editor.takeOut(post) ? takenOutNote(out) : null);
        }}
        onNewEra={() => setTurned((now) => now ?? { kind: "new", chosen: [post.id] })}
        onAdd={close}
        onCreate={(name, photoIds) => after(editor.create(name, photoIds) ? madeNote(name) : null)}
        onClose={close}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  centre: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.lg },
  words: { ...type.caption, textAlign: "center", color: colors.inkSoft },
  closeButton: { paddingVertical: spacing.sm },
  close: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.accent,
  },
});
