import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { colors, spacing, type } from "@/theme";

/**
 * The actions on a printed card: struck in gold, or ruled in it. Nothing
 * fills with colour and nothing has a rounded corner — this is ink on
 * stock, not a button in a browser.
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
  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        variant === "solid" && styles.solid,
        variant === "outline" && styles.outline,
        variant === "quiet" && styles.quiet,
        pressed && styles.pressed,
        loading && styles.loading,
        style,
      ]}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === "solid" ? colors.card : colors.gold} />
      ) : (
        <Text style={[styles.label, variant === "solid" && styles.labelSolid]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  solid: { backgroundColor: colors.gold },
  outline: { borderWidth: 1, borderColor: colors.gold },
  quiet: { paddingVertical: spacing.md },
  pressed: { opacity: 0.7 },
  loading: { opacity: 0.6 },
  label: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2.6,
    textTransform: "uppercase",
    color: colors.gold,
  },
  labelSolid: { color: colors.cardDeep },
});
