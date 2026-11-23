import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { colors, radii, spacing } from "@/theme";
import { useMentionSuggestions } from "@/hooks/useMentionField";
import { useNameFace } from "@/utils/nameFace";
import type { ActiveMention } from "@/utils/mentions";
import { Avatar } from "./Avatar";
import { memberLabel } from "./memberLabel";

/**
 * The members a name being written could be, in a row of chips over the
 * keyboard: face and username, the people the writer follows first. One
 * tap writes `@username ` in place of what was typed, and the keyboard
 * stays up. Drawn only while a name is being written and someone answers
 * it; otherwise `fallback` (on Comments, the row of quick reactions), or
 * nothing.
 */
export function MentionSuggestions({
  mention,
  myId,
  onPick,
  fallback = null,
  style,
}: {
  mention: ActiveMention | null;
  myId: string;
  onPick: (username: string) => void;
  fallback?: React.ReactElement | null;
  /** Where the row sits, when it is drawn. */
  style?: StyleProp<ViewStyle>;
}) {
  const members = useMentionSuggestions(mention, myId);
  // Editorial (Preview): each member's username, half bold.
  const face = useNameFace();
  if (members.length === 0) return fallback;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // A tap on a chip chooses it, the keyboard up or not.
      keyboardShouldPersistTaps="always"
      style={[styles.row, style]}
      contentContainerStyle={styles.content}
      accessibilityLabel="Members"
    >
      {members.map((m) => (
        <Pressable
          key={m.id}
          onPress={() => onPick(m.username)}
          style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
          accessibilityRole="button"
          accessibilityLabel={memberLabel(m.username, m.full_name)}
          accessibilityHint="Adds their name"
        >
          <Avatar path={m.avatar_url} username={m.username} size={26} />
          <Text style={[styles.username, face]} numberOfLines={1}>
            {m.username}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** A chip's height at the text size most read at. */
const CHIP_HEIGHT = 40;
/**
 * The row's height at that size: a chip and the room above and below it.
 * Comments' row of quick reactions is as tall, so the field under them
 * stays put as one row takes the other's place.
 */
export const MENTION_ROW_HEIGHT = CHIP_HEIGHT + spacing.xs * 2;

const styles = StyleSheet.create({
  row: { flexGrow: 0 },
  content: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: CHIP_HEIGHT,
    paddingLeft: 7,
    paddingRight: spacing.md,
    borderRadius: radii.round,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.paperRaised,
  },
  chipPressed: { backgroundColor: colors.paperSunken },
  username: { fontSize: 14, fontWeight: "600", color: colors.ink, maxWidth: 160 },
});
