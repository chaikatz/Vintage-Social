import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";
import { NamedWords } from "./MemberText";

interface Props {
  title: string;
  body?: string;
  /** Editorial (Preview): the username the body is written around, if any, set in the names' face (src/utils/nameFace.ts). */
  name?: string;
}

export function EmptyState({ title, body, name }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{name ? <NamedWords words={body} name={name} size={13} /> : body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: spacing.xxl * 2, paddingHorizontal: spacing.xl },
  title: { ...type.title, fontSize: 18, textAlign: "center" },
  body: { ...type.caption, textAlign: "center", marginTop: spacing.sm, color: colors.inkSoft },
});
