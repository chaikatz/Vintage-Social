import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";

/** Kept for the gallery's `sort` param: the two grid orders. */
export type GridSort = "posted" | "taken";
/** The three ways a profile reads. */
export type ProfileView = GridSort | "timeline";

/**
 * The one control over a profile: how it reads.
 *
 * "Posted" is the grid as it has always been, newest post first. "Taken"
 * reads the same photographs by the day the shutter fired, which is the
 * order a shoebox of prints is in. "Timeline" hangs them off one line by
 * that same date, with the years written in. Three words in tracked mono,
 * the current one in ink — a mark on the contact sheet, not a segmented
 * control.
 */
export function GridSortToggle({ value, onChange }: { value: ProfileView; onChange: (next: ProfileView) => void }) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      <Option label="Posted" active={value === "posted"} onPress={() => onChange("posted")} />
      <Text style={styles.divider}>·</Text>
      <Option label="Taken" active={value === "taken"} onPress={() => onChange("taken")} />
      <Text style={styles.divider}>·</Text>
      <Option label="Timeline" active={value === "timeline"} onPress={() => onChange("timeline")} />
    </View>
  );
}

function Option({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="radio" accessibilityState={{ selected: active }}>
      <Text style={[styles.option, active && styles.optionOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.paper,
  },
  option: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  optionOn: { color: colors.ink },
  divider: { color: colors.border, fontSize: 10 },
});
