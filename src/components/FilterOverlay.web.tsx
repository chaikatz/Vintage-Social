import React from "react";
import { StyleSheet, View } from "react-native";
import { cssFilterFor } from "@/filters/cssFilter";
import type { FilterSpec } from "@/filters";

/**
 * The fade, tint and vignette layers of a filter, drawn over whatever sits
 * beneath them.
 *
 * Photographs get their filter baked into the pixels at publish time, so
 * they never need this. Video does: burning a filter into footage means a
 * transcode VINTAGE doesn't do yet, so a video's filter is applied live,
 * every time it plays. Colour and contrast come from the `filter` style on
 * the media itself; these are the parts a single CSS filter can't express.
 */
export function FilterOverlay({ filter }: { filter: FilterSpec }) {
  const styles = cssFilterFor(filter);
  return (
    <>
      {styles.fadeOverlay ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: styles.fadeOverlay }]}
        />
      ) : null}
      {styles.tintOverlay ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: styles.tintOverlay }]}
        />
      ) : null}
      {styles.vignetteBoxShadow ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { boxShadow: styles.vignetteBoxShadow } as object]}
        />
      ) : null}
    </>
  );
}
