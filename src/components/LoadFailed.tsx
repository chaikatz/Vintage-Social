import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";

/**
 * What a screen shows when its read failed — a dropped connection, a
 * server that stumbled — instead of pretending there was nothing there.
 * "Member not found" and "A quiet start" are claims about the world; this
 * is the truth about the request, with the one thing to do about it.
 */
export function LoadFailed({ what = "this", onRetry }: { what?: string; onRetry?: () => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Couldn’t load {what}</Text>
      <Text style={styles.body}>Check your connection and try again.</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={10} style={styles.retry} accessibilityRole="button">
          <Text style={styles.retryText}>Try again</Text>
          <View style={styles.rule} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: spacing.xxl * 2, paddingHorizontal: spacing.xl },
  title: { ...type.title, fontSize: 18, textAlign: "center" },
  body: { ...type.caption, textAlign: "center", marginTop: spacing.sm, color: colors.inkSoft },
  retry: { alignItems: "center", marginTop: spacing.xl, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  retryText: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2.4,
    marginRight: -2.4,
    textTransform: "uppercase",
    color: colors.ink,
  },
  rule: { width: 26, height: 1, backgroundColor: colors.ink, marginTop: 7, opacity: 0.8 },
});
