import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { GATE_BUTTON, GATE_ON_BUTTON } from "./palette";
import { ruleWidth } from "./rule";

/**
 * The actions at the door, as the landing page draws them: a dark bar
 * with an arrow, a ruled bar with an arrow, or a line of capitals with
 * nothing around it. No rounded corners — ink on paper, not a button in
 * a browser.
 */
export function GateButton({
  title,
  onPress,
  variant = "outline",
  loading = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "solid" | "outline" | "quiet";
  loading?: boolean;
  style?: ViewStyle;
}) {
  const solid = variant === "solid";
  const quiet = variant === "quiet";
  const ink = solid ? (GATE_ON_BUTTON as unknown as string) : (colors.ink as unknown as string);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        solid && styles.solid,
        variant === "outline" && styles.outline,
        quiet && styles.quiet,
        pressed && styles.pressed,
        loading && styles.loading,
        style,
      ]}
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator size="small" color={ink} />
      ) : (
        <>
          <Text style={[styles.label, solid && styles.labelSolid]}>{title}</Text>
          {quiet ? <View style={[styles.quietRule, { width: ruleWidth(title) }]} /> : <Feather name="arrow-right" size={18} color={ink} style={styles.arrow} />}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { height: 44, alignItems: "center", justifyContent: "center" },
  solid: { backgroundColor: GATE_BUTTON },
  outline: { borderWidth: 1, borderColor: colors.ink },
  quiet: { height: undefined, paddingVertical: spacing.md },
  pressed: { opacity: 0.75 },
  loading: { opacity: 0.6 },
  label: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.ink,
  },
  labelSolid: { color: GATE_ON_BUTTON },
  arrow: { position: "absolute", right: 16 },
  quietRule: { width: 26, height: 1, backgroundColor: colors.ink, marginTop: 7, opacity: 0.8 },
});
