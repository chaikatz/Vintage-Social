import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { memoryHeadline, type Memory } from "@/utils/memories";

/**
 * On your own profile, on a day you have posted from in an earlier year:
 * one quiet line, ON THIS DAY and the sentence its notification carries
 * ("1 year ago today, you were in Milan."), which opens On this day
 * (`app/memories.tsx`). On every other day there is nothing here.
 *
 * It is the way in from the app itself: the Post tab's On this day door
 * went with the owner's redesign of that tab, and the room's own On this
 * day reads the library, not your posts. Read from the posts the profile
 * already holds; nothing more is asked of the server.
 */

/** The line's type stops growing here, as the profile's other small type does. */
const TYPE_CAP = 2;

export function OnThisDayLine({ memory, count, onPress }: { memory: Pick<Memory, "yearsAgo" | "place">; count: number; onPress: () => void }) {
  const headline = memoryHeadline(memory);
  const more = count > 1 ? ` And ${count - 1} more.` : "";
  return (
    <Pressable
      testID="profile-on-this-day"
      onPress={onPress}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`On this day. ${headline}${more}`}
      accessibilityHint="Opens On this day."
    >
      <View style={styles.words}>
        <Text style={styles.eyebrow} maxFontSizeMultiplier={TYPE_CAP}>
          On this day
        </Text>
        <Text style={styles.headline} numberOfLines={2} maxFontSizeMultiplier={TYPE_CAP}>
          {headline}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.inkSoft} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    // Under the profile's own rule, so only one hairline, under it, between it and the views.
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    minHeight: 44,
  },
  pressed: { opacity: 0.6 },
  words: { flex: 1 },
  eyebrow: { fontFamily: type.mono, fontSize: 9, letterSpacing: 2.2, textTransform: "uppercase", color: colors.accent },
  headline: { fontFamily: type.serif, fontSize: 15, lineHeight: 21, color: colors.ink, marginTop: 2 },
});
