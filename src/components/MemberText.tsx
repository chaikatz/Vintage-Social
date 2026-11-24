import React, { useMemo } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { colors } from "@/theme";
import { parseMentions } from "@/utils/mentions";
import { useNameFace } from "@/utils/nameFace";

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
 *
 * Editorial (Preview): given the size of the words it is drawn in, an @name is set
 * in the names' face to match them, still in the accent
 * (src/utils/nameFace.ts). PostCard, drawn only under Original, gives none.
 */
export const MentionText = React.memo(function MentionText({
  text,
  onOpenProfile,
  onLongPress,
  size,
}: {
  text: string;
  onOpenProfile: (username: string) => void;
  onLongPress?: () => void;
  /** The size of the words around it, in points. */
  size?: number;
}) {
  const face = useNameFace();
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
            style={[styles.mention, size == null ? undefined : face(size)]}
          >
            {part.text}
          </NameLink>
        ),
      )}
    </>
  );
});

/**
 * Words the app writes a username into (an empty page's sentence, a
 * private or blocked profile's line), drawn inside a <Text>.
 *
 * Editorial (Preview): the name in the names' face at the words' size
 * (src/utils/nameFace.ts), the words around it as they are. Under Original,
 * and where the name is not in the words as a word of its own, the words
 * are the one string they always were.
 */
export function NamedWords({ words, name, size }: { words: string; name: string; size: number }) {
  const face = useNameFace();
  const at = face(size) ? nameAt(words, name) : -1;
  if (at < 0) return <>{words}</>;
  return (
    <>
      {words.slice(0, at)}
      <Text style={face(size)}>{name}</Text>
      {words.slice(at + name.length)}
    </>
  );
}

/** Where `name` is written in `words` as a word of its own, not inside another: its first such place, or -1. */
function nameAt(words: string, name: string): number {
  const part = /[\p{L}\p{N}._]/u;
  for (let at = words.indexOf(name); at >= 0 && name.length > 0; at = words.indexOf(name, at + 1)) {
    if (!part.test(words[at - 1] ?? "") && !part.test(words[at + name.length] ?? "")) return at;
  }
  return -1;
}

const styles = StyleSheet.create({
  mention: { color: colors.accent, fontWeight: "600" },
});
