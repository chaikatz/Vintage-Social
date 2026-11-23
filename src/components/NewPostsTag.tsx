import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { colors, radii, spacing, type } from "@/theme";

/**
 * "New posts": the small tag at the top of Home when members you follow
 * have posted since the top of what you are reading (src/hooks/useNewPosts.ts).
 * Tapped, it takes you to the top, where they are put in.
 *
 * A label in the typewriter face, set on the shutter's colour like the one
 * button a screen has: dark on paper, white on black. Squared, as the
 * app's buttons are. It sits over the list without taking any of its room,
 * so nothing under it moves when it comes or goes.
 */
export function NewPostsTag({ onPress }: { onPress: () => void }) {
  return (
    <View pointerEvents="box-none" style={styles.row}>
      <Pressable
        onPress={onPress}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="New posts"
        accessibilityHint="Goes to the top and shows them"
        style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
      >
        <Feather name="arrow-up" size={13} color={colors.onShutter} />
        <Text style={styles.label}>New posts</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: "absolute",
    top: spacing.md,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.shutter,
    // Lifted just enough to read over a photograph.
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  pressed: { opacity: 0.8 },
  label: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.onShutter,
  },
});
