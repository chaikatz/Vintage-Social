import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import Feather from "@expo/vector-icons/Feather";
import { showAlert } from "@/utils/alert";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { ExportCard } from "@/components/ExportCard";
import { colors, radii, spacing, type } from "@/theme";
import { fetchPost } from "@/api/posts";
import { fetchProfileById } from "@/api/profiles";
import { ensureShareLink, fetchShareLink, recordShareEvent, revokeShareLink } from "@/api/shares";
import { mediaUrl, mediaUrlString } from "@/api/media";
import { isDemoMode } from "@/lib/env";
import { useSession } from "@/providers/SessionProvider";
import { shareUrl, shareUrlLabel } from "@/utils/shareLink";
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
 *
 * A story can carry a link. Choosing Story on your own photograph makes
 * one — an unguessable address that shows that photograph alone to whoever
 * opens it — and copies it, so it can be put on the story as a link
 * sticker if you like. The share sheet itself is untouched: Instagram
 * does not accept a link alongside an image, so the two travel separately.
 */
export default function Export() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";

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
  const mine = Boolean(post && post.author_id === userId);

  // The author's membership number, for the label. Never invented: absent
  // until it is known, absent for good if there is none.
  const authorQ = useQuery({
    queryKey: ["profile-by-id", post?.author_id],
    queryFn: () => fetchProfileById(post!.author_id),
    enabled: Boolean(post?.author_id),
  });
  const memberNo = authorQ.data?.member_no ?? null;

  // The link, if this photograph already has one.
  const canLink = mine && !isDemoMode() && canExport();
  const linkQ = useQuery({
    queryKey: ["share-link", postId, userId],
    queryFn: () => fetchShareLink(postId ?? "", userId),
    enabled: canLink && Boolean(postId),
  });
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (linkQ.data) setToken(linkQ.data);
  }, [linkQ.data]);

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

  // The link travels with a story. Made once, copied each time, and never
  // in the way: a link that cannot be made leaves the share untouched.
  const prepareLink = async (): Promise<boolean> => {
    if (!post || !canLink || format !== "story") return false;
    try {
      const t = token ?? (await ensureShareLink(post.id, format, paper));
      if (!t) return false;
      if (!token) recordShareEvent(userId, "link_created", { postId: post.id, token: t, format, theme: paper });
      setToken(t);
      await Clipboard.setStringAsync(shareUrl(t));
      return true;
    } catch {
      return false;
    }
  };

  const copyLink = async () => {
    if (!token) return;
    await Clipboard.setStringAsync(shareUrl(token));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const stopSharing = () =>
    showAlert("Turn the link off?", "Anyone who opens it will see that the photograph is no longer shared.", [
      {
        text: "Turn off",
        style: "destructive",
        onPress: async () => {
          if (!post) return;
          try {
            await revokeShareLink(post.id);
            setToken(null);
            setCopied(false);
          } catch (err) {
            showAlert("That didn’t work", err instanceof Error ? err.message : String(err));
          }
        },
      },
      { text: "Keep it", style: "cancel" },
    ]);

  const share = async () => {
    if (!post || !canExport()) {
      showAlert("Not here", "Exporting is for the phone.");
      return;
    }
    recordShareEvent(userId, "share_started", { postId: post.id, token, format, theme: paper });
    try {
      const linked = await prepareLink();
      if (linked) setCopied(true);
      if (filmAsFilm) {
        const url = mediaUrlString("media", post.media_path);
        if (!url) throw new Error("The film could not be found");
        const uri = await brandVideo(post, url, format, paper, memberNo, setStage);
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
            <ExportCard post={post} source={source} format={format} paper={paper} width={previewWidth} memberNo={memberNo} />
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
              memberNo={memberNo}
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
          {canLink && format === "story"
            ? " A link to this photograph is copied as you share, for a Story link sticker if you like."
            : ""}
        </Text>

        <Button
          title={stage ?? (filmAsFilm ? "Share the film" : "Share the print")}
          onPress={share}
          loading={Boolean(stage)}
          disabled={!post || (!ready && !filmAsFilm) || Boolean(stage)}
        />
        {token && format === "story" ? (
          <View style={styles.linkBlock}>
            <Text style={styles.linkTitle}>{copied ? "Your VINTAGE link is copied." : "Your VINTAGE link."}</Text>
            <Text style={styles.linkHint}>Add it to your Story if you’d like.</Text>
            <View style={styles.linkRow}>
              <Text style={styles.linkText} numberOfLines={1}>
                {shareUrlLabel(token)}
              </Text>
              <Pressable hitSlop={8} onPress={copyLink} accessibilityRole="button">
                <Text style={styles.linkAction}>{copied ? "Copied" : "Copy"}</Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={stopSharing} accessibilityRole="button">
                <Text style={[styles.linkAction, styles.linkOff]}>Turn off</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        <View style={styles.hintRow}>
          <Feather name="lock" size={11} color={colors.inkFaint} />
          <Text style={styles.hint}>
            {token && format === "story"
              ? "The link shows this photograph alone. Nothing else of yours."
              : "Nothing is posted by VINTAGE. You choose where it goes."}
          </Text>
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
  linkBlock: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    gap: 3,
  },
  linkTitle: { fontSize: 14, color: colors.ink },
  linkHint: { ...type.caption, fontSize: 12 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  linkText: { flex: 1, fontFamily: type.mono, fontSize: 11, letterSpacing: 0.4, color: colors.inkSoft },
  linkAction: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.accent,
  },
  linkOff: { color: colors.inkFaint },
  hint: { ...type.caption, fontSize: 12 },
});
