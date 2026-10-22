import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { room, roomType } from "./room";

/**
 * A page of words in the Darkroom: before access is given, when there is
 * nothing to show, when something went wrong. An eyebrow, a line in the
 * serif, a few sentences, and the ways on — never more.
 */
export function Plate({
  eyebrow,
  title,
  body,
  children,
  foot,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  children?: React.ReactNode;
  foot?: string;
}) {
  return (
    <View style={styles.root}>
      {eyebrow ? <Text style={roomType.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.rule} />
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
      {foot ? <Text style={styles.foot}>{foot}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", paddingHorizontal: 36 },
  title: { fontFamily: roomType.serif, fontSize: 28, lineHeight: 36, color: room.ink, marginTop: 14 },
  rule: { width: 24, height: 1, backgroundColor: room.ink, opacity: 0.8, marginTop: 18 },
  body: { fontFamily: roomType.serif, fontSize: 16, lineHeight: 25, color: room.soft, marginTop: 18 },
  actions: { marginTop: 28, alignItems: "flex-start", gap: 4 },
  foot: { fontFamily: roomType.mono, fontSize: 9.5, letterSpacing: 1.6, lineHeight: 15, color: room.faint, marginTop: 28, textTransform: "uppercase" },
});
