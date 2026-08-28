import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from "react-native";
import { colors, radii, spacing } from "@/theme";

interface Props {
  title: string;
  onPress: () => void;
  onLongPress?: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: ViewStyle;
}

/** Compact, bordered, tactile — no pills, no gradients. */
export function Button({
  title,
  onPress,
  onLongPress,
  variant = "primary",
  disabled = false,
  loading = false,
  small = false,
  style,
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        small && styles.small,
        variantStyles[variant],
        pressed && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === "primary" ? colors.onShutter : colors.ink} />
      ) : (
        <Text style={[styles.label, small && styles.labelSmall, labelStyles[variant]]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  small: { paddingVertical: 5, paddingHorizontal: spacing.md },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  label: { fontSize: 14, fontWeight: "600", letterSpacing: 0.3 },
  labelSmall: { fontSize: 13 },
});

const variantStyles: Record<string, ViewStyle> = {
  primary: { backgroundColor: colors.shutter, borderColor: colors.shutter },
  secondary: { backgroundColor: colors.paperRaised, borderColor: colors.borderStrong },
  quiet: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { backgroundColor: colors.paperRaised, borderColor: colors.danger },
};

const labelStyles = StyleSheet.create({
  primary: { color: colors.onShutter },
  secondary: { color: colors.ink },
  quiet: { color: colors.accent },
  danger: { color: colors.danger },
});
