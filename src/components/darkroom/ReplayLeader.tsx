import React, { memo, useMemo } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { SIGNATURE_RULE } from "./geometry";
import { useLook } from "./look";
import { signatureInks } from "./room";

/**
 * The leader: how far the replay has come, as a hairline the width of the
 * glide strip, drawn along its foot, under the frames, so the edge marks
 * keep the strip's top edge to themselves. One length is the whole replay:
 * it is drawn out from the left as each photograph plays (`useReplay`
 * sweeps it through the photograph's share), eases back onto the
 * photograph's place when held, and is drawn whole at the end. Under
 * Reduce Motion it steps with each photograph. It is not a control: the
 * strip is the scrubber, and the leader follows the strip while a finger
 * glides it.
 *
 * Drawn as the signature line draws a download along it (`signatureInks`):
 * the print's strong line, and the accent along it wherever the accent
 * stands 3:1 off the line, the ink where it does not. The fill is the
 * whole line, scaled from its left end on the native driver (a scale
 * about the centre, slid left by what it leaves): no layout is animated.
 *
 * For the eye alone: never touched, never heard. VoiceOver hears where the
 * replay is in the photograph's own value.
 */
export const ReplayLeader = memo(function ReplayLeader({ fraction, width }: { fraction: Animated.Value; width: number }) {
  const look = useLook();
  const inks = signatureInks(look.room, look.contrast, true);
  const drawn = useMemo(
    () => ({
      transform: [
        { translateX: fraction.interpolate({ inputRange: [0, 1], outputRange: [-width / 2, 0], extrapolate: "clamp" }) },
        { scaleX: fraction.interpolate({ inputRange: [0, 1], outputRange: [0.0001, 1], extrapolate: "clamp" }) },
      ],
    }),
    [fraction, width],
  );
  return (
    <View
      style={[styles.leader, { width, backgroundColor: inks.line }]}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="darkroom-replay-leader"
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: inks.drawn }, drawn]} testID="darkroom-replay-leader-drawn" />
    </View>
  );
});

const styles = StyleSheet.create({
  leader: { height: SIGNATURE_RULE, alignSelf: "center", overflow: "hidden" },
});
