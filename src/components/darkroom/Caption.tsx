import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { CAPTION_GAP, DATE_REACH, SIGNATURE_RULE, TOUCH_TARGET, WORD_REACH } from "./geometry";
import { useLook } from "./look";
import { signatureInks } from "./room";
import { RoomText } from "./Type";

/** Clear space between the date and the word at the right. */
const GAP = 12;
/** The dot of a print set aside, in the accent, and its distance from the word. */
const DOT = 5;
const DOT_GAP = 6;
const DOT_IN_MS = 140;
/** An unmeasured download breathes along the line this long each way, Skeleton's rhythm. */
const BREATH_MS = 900;

export interface CaptionWord {
  label: string;
  /** Set aside: ink with the dot. Otherwise faint. */
  on: boolean;
  /** Visible, but not to be pressed just now. */
  inert: boolean;
  hint?: string;
}

/**
 * The label hung under a plate, as a VINTAGE print sets one: the paper,
 * the signature line — the print's hairline rule, flush with the plate's
 * edges — and the caption beneath it, the way an archive labels a plate:
 * the date in tracked capitals, in the accent (a press on it is the
 * caption thread), the word at the right — SET ASIDE, or what a develop
 * state puts there — and under them, in the serif italic, how long ago.
 * Nothing is ever set on the photograph itself.
 *
 * When the date and the word will not both fit on one line at this type
 * size, the word goes to a line of its own under the second, at the right.
 * That is measured, not guessed: the date's natural width is read from an
 * unseen copy. Room is always kept for the dot, so setting a print aside
 * never moves a line.
 *
 * While a print comes down from iCloud the download is drawn along the
 * signature line itself, in the accent (the ink, where the accent would
 * not stand 3:1 off the line: `signatureInks`): out from the left as it
 * comes down when it can be measured, the whole line breathing when it
 * cannot (still, under Reduce Motion). One line under the photograph,
 * never two, and the caption keeps its words.
 *
 * The date and the word are each a 44 pt press (§11.6), reaching over the
 * space above and the line beneath without moving a letter (`DATE_REACH`
 * and `WORD_REACH` in geometry.ts). The italic line and the signature line
 * let a touch through to them, since nothing happens when either is
 * pressed.
 */
export function Caption({
  width,
  gap,
  label,
  line,
  progress,
  word,
  onDate,
  onWord,
  onHeight,
  testID,
}: {
  width: number;
  /** The paper between the photograph and the signature line (`signatureGap`). */
  gap: number;
  label: string;
  line: string;
  /** A download, drawn along the signature line: a fraction, or null for the breathing line. */
  progress?: { fraction: Animated.Value | null } | null;
  word: CaptionWord | null;
  onDate: () => void;
  onWord: () => void;
  /** The caption's measured height from the signature line down (`captionHeight`), the space under the line included. */
  onHeight?: (height: number) => void;
  testID?: string;
}) {
  const [labelWidth, setLabelWidth] = useState(0);
  const [wordWidth, setWordWidth] = useState(0);
  const wraps = word != null && labelWidth > 0 && wordWidth > 0 && labelWidth + GAP + DOT + DOT_GAP + wordWidth > width;

  const right = word ? (
    <CaptionRight
      word={word}
      onPress={onWord}
      onWidth={setWordWidth}
      style={wraps ? styles.ownRow : styles.sameRow}
      testID={testID ? `${testID}-word` : undefined}
    />
  ) : null;

  return (
    <View style={{ width, paddingTop: gap }} testID={testID}>
      <Signature width={width} progress={progress ?? null} testID={testID ? `${testID}-signature` : undefined} />
      <View
        style={styles.caption}
        onLayout={onHeight ? (e: LayoutChangeEvent) => onHeight(e.nativeEvent.layout.height) : undefined}
      >
        {/* The date's natural width, unseen, to decide whether the word fits beside it. */}
        <View style={styles.measure} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
          <View style={styles.measureRow}>
            <RoomText kind="dateLabel" maxFontSizeMultiplier={1.5} onLayout={(e) => setLabelWidth(e.nativeEvent.layout.width)}>
              {label}
            </RoomText>
          </View>
        </View>
        <View style={styles.row}>
          <Pressable onPress={onDate} style={styles.date} testID={testID ? `${testID}-date` : undefined}>
            <RoomText kind="dateLabel" numberOfLines={1} maxFontSizeMultiplier={1.5}>
              {label}
            </RoomText>
          </Pressable>
          {wraps ? null : right}
        </View>
        <RoomText
          kind="line"
          numberOfLines={2}
          maxFontSizeMultiplier={2}
          pointerEvents="none"
          style={styles.line}
          testID={testID ? `${testID}-line` : undefined}
        >
          {line}
        </RoomText>
        {wraps ? right : null}
      </View>
    </View>
  );
}

function CaptionRight({
  word,
  onPress,
  onWidth,
  style,
  testID,
}: {
  word: CaptionWord;
  onPress: () => void;
  onWidth: (width: number) => void;
  style: object;
  testID?: string;
}) {
  const look = useLook();
  const dot = useRef(new Animated.Value(word.on ? 1 : 0)).current;
  useEffect(() => {
    const anim = Animated.timing(dot, {
      toValue: word.on ? 1 : 0,
      duration: look.reduceMotion ? 0 : DOT_IN_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [word.on, look.reduceMotion, dot]);

  return (
    <Pressable
      onPress={onPress}
      disabled={word.inert}
      hitSlop={{ left: 14, right: 8 }}
      style={({ pressed }) => [styles.right, style, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: word.on, disabled: word.inert }}
      accessibilityHint={word.hint}
      testID={testID}
    >
      <Animated.View accessible={false} style={[styles.dot, { backgroundColor: look.room.accent, transform: [{ scale: dot }] }]} />
      <RoomText
        kind="small"
        tone={word.on ? "ink" : "faint"}
        maxFontSizeMultiplier={1.5}
        onLayout={(e) => onWidth(e.nativeEvent.layout.width)}
      >
        {word.label}
      </RoomText>
    </Pressable>
  );
}

/**
 * The signature line, `width` long, in the print's strong line (its
 * firm line under Increase Contrast). Never read aloud, and never in a
 * finger's way. A download is drawn along it, out from the left as it
 * comes down, or the whole line breathing while it cannot say how far;
 * in the accent, or the ink where the accent would not stand 3:1 off the
 * line, so Increase Contrast never makes how far fainter than that
 * (`signatureInks` in room.ts).
 */
function Signature({
  width,
  progress,
  testID,
}: {
  width: number;
  progress: { fraction: Animated.Value | null } | null;
  testID?: string;
}) {
  const look = useLook();
  const inks = signatureInks(look.room, look.contrast, progress != null);
  const fraction = progress?.fraction ?? null;
  const breathing = progress != null && fraction == null && !look.reduceMotion;
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!breathing) {
      breath.setValue(1);
      return;
    }
    const ease = Easing.inOut(Easing.quad);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 0.55, duration: BREATH_MS, easing: ease, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 1, duration: BREATH_MS, easing: ease, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathing, breath]);

  const drawn = !progress
    ? null
    : fraction
      ? {
          transform: [
            { translateX: fraction.interpolate({ inputRange: [0, 1], outputRange: [-width / 2, 0], extrapolate: "clamp" }) },
            { scaleX: fraction.interpolate({ inputRange: [0, 1], outputRange: [0.0001, 1], extrapolate: "clamp" }) },
          ],
        }
      : { opacity: breath };
  return (
    <View
      style={[styles.signature, { width, backgroundColor: inks.line }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      testID={testID}
    >
      {drawn ? <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: inks.drawn }, drawn]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  signature: { height: SIGNATURE_RULE },
  caption: { paddingTop: CAPTION_GAP },
  // Clipped to nothing, so the unseen copy never widens what scrolls.
  measure: { position: "absolute", top: 0, left: 0, width: 0, height: 0, overflow: "hidden", opacity: 0 },
  measureRow: { flexDirection: "row", width: 2000 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 14 },
  // Each press's reach is padding its negative margin takes back, so the
  // row and the caption measure as they would without it.
  date: {
    flexShrink: 1,
    minHeight: TOUCH_TARGET,
    justifyContent: "center",
    paddingTop: DATE_REACH.top,
    paddingBottom: DATE_REACH.bottom,
    marginTop: -DATE_REACH.top,
    marginBottom: -DATE_REACH.bottom,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: TOUCH_TARGET,
    paddingTop: WORD_REACH.top,
    paddingBottom: WORD_REACH.bottom,
    marginTop: -WORD_REACH.top,
    marginBottom: -WORD_REACH.bottom,
  },
  sameRow: { marginLeft: GAP },
  ownRow: { alignSelf: "flex-end", marginTop: 6 - WORD_REACH.top },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, marginRight: DOT_GAP },
  pressed: { opacity: 0.6 },
  line: { marginTop: 6 },
});
