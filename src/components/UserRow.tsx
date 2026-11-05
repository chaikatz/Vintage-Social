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

/** What VoiceOver reads for the member: the name, then what the row says under it. */
export function userRowLabel(username: string, title?: string | null, subtitle?: string | null): string {
  return [username, title, subtitle].filter(Boolean).join(", ");
}

/**
 * A member in a list: face and name, which open them, and beside it the
 * row's own control (Follow, Forget, an admin's actions).
 *
 * The control stands beside the pressable part, not inside it. A
 * Pressable is one element to VoiceOver and swallows whatever is in it:
 * with the control inside, Follow, Forget and the admins' Warn and Suspend
 * could not be reached at all. The look is as it was.
 */
export function UserRow({ username, avatarPath, title, subtitle, onPress, right }: Props) {
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.person}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={userRowLabel(username, title, subtitle)}
      >
        <Avatar path={avatarPath} username={username} size={44} />
        <View style={styles.text}>
          <Text style={styles.username}>{username}</Text>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </Pressable>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  person: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
  },
  text: { flex: 1, marginLeft: spacing.md },
  username: { fontSize: 14, fontWeight: "600", color: colors.ink },
  title: { fontSize: 13, color: colors.inkSoft, marginTop: 1 },
  subtitle: { fontSize: 12, color: colors.inkFaint, marginTop: 1 },
});
