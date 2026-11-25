import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";

/**
 * The line between the mount and the roll: the roll's name, RECENT, and
 * the two other ways in, each a mark and its word in ink — SHORT VIDEO
 * (a clip, up to a minute, in the same feed and grid) and LIBRARY (the
 * iPhone's own picker, which needs no permission). Where there is no
 * roll (Android, a browser outside the demo) RECENT goes, and the camera
 * stands here instead. At the larger text sizes the name takes a line of
 * its own and the ways wrap under it.
 */

const BAR_TYPE_CAP = 1.8;
const TYPE_CAP = 2.4;

export type WayName = "camera" | "video" | "photo";

export function WaysRow({
  recent,
  camera,
  library,
  narrow,
  large,
  busy,
  held,
  onCamera,
  onVideo,
  onLibrary,
}: {
  recent: boolean;
  camera: boolean;
  library: boolean;
  narrow: boolean;
  large: boolean;
  busy: WayName | null;
  held: boolean;
  onCamera?: () => void;
  onVideo: () => void;
  onLibrary?: () => void;
}) {
  return (
    <View style={[styles.row, { minHeight: narrow ? 44 : 48 }, !recent && styles.rowAlone]}>
      {recent ? (
        <Text style={[styles.recent, large && styles.recentLarge]} accessibilityRole="header" maxFontSizeMultiplier={BAR_TYPE_CAP}>
          Recent
        </Text>
      ) : null}
      {camera && onCamera ? (
        <Way testID="post-way-camera" icon="camera" size={16} label="Camera" hint="Take one now" busy={busy === "camera"} held={held} onPress={onCamera} />
      ) : null}
      <Way
        testID="post-way-video"
        icon="video"
        size={16}
        label="Short video"
        hint={`Up to ${MAX_VIDEO_SECONDS} seconds, same feed, same grid`}
        busy={busy === "video"}
        held={held}
        onPress={onVideo}
      />
      {library && onLibrary ? (
        <Way
          testID="post-way-library"
          icon="image"
          size={15}
          label="Library"
          hint="Opens your photo library. Nothing is shared until you post."
          busy={busy === "photo"}
          held={held}
          onPress={onLibrary}
        />
      ) : null}
    </View>
  );
}

/** One way in: its mark and its word; while it is the one opening, a spinner in a box the same size. */
function Way({
  testID,
  icon,
  size,
  label,
  hint,
  busy,
  held,
  onPress,
}: {
  testID: string;
  icon: "camera" | "video" | "image";
  size: number;
  label: string;
  hint: string;
  busy: boolean;
  held: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={held}
      hitSlop={{ left: 6, right: 6 }}
      style={({ pressed }) => [styles.way, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ busy, disabled: held }}
    >
      <View style={[styles.wayInside, busy && styles.hidden]}>
        <Feather name={icon} size={size} color={colors.ink} />
        <Text style={styles.wayWord} maxFontSizeMultiplier={BAR_TYPE_CAP}>
          {label}
        </Text>
      </View>
      {busy ? <ActivityIndicator size="small" color={colors.ink} style={StyleSheet.absoluteFill} /> : null}
    </Pressable>
  );
}

/** Under limited access: that VINTAGE sees only what was chosen, and the way to choose more. */
export function LimitedLine({ held, onShareMore }: { held: boolean; onShareMore: () => void }) {
  return (
    <View style={styles.limited}>
      <Text style={styles.limitedText} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
        VINTAGE sees only the photographs you chose.
      </Text>
      <Pressable
        testID="post-share-more"
        onPress={onShareMore}
        disabled={held}
        hitSlop={6}
        style={({ pressed }) => [styles.shareMore, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Share more"
        accessibilityHint="Opens iOS’s list of the photographs VINTAGE may see."
      >
        <Text style={styles.shareMoreWord} maxFontSizeMultiplier={BAR_TYPE_CAP}>
          Share more
        </Text>
      </Pressable>
    </View>
  );
}

const caps = { textTransform: "uppercase" as const };

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 18,
    paddingHorizontal: spacing.lg,
  },
  // Without the roll's name the ways stand from the left.
  rowAlone: { columnGap: spacing.xl },
  recent: { flex: 1, fontFamily: type.mono, fontSize: 10, letterSpacing: 2.4, ...caps, color: colors.inkSoft },
  recentLarge: { flexBasis: "100%", paddingTop: spacing.sm },
  way: { minHeight: 44, justifyContent: "center" },
  wayInside: { flexDirection: "row", alignItems: "center", gap: 7 },
  wayWord: { fontFamily: type.mono, fontSize: 10.5, letterSpacing: 1.8, ...caps, color: colors.ink },
  hidden: { opacity: 0 },
  pressed: { opacity: 0.6 },
  limited: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.lg, paddingBottom: 10 },
  limitedText: { flex: 1, fontSize: 12, lineHeight: 16, color: colors.inkSoft },
  shareMore: { minHeight: 44, justifyContent: "center" },
  shareMoreWord: { fontFamily: type.mono, fontSize: 10, letterSpacing: 1.8, ...caps, color: colors.accent },
});
