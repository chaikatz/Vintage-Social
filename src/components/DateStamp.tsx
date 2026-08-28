import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, type } from "@/theme";
import { dateStampText } from "@/utils/time";

/**
 * The amber date stamp of a 90s point-and-shoot, rendered bottom-right over
 * the photograph. Rendered (not burned into pixels) so stamps stay crisp at
 * any size and can be re-styled later.
 */
export function DateStamp({ iso }: { iso: string }) {
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Text style={styles.text}>{dateStampText(iso)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", right: 14, bottom: 12 },
  text: {
    fontFamily: type.mono,
    fontSize: 15,
    fontWeight: "700",
    color: colors.stamp,
    textShadowColor: colors.stampGlow,
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 0 },
    opacity: 0.92,
  },
});
