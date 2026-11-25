import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { GateButton } from "@/components/gate/GateButton";
import { colors, spacing, type } from "@/theme";

/**
 * The foot of the roll, where it ends — at the library's own end, or at
 * the 1,200 the tab reads at most: further back is the Memory Room's,
 * one photograph at a time, and its bar, in the invitation card's stock,
 * is the way in.
 */

const TYPE_CAP = 2.4;
/** The bar's capitals stop growing here. At the largest sizes the label takes two lines, and the bar grows to hold them. */
const BAR_TYPE_CAP = 1.8;
/** GateButton's arrow is 18 wide, 16 in from the edge: the label keeps clear of it on both sides, so it stays centred. */
const BAR_INSET = 36;

export function RollFooter({ held, onEnter }: { held: boolean; onEnter: () => void }) {
  return (
    <View testID="post-footer" style={styles.foot}>
      <Text style={styles.eyebrow} accessibilityRole="header" maxFontSizeMultiplier={BAR_TYPE_CAP}>
        Further back
      </Text>
      <Text style={styles.line} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
        In the Memory Room, one at a time.
      </Text>
      <GateButton
        title="Enter the Memory Room"
        variant="card"
        style={styles.bar}
        maxFontSizeMultiplier={BAR_TYPE_CAP}
        disabled={held}
        accessibilityHint="Opens your photographs, one at a time, from further back."
        onPress={onEnter}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  foot: { paddingTop: spacing.xl, paddingBottom: spacing.xl, paddingHorizontal: spacing.lg },
  eyebrow: { fontFamily: type.mono, fontSize: 10, letterSpacing: 2.4, textTransform: "uppercase", color: colors.inkSoft },
  line: { fontSize: 15, lineHeight: 21, color: colors.inkSoft, marginTop: spacing.sm },
  bar: {
    height: undefined,
    minHeight: 52,
    paddingVertical: spacing.md,
    paddingHorizontal: BAR_INSET,
    marginTop: spacing.lg,
  },
});
