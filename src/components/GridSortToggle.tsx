import React, { useId, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { colors, spacing, type } from "@/theme";
import { PROFILE_VIEWS, revealOffset, type ProfileView } from "@/utils/profileViews";

export type { GridSort, ProfileView } from "@/utils/profileViews";

/** Room left after the current option when the row is scrolled to it, so it does not sit against the edge. */
const EDGE = spacing.lg;
/** Either side of the hairline between the label and the views. */
const LABEL_GAP = 6;

/**
 * The one control over a profile: how it reads.
 *
 * "Posted" is the grid as it has always been, newest post first. "Taken"
 * reads the same photographs by the day the shutter fired, which is the
 * order a shoebox of prints is in. "Timeline" hangs them off one line by
 * that same date, with the years written in. "Eras" gathers them into
 * chapters: a place and a year, or a season and a year. "Map" pins them
 * where they say they were taken; "Places" files them under those towns'
 * names. Six words in tracked mono, the current one in ink — a mark on
 * the contact sheet, not a segmented control.
 *
 * "Profile view" stands in front of them, a size smaller, with a hairline
 * between, and stays where it is. The six fit beside it from 390 pt up;
 * where they do not (the narrower phones, or larger text) they scroll
 * behind the hairline and out past the edge of the screen, and the row
 * opens with the current view in sight. The row is drawn afresh with each
 * view, so it is put there each time it is drawn, before it is seen
 * moving.
 *
 * The label is the group's name. VoiceOver reads it as it reads any
 * words on the page, just before the first view, so the six radios say
 * only their own names; the readers that announce a group take its name
 * from the same words.
 */
export function GridSortToggle({ value, onChange }: { value: ProfileView; onChange: (next: ProfileView) => void }) {
  const scroll = useRef<ScrollView>(null);
  const spots = useRef(new Map<ProfileView, { x: number; width: number }>());
  const room = useRef({ viewport: 0, content: 0 });
  const placed = useRef(false);
  const labelId = useId();

  // Once the row, what it holds and the current option are all measured.
  const place = () => {
    if (placed.current) return;
    const spot = spots.current.get(value);
    const { viewport, content } = room.current;
    if (!spot || viewport <= 0 || content <= 0) return;
    placed.current = true;
    const x = revealOffset(spot, viewport, content, EDGE);
    if (x > 0) scroll.current?.scrollTo({ x, animated: false });
  };

  return (
    <View style={styles.row} accessibilityRole="radiogroup" aria-labelledby={labelId}>
      <Text nativeID={labelId} style={styles.label} numberOfLines={1}>
        Profile view
      </Text>
      {/* Outside the scroll, so it stays put while the views move past it; the views are cut at the hairline. */}
      <View style={styles.labelRule} />
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.options}
        style={styles.optionsScroll}
        onLayout={(e) => {
          // The views' own window, with the label's width already taken from it.
          room.current.viewport = e.nativeEvent.layout.width;
          place();
        }}
        onContentSizeChange={(width) => {
          room.current.content = width;
          place();
        }}
      >
        {PROFILE_VIEWS.map(({ view, label }, i) => (
          <React.Fragment key={view}>
            {i > 0 ? <Text style={styles.divider}>·</Text> : null}
            <Option
              label={label}
              active={value === view}
              onPress={() => onChange(view)}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                spots.current.set(view, { x, width });
                place();
              }}
            />
          </React.Fragment>
        ))}
      </ScrollView>
    </View>
  );
}

function Option({
  label,
  active,
  onPress,
  onLayout,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  return (
    <Pressable onPress={onPress} onLayout={onLayout} hitSlop={8} accessibilityRole="radio" accessibilityState={{ selected: active }}>
      <Text style={[styles.option, active && styles.optionOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // No margin on the right: the views run out to the screen's edge, so a
  // row that scrolls is cut by the edge of the phone rather than short of
  // it. Their content keeps the margin instead.
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.paper,
  },
  // A size below the views, in their faint ink, and set apart by the
  // hairline, so it reads as their name rather than as a seventh.
  label: {
    fontFamily: type.mono,
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
    flexShrink: 0,
    marginRight: LABEL_GAP,
  },
  labelRule: { width: 1, height: 10, backgroundColor: colors.border },
  optionsScroll: { flex: 1 },
  // Six words after the label on one line of a phone: a little smaller
  // and tighter than the rest of the mono so all of them fit abreast. They
  // follow the label, as its line, rather than stand off at the far edge.
  options: { alignItems: "center", gap: 4, paddingLeft: LABEL_GAP, paddingRight: spacing.lg },
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
