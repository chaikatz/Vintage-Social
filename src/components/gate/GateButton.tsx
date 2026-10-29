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
 *
 * The fourth, `card`, is the bar in the invitation card's printed brown,
 * ruled and lettered in its gold: the way into the Memory Room. On the
 * dark page the brown is a shade below the paper, so the rule is what
 * draws its edge.
 */
export function GateButton({
  title,
  onPress,
  variant = "outline",
  loading = false,
  disabled = false,
  accessibilityHint,
  maxFontSizeMultiplier,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "solid" | "outline" | "quiet" | "card";
  loading?: boolean;
  /** Inert without looking it: something else on the screen is opening. */
  disabled?: boolean;
  accessibilityHint?: string;
  /** Where the label stops growing with the text size, for a bar that has to keep its letters on one line. */
  maxFontSizeMultiplier?: number;
  style?: ViewStyle;
}) {
  const solid = variant === "solid";
  const card = variant === "card";
  const quiet = variant === "quiet";
  const ink = solid
    ? (GATE_ON_BUTTON as unknown as string)
    : card
      ? colors.gold
      : (colors.ink as unknown as string);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        solid && styles.solid,
        card && styles.card,
        variant === "outline" && styles.outline,
        quiet && styles.quiet,
        pressed && styles.pressed,
        loading && styles.loading,
        style,
      ]}
      onPress={onPress}
      disabled={loading || disabled}
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
    >
      {loading ? (
        <ActivityIndicator size="small" color={ink} />
      ) : (
        <>
          <Text style={[styles.label, solid && styles.labelSolid, card && styles.labelCard]} maxFontSizeMultiplier={maxFontSizeMultiplier}>
            {title}
          </Text>
          {quiet ? <View style={[styles.quietRule, { width: ruleWidth(title) }]} /> : <Feather name="arrow-right" size={18} color={ink} style={styles.arrow} />}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { height: 44, alignItems: "center", justifyContent: "center" },
  solid: { backgroundColor: GATE_BUTTON },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.goldSoft },
  outline: { borderWidth: 1, borderColor: colors.ink },
  quiet: { height: undefined, paddingVertical: spacing.md },
  pressed: { opacity: 0.75 },
  loading: { opacity: 0.6 },
  label: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2.4,
    marginRight: -2.4, // tracked type's trailing space, so the rule beneath centres on the letters
    textTransform: "uppercase",
    color: colors.ink,
  },
  labelSolid: { color: GATE_ON_BUTTON },
  labelCard: { color: colors.gold },
  arrow: { position: "absolute", right: 16 },
  quietRule: { width: 26, height: 1, backgroundColor: colors.ink, marginTop: 7, opacity: 0.8 },
});
