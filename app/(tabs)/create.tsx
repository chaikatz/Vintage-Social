import React, { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type LayoutRectangle } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { colors, spacing, type } from "@/theme";
import { ruleWidth } from "@/components/gate/rule";
import { pickFromLibrary, takeForCompose, type PickedParams } from "@/utils/pickForCompose";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";
import { darkroomAvailable } from "@/darkroom/source";
import { placeLine } from "@/darkroom/session";
import { useSetAside } from "@/darkroom/setAside";

/**
 * Where a post begins.
 *
 * One photograph per post. Short videos are allowed but live in the same
 * feed and grid as everything else — there is no separate video surface.
 *
 * Set like the rest of VINTAGE: a serif line, then quiet rows ruled off
 * with hairlines. The ordinary ways in come first, one tap each — the
 * library, the camera, a short clip — because they are the habit, and the
 * Darkroom never stands between a member and the picture they came with.
 * Under them is the door to the Darkroom — the camera roll, one
 * print at a time, from further back than anyone scrolls — and then On
 * this day, what the member posted on this date in other years. Nothing
 * here is a card, a plate or a dark block; the Darkroom itself is the
 * dark room.
 *
 * This tab never reads the photo library. It may be on screen, or
 * preloaded beside one, without the member having gone near the
 * Darkroom, so it cannot be the thing that asks iOS for the library or
 * looks through it. What it says about the Darkroom it reads from the
 * Darkroom's own small files on this phone.
 */
export default function Create() {
  const router = useRouter();
  // Reading the capture date and decoding the photograph take a moment;
  // without a guard a second tap in that moment opened the editor twice.
  const [opening, setOpening] = useState(false);

  const openWith = async (get: () => Promise<PickedParams | null>) => {
    if (opening) return;
    setOpening(true);
    try {
      const params = await get();
      if (params) router.push({ pathname: "/compose", params });
    } finally {
      setOpening(false);
    }
  };

  const native = Platform.OS !== "web";
  const door = darkroomAvailable();

  return (
    <Screen padded={false} scroll>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>New post</Text>
        <Text style={styles.heading}>Share a photograph.</Text>
        <Text style={styles.sub}>One picture at a time. You choose the film and the date stamp next.</Text>

        <View style={styles.rule} />
        <Row
          icon="image"
          title="From your library"
          body="A photograph you've already taken"
          onPress={() => openWith(() => pickFromLibrary("photo"))}
          primary
          busy={opening}
        />
        {native ? (
          <>
            <View style={styles.hairline} />
            <Row icon="camera" title="Camera" body="Take one now" onPress={() => openWith(takeForCompose)} />
          </>
        ) : null}
        <View style={styles.hairline} />
        <Row
          icon="film"
          title="Short video"
          body={`Up to ${MAX_VIDEO_SECONDS} seconds, same feed, same grid`}
          onPress={() => openWith(() => pickFromLibrary("video"))}
        />
        <View style={styles.rule} />

        {door ? (
          <>
            <DarkroomDoor />
            <View style={styles.hairline} />
          </>
        ) : null}
        <Row
          icon="sun"
          title="On this day"
          body="What you posted on this date in other years"
          onPress={() => router.push("/memories")}
        />
        <View style={styles.rule} />

        <Text style={styles.note}>Nothing here is ranked. A photograph is seen by the people who follow you, in the order it was posted.</Text>
      </View>
    </Screen>
  );
}

/** The door's type stops growing here, as the Darkroom's own word pages do. */
const DOOR_TYPE_CAP = 2.4;
/** ENTER's box: 4 above the letters, then the rule 7 below them, 1 high, then 4 more. */
const ENTER_PAD = 4;
const ENTER_RULE_GAP = 7;
/** SET ASIDE stands this far to the right of ENTER, on the same line of letters. */
const SET_ASIDE_GAP = 28;
const TOUCH = 44;

/**
 * The door to the Darkroom, in type only.
 *
 * The eyebrow, the line, the sentence and ENTER are one button. When the
 * member left the room within the last twelve hours the sentence becomes
 * where they were — "You left off in August 2018." — read from the place
 * the room keeps on disk, which knows the month without asking the
 * library. When anything is set aside, SET ASIDE stands on ENTER's line
 * and opens the shelf. It is a button of its own beside the door rather
 * than inside it, so VoiceOver can reach both; it is laid over the door's
 * last line, where ENTER's letters are measured to be.
 */
function DarkroomDoor() {
  const router = useRouter();
  const shelf = useSetAside();
  const [returnLine, setReturnLine] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      try {
        setReturnLine(placeLine());
      } catch {
        setReturnLine(null);
      }
    }, []),
  );

  // Where ENTER's box sits inside the door, and where the door sits inside
  // this block. SET ASIDE is placed only once both are known, so it never
  // draws a frame in the wrong place.
  const [enter, setEnter] = useState<LayoutRectangle | null>(null);
  const [doorAt, setDoorAt] = useState<{ x: number; y: number } | null>(null);
  let setAsideAt: { left: number; top: number } | null = null;
  if (enter && doorAt) {
    // Same type as ENTER, so the same height of letters; the 44 pt target
    // is centred on them, and so the two words share a line.
    const letters = Math.max(0, enter.height - ENTER_PAD * 2 - ENTER_RULE_GAP - 1);
    const target = Math.max(TOUCH, letters);
    setAsideAt = {
      left: doorAt.x + enter.x + enter.width + SET_ASIDE_GAP,
      top: doorAt.y + enter.y + ENTER_PAD - (target - letters) / 2,
    };
  }
  const n = shelf.length;

  return (
    <View style={styles.door}>
      <Pressable
        onLayout={(e) => setDoorAt({ x: e.nativeEvent.layout.x, y: e.nativeEvent.layout.y })}
        onPress={() => router.push("/darkroom")}
        style={({ pressed }) => pressed && styles.rowPressed}
        accessibilityRole="button"
        accessibilityLabel="The Darkroom"
        accessibilityHint="Your photographs, one at a time, from further back."
      >
        <Text style={styles.doorEyebrow} maxFontSizeMultiplier={DOOR_TYPE_CAP}>
          The Darkroom
        </Text>
        <Text style={styles.doorTitle} maxFontSizeMultiplier={DOOR_TYPE_CAP}>
          Your best photos aren’t new.
        </Text>
        <Text style={[styles.doorBody, returnLine ? styles.doorReturn : null]} maxFontSizeMultiplier={DOOR_TYPE_CAP}>
          {returnLine ?? "From further back than you’d think to look."}
        </Text>
        <View style={styles.enter} onLayout={(e) => setEnter(e.nativeEvent.layout)}>
          <Text style={styles.word} maxFontSizeMultiplier={DOOR_TYPE_CAP}>
            Enter
          </Text>
          <View style={[styles.enterRule, { width: ruleWidth("Enter") }]} />
        </View>
      </Pressable>
      {n > 0 && setAsideAt ? (
        <Pressable
          onPress={() => router.push({ pathname: "/darkroom", params: { mode: "set-aside" } })}
          style={({ pressed }) => [styles.setAside, setAsideAt, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Set aside, ${n} ${n === 1 ? "photograph" : "photographs"}`}
          accessibilityHint="Opens the photographs you set aside."
        >
          <Text style={[styles.word, styles.setAsideWord]} numberOfLines={1} maxFontSizeMultiplier={DOOR_TYPE_CAP}>
            Set aside
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Row({
  icon,
  title,
  body,
  onPress,
  primary = false,
  busy = false,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  body: string;
  onPress: () => void;
  primary?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={[styles.ring, primary && styles.ringPrimary]}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.inkSoft} />
        ) : (
          <Feather name={icon} size={18} color={primary ? colors.onShutter : colors.ink} />
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg },

  eyebrow: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
    marginTop: spacing.xl,
  },
  heading: { ...type.title, fontSize: 26, marginTop: spacing.sm },
  sub: { ...type.caption, marginTop: spacing.xs, lineHeight: 19 },

  rule: { height: 1, backgroundColor: colors.borderStrong, marginTop: spacing.xl },
  hairline: { height: 1, backgroundColor: colors.border },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md + 2,
  },
  rowPressed: { opacity: 0.6 },
  ring: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  ringPrimary: { backgroundColor: colors.shutter, borderColor: colors.shutter },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  rowBody: { fontSize: 12, color: colors.inkFaint, marginTop: 2 },

  door: { paddingTop: spacing.xl, paddingBottom: 20 },
  doorEyebrow: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  doorTitle: { fontFamily: type.serif, fontSize: 22, lineHeight: 29, color: colors.ink, marginTop: spacing.sm },
  doorBody: { fontSize: 13, lineHeight: 19, color: colors.inkSoft, marginTop: 6, maxWidth: 320 },
  // RETURN: where the member left off, in the serif's italic.
  doorReturn: { fontFamily: type.serif, fontStyle: "italic" },
  enter: { alignSelf: "flex-start", marginTop: spacing.lg, paddingVertical: ENTER_PAD },
  word: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2.4,
    marginRight: -2.4,
    textTransform: "uppercase",
    color: colors.ink,
  },
  enterRule: { height: 1, backgroundColor: colors.ink, opacity: 0.8, marginTop: ENTER_RULE_GAP, alignSelf: "center" },
  setAside: { position: "absolute", minHeight: TOUCH, justifyContent: "center" },
  setAsideWord: { color: colors.inkFaint },

  note: { ...type.caption, fontSize: 12, lineHeight: 18, color: colors.inkFaint, marginTop: spacing.xxl, paddingBottom: spacing.xl },
});
