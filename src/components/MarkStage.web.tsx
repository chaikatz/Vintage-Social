import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Image } from "expo-image";

const STILL = require("../../assets/brand/mark-v.png");

/**
 * The mark on the web build of the app: a still of the scene. The turning
 * V on the web lives on vintagesocial.app's own pages (public/home.html,
 * api/invite.ts); the app's web build is the review surface and keeps to
 * the still rather than carrying three.js twice.
 */
export function MarkStage({
  height,
  width,
  fill = 1.3,
  style,
}: {
  height: number;
  width?: number | `${number}%`;
  fill?: number;
  style?: ViewStyle;
}) {
  const stillHeight = Math.round(height / fill);
  return (
    <View style={[styles.box, { height, width: width ?? "100%" }, style]} pointerEvents="none">
      <Image
        source={STILL}
        style={{ height: stillHeight, width: Math.round(stillHeight * 0.905) }}
        contentFit="contain"
        transition={0}
        accessibilityLabel="The VINTAGE mark, a serif V"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
