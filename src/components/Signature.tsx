import React from "react";
import { StyleSheet, Text, type TextStyle } from "react-native";
import { colors, type } from "@/theme";
import { signatureLine } from "@/utils/time";

/**
 * `AUGUST 14, 2019 · LOS ANGELES`
 *
 * The one line VINTAGE writes under every photograph: when the shutter
 * fired and where. Set in tracked mono capitals like a lab stamp on the
 * back of a print, so the capture date reads as a fact about the picture
 * rather than a timestamp about the post.
 */
export function Signature({
  post,
  size = "small",
  style,
  numberOfLines = 1,
}: {
  post: { taken_at: string | null; created_at: string; location: string | null };
  size?: "small" | "large";
  style?: TextStyle;
  numberOfLines?: number;
}) {
  return (
    <Text style={[styles.base, size === "large" ? styles.large : styles.small, style]} numberOfLines={numberOfLines}>
      {signatureLine(post)}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: { fontFamily: type.mono, textTransform: "uppercase", color: colors.inkFaint },
  small: { fontSize: 10, letterSpacing: 1.2 },
  large: { fontSize: 11, letterSpacing: 2, color: colors.inkSoft },
});
