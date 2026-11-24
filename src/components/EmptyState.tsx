import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";
import { NamedWords } from "./MemberText";

interface Props {
  title: string;
  /**
   * Editorial (Preview): or, where the body is written around a member's
   * username, what writes it, given `name`, so the name is set in the names'
   * face (src/utils/nameFace.ts); drawn once the name is known.
   */
  body?: string | ((name: string) => string);
  name?: string;
}

export function EmptyState({ title, body, name }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {typeof body === "function" ? (
        name ? (
          <Text style={styles.body}>
            <NamedWords words={body} name={name} size={13} />
          </Text>
        ) : null
      ) : body ? (
        <Text style={styles.body}>{body}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: spacing.xxl * 2, paddingHorizontal: spacing.xl },
  title: { ...type.title, fontSize: 18, textAlign: "center" },
  body: { ...type.caption, textAlign: "center", marginTop: spacing.sm, color: colors.inkSoft },
});
