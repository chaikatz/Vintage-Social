import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { room, roomType } from "./room";

/**
 * A page of words in the Darkroom — the colophon layout every state
 * shares: a chapter label in gold, a line in the serif, a quieter line in
 * the italic, and the ways on stacked beneath. Centred, never wider than a
 * comfortable measure, and scrollable so the largest type still fits.
 */
export function Plate({
  eyebrow,
  title,
  body,
  children,
  foot,
  titleSize = 26,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  children?: React.ReactNode;
  foot?: string;
  titleSize?: number;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.column}>
        {eyebrow ? (
          <Text style={[roomType.eyebrow, styles.eyebrow]} maxFontSizeMultiplier={1.6}>
            {eyebrow}
          </Text>
        ) : null}
        <Text style={[styles.title, { fontSize: titleSize, lineHeight: Math.round(titleSize * 1.3) }]} accessibilityRole="header" maxFontSizeMultiplier={2}>
          {title}
        </Text>
        {body ? (
          <Text style={styles.body} maxFontSizeMultiplier={2.4}>
            {body}
          </Text>
        ) : null}
        {children ? <View style={styles.actions}>{children}</View> : null}
        {foot ? (
          <Text style={styles.foot} maxFontSizeMultiplier={2.4}>
            {foot}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 32, paddingVertical: 24 },
  column: { alignItems: "center", maxWidth: 320, alignSelf: "center", width: "100%" },
  eyebrow: { color: room.gold, marginBottom: 16 },
  title: { fontFamily: roomType.serif, color: room.ink, textAlign: "center" },
  body: { fontFamily: roomType.serif, fontStyle: "italic", fontSize: 15, lineHeight: 22, color: room.soft, textAlign: "center", marginTop: 10 },
  actions: { marginTop: 32, alignItems: "center", gap: 4 },
  foot: { fontFamily: roomType.serif, fontStyle: "italic", fontSize: 13, lineHeight: 19, color: room.faint, textAlign: "center", marginTop: 24 },
});
