import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/theme";
import { Avatar } from "./Avatar";

interface Props {
  username: string;
  avatarPath: string | null;
  title?: string | null;
  subtitle?: string | null;
  onPress: () => void;
  right?: React.ReactElement;
}

export function UserRow({ username, avatarPath, title, subtitle, onPress, right }: Props) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Avatar path={avatarPath} username={username} size={44} />
      <View style={styles.text}>
        <Text style={styles.username}>{username}</Text>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  text: { flex: 1, marginLeft: spacing.md },
  username: { fontSize: 14, fontWeight: "600", color: colors.ink },
  title: { fontSize: 13, color: colors.inkSoft, marginTop: 1 },
  subtitle: { fontSize: 12, color: colors.inkFaint, marginTop: 1 },
});
