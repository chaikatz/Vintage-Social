import React from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { ruleWidth } from "@/components/gate/rule";
import { room, roomType, untrack } from "./room";

/**
 * A word you can press, the way VINTAGE sets every way in: tracked
 * capitals, and the short rule signed beneath when it is the one that
 * matters or the one that is chosen. Cream on the darkroom page.
 */
export function Word({
  label,
  onPress,
  ruled = false,
  strong = false,
  dim = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  selected,
  style,
}: {
  label: string;
  onPress: () => void;
  /** The short rule beneath. */
  ruled?: boolean;
  /** The primary word: a step larger. */
  strong?: boolean;
  /** Not the chosen one: receded. */
  dim?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  selected?: boolean;
  style?: ViewStyle;
}) {
  const tracking = strong ? 3.2 : 2.2;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      style={({ pressed }) => [styles.base, pressed && styles.pressed, disabled && styles.disabled, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected }}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        style={[styles.label, strong && styles.strong, untrack(tracking), { color: dim ? room.faint : room.ink }]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.rule,
          { width: ruleWidth(label), backgroundColor: room.ink, opacity: ruled ? 0.8 : 0 },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.35 },
  label: { fontFamily: roomType.mono, fontSize: 10.5, textTransform: "uppercase" },
  strong: { fontSize: 13 },
  rule: { height: 1, marginTop: 7 },
});
