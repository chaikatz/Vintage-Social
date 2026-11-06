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
 * The fourth, `card`, is the bar in the invitation card's stock, ruled and
 * lettered in its ink: the way into the Memory Room. On paper that is
 * printed brown and gold; on the black page it is a card a step up from
 * the black, lettered in white, with the grey rule drawing its edge.
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
      // Named by its title even while the spinner stands in for it, when
      // VoiceOver used to read Sign in or Submit application as nothing.
      accessibilityLabel={title}
      accessibilityState={{ disabled: loading || disabled, busy: loading }}
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

/**
 * Kept clear on both sides of a bar's label: the arrow's 18, its 16 in
 * from the edge, and 6 between (more to the eye: the arrow's glyph has
 * its own margin inside those 18). The label is centred across the whole
 * bar, and at the larger text sizes it wrapped to the bar's full width and
 * ran under the arrow ("I HAVE AN INVITATION", "SUBMIT APPLICATION"). At
 * the default size nothing moves: the longest label at the door is about
 * 180 points, and on the narrowest phone this build runs on, 320 points
 * (the first iPhone SE, or a mini or an SE with Display Zoom), the bar
 * leaves it 184 between the two clearances, so it stays on one line in
 * the same place. At 44 it took two lines there.
 *
 * The card is the Post tab's Memory Room bar, and that page gives both its
 * bars their size and their own clearance (app/(tabs)/create.tsx, its
 * `bar` style), which overrides these; the card keeps none of its own.
 */
const ARROW_CLEARANCE = 40;

const styles = StyleSheet.create({
  // At least 44, never fixed: at the larger text sizes a label takes two
  // lines and the bar grows to hold them, where a fixed height cut them off.
  base: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  solid: { backgroundColor: GATE_BUTTON, paddingHorizontal: ARROW_CLEARANCE },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.goldSoft },
  outline: { borderWidth: 1, borderColor: colors.ink, paddingHorizontal: ARROW_CLEARANCE },
  quiet: { minHeight: 0, paddingVertical: spacing.md },
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
