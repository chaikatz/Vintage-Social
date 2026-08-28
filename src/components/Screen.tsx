import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, ViewStyle } from "react-native";
import { colors, spacing } from "@/theme";

interface Props {
  children?: React.ReactNode;
  /** Wrap children in a keyboard-aware scroll view (forms). */
  scroll?: boolean;
  style?: ViewStyle;
  padded?: boolean;
}

export function Screen({ children, scroll = false, style, padded = true }: Props) {
  const inner = padded ? [styles.padded, style] : style;
  if (!scroll) {
    return <View style={[styles.root, inner]}>{children}</View>;
  }
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.scrollContent, inner]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  padded: { paddingHorizontal: spacing.lg },
  scrollContent: { paddingBottom: spacing.xxl },
});
