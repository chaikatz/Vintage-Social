import React, { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { showAlert } from "@/utils/alert";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { ExportCard } from "@/components/ExportCard";
import { colors, radii, spacing, type } from "@/theme";
import { fetchPost } from "@/api/posts";
import { mediaUrl, mediaUrlString } from "@/api/media";
import { isDemoMode } from "@/lib/env";
import { PRINT_WIDTH, STORY_WIDTH, exportLayout, printRatio, type ExportFormat, type ExportPaper } from "@/utils/exportLayout";
import { brandVideo, canBrandVideo, canExport, capturePrint, shareFile } from "@/utils/exportPost";

/**
 * A photograph leaves VINTAGE as a print.
 *
 * Paper, a margin, the wordmark and the place and date along the bottom —
 * so on Instagram, in WhatsApp, on a camera roll, it is plainly one of
 * ours without a logo stamped over the picture. Two shapes (the post's
 * own, or a story page) and two papers; the result goes to the phone's
 * share sheet, which is where the other apps are. Nothing is posted
 * anywhere by us.
 *
 * The preview is the real card at a smaller width; the capture is the same
 * card drawn full size off screen, so what is shared is what was seen.
 */
export default function Export() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [format, setFormat] = useState<ExportFormat>("print");
  const [paper, setPaper] = useState<ExportPaper>("paper");
  const [ready, setReady] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const cardRef = useRef<View>(null);

  const postQ = useQuery({
    queryKey: ["post", postId],
    queryFn: () => fetchPost(postId ?? ""),
    enabled: Boolean(postId),
  });
  const post = postQ.data;
  const isVideo = post?.media_type === "video";

  // What shows in the frame: the photograph itself, or a film's poster.
  const source = useMemo(() => {
    if (!post) return null;
    if (isVideo) return mediaUrl("thumbnails", post.thumb_path);
    return mediaUrl("media", post.media_path) ?? mediaUrl("thumbnails", post.thumb_path);
  }, [post, isVideo]);

  // The preview fits a box; the card's shape decides which edge binds.
  const fullWidth = format === "story" ? STORY_WIDTH : PRINT_WIDTH;
  const ratio = printRatio(post?.width ?? null, post?.height ?? null);
  const shape = exportLayout(ratio, format, fullWidth);
  const boxWidth = screenWidth - spacing.lg * 2;
  const boxHeight = Math.max(240, screenHeight * 0.46);
  const previewWidth = Math.min(boxWidth, boxHeight * (shape.width / shape.height));

  const filmAsFilm = isVideo && canBrandVideo() && !isDemoMode();

  const share = async () => {
    if (!post || !canExport()) {
      showAlert("Not here", "Exporting is for the phone.");
      return;
    }
    try {
      if (filmAsFilm) {
        const url = mediaUrlString("media", post.media_path);
        if (!url) throw new Error("The film could not be found");
        const uri = await brandVideo(post, url, format, paper, setStage);
        setStage(null);
        await shareFile(uri, "video");
      } else {
        setStage("Printing…");
        const uri = await capturePrint(cardRef);
        setStage(null);
        await shareFile(uri, "image");
      }
    } catch (err) {
      setStage(null);
      showAlert("Couldn’t export", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Screen padded={false}>
      <View style={[styles.previewBox, { height: boxHeight }]}>
        {post ? (
          <View style={styles.previewShadow}>
            <ExportCard post={post} source={source} format={format} paper={paper} width={previewWidth} />
          </View>
        ) : null}
      </View>

      {/* The one that is captured: full size, out of sight. */}
      {post ? (
        <View style={styles.offscreen} pointerEvents="none">
          <View ref={cardRef} collapsable={false}>
            <ExportCard
              post={post}
              source={source}
              format={format}
              paper={paper}
              width={fullWidth}
              onReady={() => setReady(true)}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.controls}>
        <Choice<ExportFormat>
          label="Shape"
          value={format}
          onChange={setFormat}
          options={[
            ["print", "Print"],
            ["story", "Story"],
          ]}
        />
        <Choice<ExportPaper>
          label="Paper"
          value={paper}
          onChange={setPaper}
          options={[
            ["paper", "Paper"],
            ["darkroom", "Darkroom"],
          ]}
        />

        <Text style={styles.note}>
          {isVideo
            ? filmAsFilm
              ? "The film goes out inside the same print, sound and all. Longer films take a moment."
              : "This build shares a film as its poster, printed."
            : "Opens the share sheet — Instagram, WhatsApp, Messages, your camera roll."}
        </Text>

        <Button
          title={stage ?? (filmAsFilm ? "Share the film" : "Share the print")}
          onPress={share}
          loading={Boolean(stage)}
          disabled={!post || (!ready && !filmAsFilm) || Boolean(stage)}
        />
        <View style={styles.hintRow}>
          <Feather name="lock" size={11} color={colors.inkFaint} />
          <Text style={styles.hint}>Nothing is posted by VINTAGE. You choose where it goes.</Text>
        </View>
      </View>
    </Screen>
  );
}

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <View style={styles.choiceRow}>
      <Text style={styles.choiceLabel}>{label}</Text>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {options.map(([v, text]) => {
          const on = v === value;
          return (
            <Pressable
              key={v}
              style={[styles.choice, on && styles.choiceOn]}
              onPress={() => onChange(v)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{text}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  previewBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    backgroundColor: colors.paperSunken,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.lg,
  },
  previewShadow: {
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  offscreen: { position: "absolute", left: -4000, top: 0 },
  controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },
  choiceRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  choiceLabel: { ...type.label, width: 56 },
  choices: { flex: 1, flexDirection: "row", gap: spacing.sm },
  choice: {
    flex: 1,
    paddingVertical: 9,
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.paperRaised,
  },
  choiceOn: { backgroundColor: colors.shutter, borderColor: colors.shutter },
  choiceText: { fontSize: 13, fontWeight: "600", color: colors.ink },
  choiceTextOn: { color: colors.onShutter },
  note: { ...type.caption, marginTop: spacing.xs },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" },
  hint: { ...type.caption, fontSize: 12 },
});
