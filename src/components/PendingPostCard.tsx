import React, { useEffect, useMemo, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";
import { showAlert } from "@/utils/alert";
import { useReducedMotion } from "@/utils/useReducedMotion";
import { discardPost, retryPost, type PendingPost } from "@/uploads";
import { accessibilityLine, overallProgress, stateLine } from "@/uploads/words";
import { Avatar } from "./Avatar";
import { Byline } from "./PostCard";
import { PostMedia } from "./PostMedia";

interface Props {
  pending: PendingPost;
  /** Whether its clip may play: on screen, with no feed card playing. Never while the clip is being developed. */
  active?: boolean;
  onOpenProfile?: (username: string) => void;
}

/**
 * A post on its way up, at the top of Home.
 *
 * It looks like the post it is about to be: the same header, the same
 * picture through the same PostMedia, wearing the film, the stamp and the
 * place it was given, so nothing jumps when the feed's own row takes its
 * place. A photograph that was baked is drawn as it is (it is a local
 * file, which `needsDisplayFilter` treats as baked); one that could not be
 * baked, and a clip until it has been developed, carry `filter_baked`
 * false so the play-time film is laid over them, as it will be on the
 * post.
 *
 * Where a post has its likes and comments, this one has a single line
 * saying what is happening, and a one-point rule that fills as it goes.
 * Nothing on it can be liked, commented on or sent: the post does not
 * exist yet. When it fails it says so plainly and offers Retry and
 * Discard; a lost connection is not a failure, only a wait.
 */
export function PendingPostCard({ pending, active = false, onOpenProfile }: Props) {
  const { draft, state, progress } = pending;
  const createdAt = useMemo(() => new Date(pending.createdAt).toISOString(), [pending.createdAt]);

  const media = useMemo(
    () => ({
      media_type: draft.kind,
      media_path: pending.previewUri,
      thumb_path: pending.previewThumbUri,
      width: draft.sourceWidth,
      height: draft.sourceHeight,
      filter_id: draft.filterId,
      filter_baked: pending.previewBaked,
      show_date_stamp: draft.showDateStamp,
      taken_at: draft.takenAt,
      created_at: createdAt,
    }),
    [draft, pending.previewUri, pending.previewThumbUri, pending.previewBaked, createdAt],
  );

  const line = stateLine(state, progress, draft.kind);
  const failed = state === "failed";
  const developing = state === "developing" || state === "preparing";

  // VoiceOver hears a change of state, not every percent. Android's live
  // region on the line does the same job there.
  const lastState = useRef(state);
  useEffect(() => {
    if (lastState.current === state) return;
    lastState.current = state;
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(stateLine(state, null, draft.kind));
  }, [state, draft.kind]);

  const confirmDiscard = () => {
    showAlert(
      "Discard this post?",
      `${draft.kind === "video" ? "The clip" : "The photograph"} and its caption will be deleted from this phone.`,
      [
        { text: "Keep it", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => void discardPost(pending.id) },
      ],
    );
  };

  const tagged = draft.tagIds.length;
  const pct = progress == null ? undefined : Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Pressable
          onPress={() => onOpenProfile?.(draft.author.username)}
          disabled={!onOpenProfile}
          accessibilityLabel={draft.author.username}
        >
          <Avatar path={draft.author.avatar_url} username={draft.author.username} size={34} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.username} numberOfLines={1}>
            {draft.author.username}
          </Text>
          <Byline post={{ taken_at: draft.takenAt, created_at: createdAt, location: draft.location }} />
        </View>
      </View>

      {/* Not posted yet: held in memory, never written to the image cache on disk. */}
      <PostMedia post={media} active={active && !developing && !failed} cachePolicy="memory" />

      <ProgressRule fraction={overallProgress(state, progress, draft.kind)} />
      <View style={styles.statusRow}>
        <Text
          style={[styles.state, failed && styles.stateFailed]}
          accessibilityRole="progressbar"
          accessibilityLabel={accessibilityLine(state, progress, draft.kind)}
          accessibilityValue={pct == null ? undefined : { min: 0, max: 100, now: pct }}
          accessibilityLiveRegion="polite"
        >
          {line}
        </Text>
        {failed ? (
          <>
            <Pressable
              onPress={() => retryPost(pending.id)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Retry posting"
            >
              <Text style={styles.action}>Retry</Text>
            </Pressable>
            <Text style={styles.dot} accessible={false}>
              ·
            </Text>
            <Pressable
              onPress={confirmDiscard}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Discard this post"
            >
              <Text style={[styles.action, styles.discard]}>Discard</Text>
            </Pressable>
          </>
        ) : null}
      </View>
      {failed && pending.error ? <Text style={styles.reason}>{pending.error}</Text> : null}

      {draft.caption.trim() ? (
        <Text style={styles.caption}>
          <Text style={styles.captionAuthor}>{draft.author.username}</Text> {draft.caption.trim()}
        </Text>
      ) : null}
      {tagged > 0 ? (
        <Text style={styles.tagged}>{tagged === 1 ? "With one member" : `With ${tagged} members`}</Text>
      ) : null}
    </View>
  );
}

/**
 * One point of the accent colour across the foot of the picture, filling
 * as the post goes up. While the post is waiting or has failed it stays
 * where it got to, in the faint ink, so it reads as paused, not as gone.
 */
function ProgressRule({ fraction }: { fraction: number | null }) {
  const still = useReducedMotion();
  const last = useRef(fraction ?? 0);
  if (fraction != null) last.current = fraction;
  const target = fraction ?? last.current;
  const value = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    if (still) {
      value.setValue(target);
      return;
    }
    const run = Animated.timing(value, {
      toValue: target,
      duration: 240,
      easing: Easing.out(Easing.quad),
      // Width is a layout property; the native driver cannot animate it.
      useNativeDriver: false,
    });
    run.start();
    return () => run.stop();
  }, [target, still, value]);
  const width = value.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"], extrapolate: "clamp" });
  return (
    <View style={styles.track} accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <Animated.View style={[styles.rule, fraction == null && styles.rulePaused, { width }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // The same air as a post: separated by space, not rules.
  card: {
    paddingBottom: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.paper,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerText: { flex: 1 },
  username: { fontSize: 14, fontWeight: "600", color: colors.ink },
  track: { height: 1, width: "100%", overflow: "hidden" },
  rule: { height: 1, backgroundColor: colors.accent },
  rulePaused: { backgroundColor: colors.inkFaint },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 2,
    minHeight: 30,
  },
  // A counter, so the typewriter face the stamp and the byline use.
  state: {
    fontFamily: type.mono,
    fontSize: 12,
    letterSpacing: 0.6,
    color: colors.inkSoft,
  },
  stateFailed: { color: colors.ink },
  action: {
    fontFamily: type.mono,
    fontSize: 12,
    letterSpacing: 0.6,
    color: colors.accent,
    textDecorationLine: "underline",
  },
  discard: { color: colors.inkSoft },
  dot: { fontFamily: type.mono, fontSize: 12, color: colors.inkFaint },
  reason: {
    ...type.caption,
    paddingHorizontal: spacing.lg,
    paddingTop: 2,
  },
  caption: {
    ...type.body,
    fontSize: 14,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs + 2,
  },
  captionAuthor: { fontWeight: "600" },
  tagged: {
    ...type.caption,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
});
