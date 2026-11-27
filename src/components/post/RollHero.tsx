import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { DateStamp } from "@/components/DateStamp";
import { DISSOLVE, PLATE_STALL_MS } from "@/components/darkroom/plateImage";
import { printSource } from "@/darkroom/printSource";
import type { Print } from "@/darkroom/types";
import { ageWords, frameRatio, photoRect, type Box } from "@/post/roll";
import { stampDate } from "@/post/stamp";
import { colors, type } from "@/theme";
import { signatureDate } from "@/utils/time";

/**
 * The selected photograph, large, on the paper, as the owner's mock has
 * it: in a fixed 4:5 frame 27 points in from either edge, at the shape
 * the editor will post it (4:5 at the tallest, 1.91:1 at the widest, as
 * compose previews it). A portrait fills the frame; a square or a
 * landscape stands in the middle of it, so nothing under the frame moves
 * when the selection does. On it, VINTAGE's date stamp, drawn by the same
 * `DateStamp` a post draws, in the same corner, reading the photograph's
 * own capture date (`stampDate`); none when the photograph has no date.
 *
 * The photograph comes in as the room's plates do: first a soft proof,
 * the same photograph asked of Photos at 48 points and scaled up, which
 * it answers at once; then the photograph at the frame's size dissolving
 * in over it. Both are kept by this view alone, never in the shared
 * image cache or on disk. Choosing another photograph makes a new proof,
 * but the full image is one view for every photograph: given the next
 * one's source, it stops the request for the last (a view taken off the
 * screen would let its request run on, an iCloud download and all, until
 * Photos answered), and its recycling key clears the last picture at
 * once, so it is never shown over the next one's proof. Quick taps along
 * the roll leave one full-size request running, not one for each. Let go
 * (`released`: the tab is not in front and the frame is out of sight, or
 * memory is short), both views come off the screen and their pictures
 * with them; on a memory warning in front (`heroReleased`), the full
 * image only, over its proof. Offline, a photograph whose full image has
 * not come after twelve seconds says IN ICLOUD in its corner, over its
 * proof.
 *
 * A tap on the photograph opens it in the editor, as POST does. VoiceOver
 * hears it as the selected photograph by its date and how long ago.
 */

const BAR_TYPE_CAP = 1.8;
/** The proof is this wide, scaled up to the photograph. */
const PROOF_WIDTH = 48;

export const RollHero = React.memo(function RollHero({
  print,
  frame,
  held,
  released,
  heroReleased,
  reduceMotion,
  focused,
  online,
  onPost,
}: {
  print: Print;
  /** The frame's box on the page (`previewFrame`). */
  frame: Box;
  held: boolean;
  released: boolean;
  heroReleased: boolean;
  reduceMotion: boolean;
  focused: boolean;
  online: boolean;
  onPost: () => void;
}) {
  const rect = photoRect(print, frame);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  // Decided once for the frame: the full image dissolves in over each proof, or under Reduce Motion simply appears.
  const [transition] = useState(() => (reduceMotion ? 0 : DISSOLVE));
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

  const stamp = stampDate(print);
  const inCloud = stalledId === print.id && !loaded && !online;
  const date = signatureDate(new Date(print.takenAt).toISOString());
  const age = inCloud ? "In iCloud" : ageWords(print.takenAt, Date.now());

  return (
    <View testID="post-hero" style={[styles.frame, { marginLeft: frame.left, width: frame.width, height: frame.height }]}>
      <Pressable
        testID="post-hero-photo"
        onPress={onPost}
        disabled={held}
        style={[styles.photo, rect]}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Selected: ${date}. ${age}.`}
        accessibilityHint="Opens it in the editor."
        accessibilityState={{ disabled: held }}
      >
        <Proof key={print.id} print={print} width={rect.width} released={released} />
        {released || heroReleased ? null : (
          <Image
            source={printSource(print.uri)}
            testID="post-hero-full"
            style={styles.fill}
            contentFit="cover"
            cachePolicy="none"
            allowDownscaling={false}
            priority="normal"
            recyclingKey={print.id}
            transition={transition}
            onLoad={() => setLoadedId(print.id)}
            accessibilityIgnoresInvertColors
          />
        )}
        {stamp ? <DateStamp iso={stamp} /> : null}
        {inCloud ? (
          <View style={styles.cloud} pointerEvents="none">
            <Text testID="post-hero-cloud" style={styles.cloudWord} maxFontSizeMultiplier={BAR_TYPE_CAP}>
              In iCloud
            </Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
});

/**
 * The soft proof, made afresh for each photograph: Photos answers it at
 * once, so the frame is never empty while the full image comes.
 */
function Proof({ print, width, released }: { print: Print; width: number; released: boolean }) {
  const r = frameRatio(print);
  return (
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
  );
}

/** What stands behind a photograph until its pixels come: the roll's own well. */
const WELL = colors.paperSunken;
/** The corner's note sits on the photograph in the library picker's own scrim. */
const SCRIM = "rgba(28, 25, 21, 0.55)";

const styles = StyleSheet.create({
  frame: { overflow: "hidden" },
  photo: { position: "absolute", overflow: "hidden", backgroundColor: WELL },
  proofSlot: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fill: { ...StyleSheet.absoluteFillObject },
  cloud: { position: "absolute", left: 12, bottom: 12, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: SCRIM },
  cloudWord: { fontFamily: type.mono, fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase", color: colors.onPhoto },
});
