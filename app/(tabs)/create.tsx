import React, { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { colors, spacing, type } from "@/theme";
import { ruleWidth } from "@/components/gate/rule";
import { pickFromLibrary, takeForCompose, type PickedParams } from "@/utils/pickForCompose";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";
import { darkroomAvailable, darkroomSource } from "@/darkroom/source";
import { readAccess } from "@/darkroom/access";

/**
 * Where a post begins.
 *
 * One photograph per post. Short videos are allowed but live in the same
 * feed and grid as everything else — there is no separate video surface.
 *
 * Set like the rest of VINTAGE: a serif line, then quiet rows ruled off
 * with hairlines. First the Darkroom — the camera roll, one print at a
 * time, from further back than anyone scrolls — because the best
 * photographs are rarely the newest. Then the ordinary ways in, one tap
 * away: the library, the camera, a short clip. Nothing here is a card, a
 * plate or a dark block; the Darkroom itself is the dark room.
 */
export default function Create() {
  const router = useRouter();
  // Reading the capture date and decoding the photograph take a moment;
  // without a guard a second tap in that moment opened the editor twice.
  const [opening, setOpening] = useState(false);
  // How far back the library goes — one question of the library, asked
  // only once access has already been given; never a prompt from here.
  const [since, setSince] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      const source = darkroomSource();
      if (!source) return;
      readAccess()
        .then(async (access) => {
          if (access !== "full" && access !== "limited") return null;
          return source.oldest();
        })
        .then((oldest) => live && oldest && setSince(new Date(oldest).getFullYear()))
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }, []),
  );

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
  const thisYear = new Date().getFullYear();

  return (
    <Screen padded={false}>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>New post</Text>
        <Text style={styles.heading}>Share a photograph.</Text>
        <Text style={styles.sub}>One picture at a time. You choose the film and the date stamp next.</Text>

        {darkroomAvailable() ? (
          <>
            <View style={styles.rule} />
            {/* The way in that leads with the old. */}
            <Pressable
              style={({ pressed }) => [styles.darkroom, pressed && styles.rowPressed]}
              onPress={() => router.push("/darkroom")}
              accessibilityRole="button"
              accessibilityLabel="Enter the Darkroom"
              accessibilityHint="Your photo library, one photograph at a time, from further back."
            >
              <Text style={[styles.eyebrow, styles.darkroomEyebrow]}>The Darkroom</Text>
              <Text style={styles.darkroomTitle}>Something worth remembering.</Text>
              <Text style={styles.darkroomBody}>
                {since != null && since < thisYear
                  ? `Your photographs go back to ${since}. This day in other years, a year at a time, or one from the back of the drawer.`
                  : "Your own photographs, one at a time, from further back than you would ever scroll."}
              </Text>
              <View style={styles.enter}>
                <Text style={styles.enterLabel}>Enter the Darkroom</Text>
                <View style={[styles.enterRule, { width: ruleWidth("Enter the Darkroom") }]} />
              </View>
            </Pressable>
          </>
        ) : null}

        <View style={styles.rule} />
        <Row
          icon="image"
          title="From your library"
          body="A photograph you've already taken"
          onPress={() => openWith(() => pickFromLibrary("photo"))}
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

        <View style={styles.spacer} />
        <Text style={styles.note}>Nothing here is ranked. A photograph is seen by the people who follow you, in the order it was posted.</Text>
      </View>
    </Screen>
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
  body: { flex: 1, paddingHorizontal: spacing.lg },

  eyebrow: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
    marginTop: spacing.xl,
  },
  eyebrowSpaced: { marginTop: spacing.lg, marginBottom: spacing.xs },
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

  darkroom: { paddingTop: spacing.lg, paddingBottom: spacing.md },
  darkroomEyebrow: { marginTop: 0 },
  darkroomTitle: { fontFamily: type.serif, fontSize: 22, lineHeight: 29, color: colors.ink, marginTop: spacing.sm },
  darkroomBody: { ...type.caption, fontSize: 13, lineHeight: 19, marginTop: spacing.xs, maxWidth: 320 },
  enter: { alignSelf: "flex-start", marginTop: spacing.lg, paddingVertical: spacing.xs },
  enterLabel: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2.4,
    marginRight: -2.4,
    textTransform: "uppercase",
    color: colors.ink,
  },
  enterRule: { height: 1, backgroundColor: colors.ink, opacity: 0.8, marginTop: 7, alignSelf: "center" },

  spacer: { flex: 1 },
  note: { ...type.caption, fontSize: 12, lineHeight: 18, color: colors.inkFaint, paddingBottom: spacing.xl },
});
