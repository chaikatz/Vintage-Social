import React, { useMemo } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { colors } from "@/theme";
import { parseMentions } from "@/utils/mentions";

/**
 * A member's name inside a line of words — a comment's author, a
 * caption's, the one a notice is from — drawn as the line draws it, and a
 * link to their page. Pressed, the name greys under the finger as iOS
 * marks a link in text. Held, it does what holding the line around it
 * does (a comment's menu), so a name is no hole in the row it sits in.
 *
 * Drawn inside a <Text>, never on its own.
 */
export function NameLink({
  username,
  onOpenProfile,
  onLongPress,
  style,
  children,
}: {
  username: string;
  onOpenProfile: (username: string) => void;
  onLongPress?: () => void;
  style?: StyleProp<TextStyle>;
  /** What is drawn; the username unless given. */
  children?: React.ReactNode;
}) {
  return (
    <Text
      style={style}
      onPress={() => onOpenProfile(username)}
      onLongPress={onLongPress}
      accessibilityRole="link"
      accessibilityHint="Opens their profile"
    >
      {children ?? username}
    </Text>
  );
}

/**
 * What a member wrote — a caption, a comment — with every @name in it a
 * link to that member's page (src/utils/mentions.ts). The words are drawn
 * exactly as they were typed, in the style of the <Text> around them; the
 * names stand out in the accent, as a link does. Held, a name does what
 * holding the words around it does.
 *
 * Drawn inside a <Text>, never on its own. The words are read once for
 * their names, and again only when they change.
 */
export const MentionText = React.memo(function MentionText({
  text,
  onOpenProfile,
  onLongPress,
}: {
  text: string;
  onOpenProfile: (username: string) => void;
  onLongPress?: () => void;
}) {
  const parts = useMemo(() => parseMentions(text), [text]);
  if (parts.length === 1 && parts[0].kind === "text") return <>{parts[0].text}</>;
  return (
    <>
      {parts.map((part, i) =>
        part.kind === "text" ? (
          part.text
        ) : (
          <NameLink
            key={i}
            username={part.username}
            onOpenProfile={onOpenProfile}
            onLongPress={onLongPress}
            style={styles.mention}
          >
            {part.text}
          </NameLink>
        ),
      )}
    </>
  );
});

const styles = StyleSheet.create({
  mention: { color: colors.accent, fontWeight: "600" },
});
