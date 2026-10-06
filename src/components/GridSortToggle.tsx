import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";

/** Kept for the gallery's `sort` param: the two grid orders. */
export type GridSort = "posted" | "taken";
/** The five ways a profile reads. */
export type ProfileView = GridSort | "timeline" | "map" | "places";

/**
 * The one control over a profile: how it reads.
 *
 * "Posted" is the grid as it has always been, newest post first. "Taken"
 * reads the same photographs by the day the shutter fired, which is the
 * order a shoebox of prints is in. "Timeline" hangs them off one line by
 * that same date, with the years written in. "Map" pins them where they
 * say they were taken; "Places" files them under those towns' names. Five
 * words in tracked mono, the current one in ink — a mark on the contact
 * sheet, not a segmented control.
 */
export function GridSortToggle({ value, onChange }: { value: ProfileView; onChange: (next: ProfileView) => void }) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      <Text style={styles.label} numberOfLines={1}>Profile view:</Text>
      {/* The label stays put; on the narrowest phones the views scroll past it. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options} style={styles.optionsScroll}>
        <Option label="Posted" active={value === "posted"} onPress={() => onChange("posted")} />
        <Text style={styles.divider}>·</Text>
        <Option label="Taken" active={value === "taken"} onPress={() => onChange("taken")} />
        <Text style={styles.divider}>·</Text>
        <Option label="Timeline" active={value === "timeline"} onPress={() => onChange("timeline")} />
        <Text style={styles.divider}>·</Text>
        <Option label="Map" active={value === "map"} onPress={() => onChange("map")} />
        <Text style={styles.divider}>·</Text>
        <Option label="Places" active={value === "places"} onPress={() => onChange("places")} />
      </ScrollView>
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
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.paper,
  },
  // Six words on one line of a phone: a little smaller and tighter than
  // the rest of the mono so the label and all five views fit abreast.
  label: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.inkFaint,
    flexShrink: 0,
  },
  optionsScroll: { flex: 1 },
  options: { flexGrow: 1, justifyContent: "flex-end", alignItems: "center", gap: 6, paddingLeft: 6 },
  option: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  optionOn: { color: colors.ink },
  divider: { color: colors.border, fontSize: 10 },
});
