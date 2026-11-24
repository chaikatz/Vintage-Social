import React from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useLook } from "./look";
import { RoomText } from "./Type";
import { PLAY_HINT } from "./words";

/**
 * PLAY: CONTENTS' twin, mirrored to the foot of the page beside DEVELOP,
 * under the thumb, beside the place where the replay's own word, HOLD,
 * will stand in DEVELOP's stead. Drawn as CONTENTS is, a word and its
 * glyph in a tab ruled round in the print's firm line (the soft ink under
 * Increase Contrast), never the accent: DEVELOP stays the page's one
 * ruled word. Its press is 44 pt tall and its tab's left edge on the
 * page's 16 pt gutter, as CONTENTS' right edge is at the head.
 *
 * It leaves with DEVELOP onto the end page (the same opacity), and it is
 * pressed only while a page is not being turned. No haptic.
 */
export function PlayTab({
  opacity,
  interactive,
  onPress,
}: {
  opacity: Animated.Value | Animated.AnimatedInterpolation<number>;
  interactive: boolean;
  onPress: () => void;
}) {
  const { room, contrast } = useLook();
  return (
    <Animated.View style={[styles.place, { opacity }]} pointerEvents={interactive ? "box-none" : "none"}>
      <Pressable
        onPress={onPress}
        disabled={!interactive}
        style={({ pressed }) => [styles.press, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Play"
        accessibilityHint={PLAY_HINT}
        testID="darkroom-play"
      >
        <View style={[styles.tab, { borderColor: contrast ? room.soft : room.lineFirm }]} testID="darkroom-play-tab">
          <Feather name="play" size={14} color={room.ink} accessible={false} />
          <RoomText kind="tab" numberOfLines={1} maxFontSizeMultiplier={1.15}>
            Play
          </RoomText>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Over the bottom row, centred on DEVELOP's word, at the page's left.
  place: { position: "absolute", left: 4, top: 0, bottom: 0, justifyContent: "center", zIndex: 1 },
  press: { minHeight: 44, justifyContent: "center", paddingLeft: 12, paddingRight: 4 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 30, paddingHorizontal: 8, borderWidth: 1 },
  pressed: { opacity: 0.6 },
});
