import React, { useMemo } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { colors } from "@/theme";
import { parseMentions } from "@/utils/mentions";
import { useNameFace } from "@/utils/nameFace";
import { USERNAME_RE } from "@/utils/validation";

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

/** What the words are written with in the name's place, to find it: a character no sentence or username holds. */
const SLOT = "\u0000";

/**
 * Words the app writes a username into (an empty page's sentence, a
 * private or blocked profile's line, who sent an applicant or an
 * invitation), drawn inside a <Text>. Handed what writes them, a function
 * of the name, rather than the words already written, so the name is found
 * exactly where the sentence puts it, never in one of the app's own words
 * that a member's username happens to spell ("You blocked blocked").
 *
 * Editorial (Preview): the name in the names' face at the words' size
 * (src/utils/nameFace.ts), the words around it as they are, where the name
 * reads as a username (USERNAME_RE, which every member's username is held
 * to): a name given as a member wrote it, or a full name where there is
 * one, keeps the words' own type. Under Original, and where the words do
 * not write the name once, they are the one string they always were.
 */
export function NamedWords({ words, name, size }: { words: (name: string) => string; name: string; size: number }) {
  const face = useNameFace();
  const around = face(size) && USERNAME_RE.test(name) ? words(SLOT).split(SLOT) : [];
  if (around.length !== 2) return <>{words(name)}</>;
  return (
    <>
      {around[0]}
      <Text style={face(size)}>{name}</Text>
      {around[1]}
    </>
  );
}

const styles = StyleSheet.create({
  mention: { color: colors.accent, fontWeight: "600" },
});
