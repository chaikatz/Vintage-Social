import React, { forwardRef } from "react";
import { Animated, ScrollView, StyleSheet, View, type Text } from "react-native";
import { RoomText } from "./Type";
import { Word } from "./Word";
import type { PageWord, PageWords } from "./words";

/**
 * A page of words in the room — the first-visit page, the door when it is
 * shut, the empty states, the error and the end pages — set as the
 * colophon of a photobook: the chapter in gold, a line in the serif, a
 * quieter line in the italic, and the ways on stacked beneath, the first
 * of them ruled. Centred, never wider than a comfortable measure, and
 * scrollable so the largest type still fits rather than clipping.
 *
 * The title is a header, so VoiceOver can land on it (`titleRef`) when the
 * page arrives.
 */
export const Plate = forwardRef<Text, {
  page: PageWords;
  onWord: (word: PageWord) => void;
  /** The column, faded out as the first-visit page gives way to the room. */
  opacity?: Animated.Value;
  testID?: string;
}>(function Plate({ page, onWord, opacity, testID }, titleRef) {
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      testID={testID}
    >
      <Animated.View style={[styles.column, opacity ? { opacity } : null]}>
        <RoomText kind="eyebrow" tone="gold" maxFontSizeMultiplier={2.4} style={styles.center}>
          {page.eyebrow}
        </RoomText>
        <RoomText
          ref={titleRef}
          kind={page.threshold ? "thresholdTitle" : "plateTitle"}
          accessibilityRole="header"
          maxFontSizeMultiplier={2.4}
          style={[styles.center, styles.title]}
        >
          {page.title}
        </RoomText>
        {page.body ? (
          <RoomText kind="body" maxFontSizeMultiplier={2.4} style={[styles.center, styles.body]}>
            {page.body}
          </RoomText>
        ) : null}
        {page.path ? (
          <RoomText kind="folio" maxFontSizeMultiplier={2.4} style={[styles.center, styles.path]}>
            {page.path}
          </RoomText>
        ) : null}
        {page.words.length > 0 ? (
          <View style={styles.words}>
            {page.words.map((w, i) => (
              <Word
                key={`${w.act}-${w.label}`}
                label={w.label}
                primary={i === 0}
                accessibilityHint={w.hint}
                onPress={() => onWord(w)}
                testID={`darkroom-word-${w.act}`}
              />
            ))}
          </View>
        ) : null}
        {page.foot ? (
          <RoomText kind="foot" maxFontSizeMultiplier={2.4} style={[styles.center, styles.foot]}>
            {page.foot}
          </RoomText>
        ) : null}
      </Animated.View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 32, paddingVertical: 24 },
  column: { alignItems: "center", alignSelf: "center", width: "100%", maxWidth: 300 },
  center: { textAlign: "center" },
  title: { marginTop: 16 },
  body: { marginTop: 10 },
  path: { marginTop: 12 },
  words: { marginTop: 32, alignItems: "center", gap: 4 },
  foot: { marginTop: 24 },
});
