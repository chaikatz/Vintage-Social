import React from "react";
import { StyleSheet, Text, View, type ColorValue, type ViewStyle } from "react-native";
import { colors, type } from "@/theme";

/**
 * The wordmark with its rule: VINTAGE, tracked wide, and the short rule
 * directly under the T.
 *
 * The rule is not centred under the word — in a serif VIN and AGE are not
 * the same width, so the word's centre is not the T's, and by an amount
 * that differs from one font to the next. Instead the T is set in its own
 * column with the rule beneath it, so the rule is centred on that one
 * letter wherever the type comes from. The tracking is kept even: each
 * run carries its trailing letter-space except where the next piece
 * supplies it.
 *
 *   <Wordmark />                              the corner mark: 15pt, rule 9
 *   <Wordmark size={34} lineHeight={44} tracking={9} rule={24} gap={12} />
 */
export function Wordmark({
  size = 15,
  lineHeight = 18,
  tracking = 4,
  rule = 9,
  gap = 3,
  color = colors.ink,
  tagline,
  style,
}: {
  size?: number;
  lineHeight?: number;
  /** Letter-spacing, in points. */
  tracking?: number;
  /** The rule's width, in points. */
  rule?: number;
  /** Space between the letters and the rule. */
  gap?: number;
  color?: ColorValue;
  /** A faint italic line under the word, left-aligned with it: "Members only". */
  tagline?: string;
  style?: ViewStyle;
}) {
  const letters = { fontFamily: type.serif, fontSize: size, lineHeight, letterSpacing: tracking, color };
  const word = (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={tagline ? `VINTAGE, ${tagline}` : "VINTAGE"}>
      <Text style={letters}>VIN</Text>
      <View style={[styles.t, { marginRight: tracking }]}>
        <Text style={[letters, { marginRight: -tracking }]}>T</Text>
        <View style={{ width: rule, height: 1, backgroundColor: color, opacity: 0.85, marginTop: gap }} />
      </View>
      <Text style={[letters, { marginRight: -tracking }]}>AGE</Text>
    </View>
  );
  if (!tagline) return <View style={style}>{word}</View>;
  return (
    <View style={[styles.column, style]}>
      {word}
      <Text style={[styles.tagline, { fontSize: Math.max(6, Math.round(size * 0.45)), marginTop: gap + 2 }]}>{tagline}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  column: { alignItems: "flex-start" },
  t: { alignItems: "center" },
  // Thin, italic and faint: said quietly, not announced.
  tagline: { fontFamily: type.serif, fontStyle: "italic", fontWeight: "300", color: colors.inkFaint, letterSpacing: 0.3 },
});
