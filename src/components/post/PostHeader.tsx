import React from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { askPage, pageProgress, usePostPage } from "@/post/pages";
import { HEAD_WORDS, HEADER_BAND, HEADER_BELOW } from "@/post/roll";
import { colors, type } from "@/theme";

/**
 * The Post tab's header, as the owner's mock draws it: two words side by
 * side in the serif, RECENT and MEMORY ROOM, the page you are on in ink
 * and the other in the quieter ink. It stands where the other tabs'
 * titles stand, in the header the tabs share (`TabHeader`), and does not
 * scroll away. Its band is the mock's: 56 points from the top of the safe
 * area to the photograph's frame, the words centred in it, so it reaches
 * 20 points below the shared header into the band the Post tab keeps
 * empty for it (`HEADER_BELOW`).
 *
 * As the pager moves, the two inks cross over with it: each word is drawn
 * twice, in the quieter ink and in ink over it, and the ink's opacity
 * follows `pageProgress`. Tapping MEMORY ROOM
 * slides to the room's door (a cut under Reduce Motion), which opens the
 * room; RECENT is where you are. VoiceOver hears "Recent, selected" and
 * "Memory Room, button, opens the Memory Room".
 *
 * The quieter ink: the mock's (#A39A88) and the theme's faint ink
 * (#9C927F, 2.9:1) are both under 3:1 on the paper, so on paper it is
 * the lightest tone of the mock's hue that reads at 4.5:1 (#777063,
 * 4.55:1), which also stands 3:1 apart from the ink, as the soft ink
 * (2.6:1) did not; on black the faint ink already does both (6.4:1), and
 * stays.
 */

/** The words grow with the text size only this far, so the two stay on one line in the band. */
const HEAD_TYPE_CAP = 1.3;

const recentInk = pageProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: "clamp" });
const roomInk = pageProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" });

export function PostHeader() {
  const page = usePostPage();
  return (
    <View testID="post-head" style={styles.band} pointerEvents="box-none">
      <Word
        testID="post-head-recent"
        word="Recent"
        ink={recentInk}
        onPress={() => askPage(0)}
        selected={page === 0}
        role={undefined}
        hint={undefined}
      />
      <Word
        testID="post-head-room"
        word="Memory Room"
        ink={roomInk}
        onPress={() => askPage(1)}
        selected={page === 1}
        role="button"
        hint="Opens the Memory Room."
      />
    </View>
  );
}

function Word({
  testID,
  word,
  ink,
  onPress,
  selected,
  role,
  hint,
}: {
  testID: string;
  word: string;
  ink: Animated.AnimatedInterpolation<number>;
  onPress: () => void;
  selected: boolean;
  role: "button" | undefined;
  hint: string | undefined;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      // A 20-point serif line is 23 tall: 12 above and below make the 44 a finger needs, and more.
      hitSlop={{ top: 12, bottom: 12, left: HEAD_WORDS.gap / 2, right: HEAD_WORDS.gap / 2 }}
      accessibilityRole={role}
      accessibilityLabel={word}
      accessibilityHint={hint}
      accessibilityState={{ selected }}
      aria-selected={selected}
    >
      <Text style={[styles.word, styles.other]} maxFontSizeMultiplier={HEAD_TYPE_CAP}>
        {word}
      </Text>
      <Animated.Text style={[styles.word, styles.ink, { opacity: ink }]} maxFontSizeMultiplier={HEAD_TYPE_CAP} aria-hidden>
        {word}
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The mock's band, from the top of the safe area: the shared header's bottom less its 36 points, to 20 below it.
  band: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -HEADER_BELOW,
    height: HEADER_BAND,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: HEAD_WORDS.gap,
  },
  word: { fontFamily: type.serif, fontSize: HEAD_WORDS.size },
  other: { color: colors.inkOther },
  ink: { ...StyleSheet.absoluteFillObject, color: colors.ink },
});
