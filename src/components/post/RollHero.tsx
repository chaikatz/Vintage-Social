import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import Feather from "@expo/vector-icons/Feather";
import { DISSOLVE, PLATE_STALL_MS } from "@/components/darkroom/plateImage";
import { printSource } from "@/darkroom/printSource";
import type { Print } from "@/darkroom/types";
import { ageWords, frameRatio, heroFrame, heroMetrics } from "@/post/roll";
import { colors, spacing, type } from "@/theme";
import { signatureDate } from "@/utils/time";

/**
 * The selected photograph, large, on the camera's dark mount: in the
 * frame the editor will give it (4:5 at the tallest, 1.91:1 at the
 * widest, as compose previews it), with the print's signature line under
 * it as the Memory Room writes one — the date in tracked capitals, how
 * long ago in the serif — and POST beside it, the page's one primary
 * action, in the light of the camera on its dark.
 *
 * The photograph comes in as the room's plates do: first a soft proof,
 * the same photograph asked of Photos at 48 points and scaled up, which
 * it answers at once; then the photograph at the frame's size dissolving
 * in over it. Both are kept by this view alone, never in the shared
 * image cache or on disk. Choosing another photograph makes a new view,
 * so the last one's picture goes with it and its request is stopped. Let
 * go (`released`: the tab is not in front and the mount is out of sight,
 * or memory is short), both views come off the screen and their pictures
 * with them; on a memory warning in front (`heroReleased`), the full
 * image only, over its proof.
 * Offline, a photograph whose full image has not come after twelve
 * seconds says it is in iCloud, under its proof.
 *
 * A tap on the photograph posts it, as POST does; VoiceOver hears POST
 * alone, with the date and age read as one line before it.
 */

const TYPE_CAP = 2.4;
const BAR_TYPE_CAP = 1.8;
/** The proof is this wide, scaled up to the frame. */
const PROOF_WIDTH = 48;
/** POST's reach past its edges: the strip's own margin above and below, so it stays on the mount. */
const POST_SLOP = { top: 8, bottom: 8, left: 6, right: 6 };

export const RollHero = React.memo(function RollHero({
  print,
  W,
  H,
  large,
  busy,
  held,
  released,
  heroReleased,
  reduceMotion,
  focused,
  online,
  now,
  onPost,
  onLayout,
}: {
  print: Print;
  W: number;
  H: number;
  /** The text is set large: the strip stands under the photograph as a column. */
  large: boolean;
  busy: boolean;
  held: boolean;
  released: boolean;
  heroReleased: boolean;
  reduceMotion: boolean;
  focused: boolean;
  online: boolean;
  now: number;
  onPost: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const { strip, button } = heroMetrics(W);
  const frame = heroFrame(print, W, H);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [stalledId, setStalledId] = useState<string | null>(null);
  const loaded = loadedId === print.id;
  // A full image let go has to come again, and may stall as any other.
  useEffect(() => {
    if (released || heroReleased) setLoadedId(null);
  }, [released, heroReleased]);

  // A photograph that has not come in twelve seconds, while the tab is in front.
  useEffect(() => {
    if (!focused || released || heroReleased || loaded) return;
    const timer = setTimeout(() => setStalledId(print.id), PLATE_STALL_MS);
    return () => clearTimeout(timer);
  }, [focused, released, heroReleased, loaded, print.id]);

  const iso = new Date(print.takenAt).toISOString();
  const date = signatureDate(iso);
  const age = stalledId === print.id && !loaded && !online ? "In iCloud" : ageWords(print.takenAt, now);

  const words = (
    <View style={large ? styles.wordsLarge : styles.words} accessible accessibilityLabel={`Selected: ${date}. ${age}.`}>
      <Text testID="post-hero-date" style={styles.date} maxFontSizeMultiplier={BAR_TYPE_CAP}>
        {date.toUpperCase()}
      </Text>
      <Text testID="post-hero-age" style={styles.age} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
        {age}
      </Text>
    </View>
  );

  const post = (
    <Pressable
      testID="post-post"
      onPress={onPost}
      disabled={held}
      // To 56 points tall within the strip, and a little wider: the page's one primary action, under the thumb.
      hitSlop={POST_SLOP}
      style={({ pressed }) => [styles.post, { height: large ? undefined : button }, large && styles.postLarge, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Post"
      accessibilityHint="Opens the selected photograph in the editor. Nothing is shared until you post."
      accessibilityState={{ busy, disabled: held }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.camera} />
      ) : (
        <>
          <Text style={styles.postWord} maxFontSizeMultiplier={BAR_TYPE_CAP}>
            Post
          </Text>
          <Feather name="arrow-right" size={14} color={colors.camera} />
        </>
      )}
    </Pressable>
  );

  return (
    <View testID="post-hero" style={[styles.mount, { height: large ? undefined : H }]} onLayout={onLayout}>
      <View style={{ height: large ? H - strip : H }}>
        <Pressable
          testID="post-hero-photo"
          onPress={onPost}
          disabled={held}
          style={[styles.frame, frame]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Picture key={print.id} print={print} width={frame.width} released={released} heroReleased={heroReleased} reduceMotion={reduceMotion} onLoad={setLoadedId} />
        </Pressable>
      </View>
      {large ? (
        <View style={styles.stripLarge}>
          {words}
          {post}
        </View>
      ) : (
        <View style={[styles.strip, { height: strip }]}>
          {words}
          {post}
        </View>
      )}
    </View>
  );
});

/** The proof, then the photograph over it. Made afresh for each photograph, so its transition is decided once. */
function Picture({
  print,
  width,
  released,
  heroReleased,
  reduceMotion,
  onLoad,
}: {
  print: Print;
  width: number;
  released: boolean;
  heroReleased: boolean;
  reduceMotion: boolean;
  onLoad: (id: string) => void;
}) {
  const [transition] = useState(() => (reduceMotion ? 0 : DISSOLVE));
  const r = frameRatio(print);
  return (
    <>
      <View style={styles.proofSlot} pointerEvents="none">
        <View style={{ width: PROOF_WIDTH, height: PROOF_WIDTH / r, transform: [{ scale: width / PROOF_WIDTH }] }}>
          {released ? null : (
            <Image
              source={printSource(print.uri)}
              style={styles.fill}
              contentFit="cover"
              cachePolicy="none"
              transition={0}
              accessibilityIgnoresInvertColors
            />
          )}
        </View>
      </View>
      {released || heroReleased ? null : (
        <Image
          source={printSource(print.uri)}
          style={styles.fill}
          contentFit="cover"
          cachePolicy="none"
          allowDownscaling={false}
          priority="normal"
          recyclingKey={print.id}
          transition={transition}
          onLoad={() => onLoad(print.id)}
          accessibilityIgnoresInvertColors
        />
      )}
    </>
  );
}

const caps = { textTransform: "uppercase" as const };

const styles = StyleSheet.create({
  mount: { backgroundColor: colors.camera, overflow: "hidden" },
  frame: { position: "absolute", overflow: "hidden" },
  proofSlot: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fill: { ...StyleSheet.absoluteFillObject },
  strip: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  stripLarge: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  words: { flex: 1, minWidth: 0 },
  wordsLarge: {},
  date: { fontFamily: type.mono, fontSize: 10, lineHeight: 12, letterSpacing: 2.2, color: colors.onCamera, opacity: 0.85 },
  age: { fontFamily: type.serif, fontSize: 13, lineHeight: 16, color: colors.onCamera, opacity: 0.72, marginTop: 3 },
  post: {
    minWidth: 96,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.onCamera,
  },
  postLarge: { minHeight: 48, marginTop: spacing.sm, alignSelf: "stretch" },
  postWord: { fontFamily: type.mono, fontSize: 11, letterSpacing: 2.4, ...caps, color: colors.camera },
  pressed: { opacity: 0.75 },
});
