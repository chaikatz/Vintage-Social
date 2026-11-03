import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";

interface Props {
  title: string;
  /** A sentence, or (Editorial (Preview)) a sentence with a member's username set in the names' face. */
  body?: React.ReactNode;
}

export function EmptyState({ title, body }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: spacing.xxl * 2, paddingHorizontal: spacing.xl },
  title: { ...type.title, fontSize: 18, textAlign: "center" },
  body: { ...type.caption, textAlign: "center", marginTop: spacing.sm, color: colors.inkSoft },
});
