import React, { useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { colors, spacing, type } from "@/theme";
import { PROFILE_VIEWS, revealOffset, type ProfileView } from "@/utils/profileViews";

export type { GridSort, ProfileView } from "@/utils/profileViews";

/** Room left after the current option when the row is scrolled to it, so it does not sit against the edge. */
const EDGE = spacing.lg;

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
 * There is no label in front of them: the six words say what they are,
 * and VoiceOver hears the group's name. They fit abreast on most phones.
 * Where they do not (the narrowest, or with larger text) the row scrolls,
 * and it opens with the current view in sight. The row is drawn afresh
 * with each view, so it is put there each time it is drawn, before it is
 * seen moving.
 */
export function GridSortToggle({ value, onChange }: { value: ProfileView; onChange: (next: ProfileView) => void }) {
  const scroll = useRef<ScrollView>(null);
  const spots = useRef(new Map<ProfileView, { x: number; width: number }>());
  const room = useRef({ viewport: 0, content: 0 });
  const placed = useRef(false);

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
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Profile view">
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.options}
        style={styles.optionsScroll}
        onLayout={(e) => {
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.paper,
  },
  optionsScroll: { flex: 1 },
  // Six words on one line of a phone: a little smaller and tighter than
  // the rest of the mono so all of them fit abreast.
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
