import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { bladeDepth } from "./geometry";
import { useLook } from "./look";
import { room } from "./room";

/** In, as DEVELOP is tapped; out, a beat after the room is back in front. */
const CLOSE_MS = 220;
const OPEN_MS = 180;
const OPEN_DELAY_MS = 120;
const BLADE_OPACITY = 0.85;

/**
 * The easel blades: two masks of the room's own page that slide in over
 * the parts of a print the feed will crop, the way an enlarger's easel
 * frames the paper. Only for a print outside the feed's 4:5 to 1.91:1
 * (`feedCrops`): from the top and bottom for a tall one, the sides for a
 * wide one. They close as DEVELOP is tapped, stay while the editor is on
 * top, and open again once the room is back. Under Reduce Motion they
 * appear and go at once. Never read aloud.
 */
export function Blades({ plate, ratio, closed }: { plate: { width: number; height: number }; ratio: number; closed: boolean }) {
  const look = useLook();
  const blade = bladeDepth(plate, ratio);
  const shut = useRef(new Animated.Value(closed ? 1 : 0)).current;

  useEffect(() => {
    const anim = Animated.timing(shut, {
      toValue: closed ? 1 : 0,
      duration: look.reduceMotion ? 0 : closed ? CLOSE_MS : OPEN_MS,
      delay: closed || look.reduceMotion ? 0 : OPEN_DELAY_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [closed, look.reduceMotion, shut]);

  if (!blade) return null;
  const { depth } = blade;
  const vertical = blade.axis === "vertical";
  const slide = (from: number) => shut.interpolate({ inputRange: [0, 1], outputRange: [from, 0] });
  const size = vertical ? { left: 0, right: 0, height: depth } : { top: 0, bottom: 0, width: depth };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={[
          styles.blade,
          size,
          vertical ? { top: 0, transform: [{ translateY: slide(-depth) }] } : { left: 0, transform: [{ translateX: slide(-depth) }] },
        ]}
      />
      <Animated.View
        style={[
          styles.blade,
          size,
          vertical ? { bottom: 0, transform: [{ translateY: slide(depth) }] } : { right: 0, transform: [{ translateX: slide(depth) }] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  blade: { position: "absolute", backgroundColor: room.page, opacity: BLADE_OPACITY },
});
