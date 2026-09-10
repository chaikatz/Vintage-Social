import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { mediaUrl } from "@/api/media";
import { memoryHeadline, type Memory } from "@/utils/memories";
import type { PostRow } from "@/types/db";

/**
 * A quiet line at the top of the feed on the days there is something to
 * remember. One thumbnail, the sentence a notification would say, and a
 * chevron. It appears only when it has a photograph to show and says
 * nothing at all the rest of the year.
 */
export function MemoryStrip({
  memory,
  extra,
  onPress,
}: {
  memory: Memory<PostRow> | null;
  /** "and 6 more in your library" — when the phone has more of that day. */
  extra?: string | null;
  onPress: () => void;
}) {
  const thumb = memory
    ? mediaUrl("thumbnails", memory.post.thumb_path) ?? mediaUrl("media", memory.post.media_path)
    : null;
  const headline = memory ? memoryHeadline(memory) : extra ?? "";
  if (!headline) return null;
  return (
    <Pressable style={({ pressed }) => [styles.strip, pressed && styles.pressed]} onPress={onPress}>
      {thumb ? (
        <Image source={thumb} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Feather name="sun" size={16} color={colors.inkFaint} />
        </View>
      )}
      <View style={styles.text}>
        <Text style={styles.eyebrow}>On this day</Text>
        <Text style={styles.headline} numberOfLines={2}>
          {headline}
        </Text>
        {memory && extra ? <Text style={styles.extra}>{extra}</Text> : null}
      </View>
      <Feather name="chevron-right" size={16} color={colors.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.paperRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.7 },
  thumb: { width: 46, height: 46, backgroundColor: colors.paperSunken },
  thumbEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  text: { flex: 1 },
  eyebrow: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    color: colors.accent,
  },
  headline: { fontFamily: type.serif, fontSize: 14, lineHeight: 19, color: colors.ink, marginTop: 2 },
  extra: { ...type.caption, fontSize: 11, color: colors.inkFaint, marginTop: 1 },
});
