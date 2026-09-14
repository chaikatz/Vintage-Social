import React from "react";
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";

/** Give a TextInput `inputAccessoryViewID={KEYBOARD_DONE}` and it gets the bar. */
export const KEYBOARD_DONE = "vintage-keyboard-done";

/**
 * A "Done" above every keyboard.
 *
 * A multiline field has no return key that closes the keyboard, and on a
 * short screen the keyboard can hide the only button that would. This
 * bar rides on top of the keyboard itself, so there is always a way out
 * of it. Rendered once, at the root; iOS only, where the problem lives.
 */
export function KeyboardDone() {
  if (Platform.OS !== "ios") return null;
  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE} backgroundColor={colors.paperRaised}>
      <View style={styles.bar}>
        <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10} style={styles.button} accessibilityRole="button">
          <Text style={styles.text}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.paperRaised,
  },
  button: { paddingVertical: 4, paddingHorizontal: spacing.sm },
  text: {
    fontFamily: type.mono,
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.accent,
  },
});
