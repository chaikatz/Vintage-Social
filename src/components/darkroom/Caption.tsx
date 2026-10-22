import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { CAPTION_GAP } from "./geometry";
import { useLook } from "./look";
import { room } from "./room";
import { RoomText } from "./Type";

/** Clear space between the date and the word at the right. */
const GAP = 12;
/** The gold dot of a print set aside, and its distance from the word. */
const DOT = 5;
const DOT_GAP = 6;
const DOT_IN_MS = 140;
/** An unmeasured download's rule breathes this long each way, Skeleton's rhythm. */
const BREATH_MS = 900;

export interface CaptionWord {
  label: string;
  /** Set aside: ink with the gold dot. Otherwise faint. */
  on: boolean;
  /** Visible, but not to be pressed just now. */
  inert: boolean;
  hint?: string;
}

/**
 * The caption hung under a plate, flush with its edges, the way an
 * archive labels a plate: the date in tracked gold capitals (a press on
 * it is the caption thread), the word at the right — SET ASIDE, or what
 * a develop state puts there — and under them, in the serif italic, how
 * long ago. Nothing is ever set on the photograph itself.
 *
 * When the date and the word will not both fit on one line at this type
 * size, the word goes to a line of its own under the second, at the right.
 * That is measured, not guessed: the date's natural width is read from an
 * unseen copy. Room is always kept for the dot, so setting a print aside
 * never moves a line.
 *
 * While a print comes down from iCloud the second line is a 1 pt gold
 * rule across the caption: growing with the download when it can be
 * measured, breathing when it cannot (still, under Reduce Motion).
 */
export function Caption({
  width,
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
  label: string;
  line: string;
  /** The download's rule in place of the line: a fraction, or null for the breathing one. */
  progress?: { fraction: Animated.Value | null } | null;
  word: CaptionWord | null;
  onDate: () => void;
  onWord: () => void;
  /** The caption's measured height, the gap above it included. */
  onHeight?: (height: number) => void;
  testID?: string;
}) {
  const look = useLook();
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
    <View
      style={[styles.caption, { width }]}
      onLayout={onHeight ? (e: LayoutChangeEvent) => onHeight(e.nativeEvent.layout.height) : undefined}
      testID={testID}
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
        <Pressable onPress={onDate} hitSlop={{ top: 15, bottom: 15 }} style={styles.date} testID={testID ? `${testID}-date` : undefined}>
          <RoomText kind="dateLabel" numberOfLines={1} maxFontSizeMultiplier={1.5}>
            {label}
          </RoomText>
        </Pressable>
        {wraps ? null : right}
      </View>
      {progress ? (
        <ProgressRule fraction={progress.fraction} width={width} still={look.reduceMotion} />
      ) : (
        <RoomText kind="line" numberOfLines={2} maxFontSizeMultiplier={2} style={styles.line}>
          {line}
        </RoomText>
      )}
      {wraps ? right : null}
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
      hitSlop={{ top: 14, bottom: 14, left: 14, right: 8 }}
      style={({ pressed }) => [styles.right, style, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: word.on, disabled: word.inert }}
      accessibilityHint={word.hint}
      testID={testID}
    >
      <Animated.View accessible={false} style={[styles.dot, { transform: [{ scale: dot }] }]} />
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

/** The download's rule: drawn out from the left as it comes down, or breathing while it cannot say how far. */
function ProgressRule({ fraction, width, still }: { fraction: Animated.Value | null; width: number; still: boolean }) {
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (fraction || still) {
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
  }, [fraction, still, breath]);

  const grow = fraction
    ? {
        transform: [
          { translateX: fraction.interpolate({ inputRange: [0, 1], outputRange: [-width / 2, 0], extrapolate: "clamp" }) },
          { scaleX: fraction.interpolate({ inputRange: [0, 1], outputRange: [0.0001, 1], extrapolate: "clamp" }) },
        ],
      }
    : { opacity: breath };
  return (
    <View style={styles.progressSlot} accessible={false}>
      <Animated.View style={[styles.progress, { width }, grow]} />
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { paddingTop: CAPTION_GAP },
  // Clipped to nothing, so the unseen copy never widens what scrolls.
  measure: { position: "absolute", top: 0, left: 0, width: 0, height: 0, overflow: "hidden", opacity: 0 },
  measureRow: { flexDirection: "row", width: 2000 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 14 },
  date: { flexShrink: 1 },
  right: { flexDirection: "row", alignItems: "center" },
  sameRow: { marginLeft: GAP },
  ownRow: { alignSelf: "flex-end", marginTop: 6 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: room.gold, marginRight: DOT_GAP },
  pressed: { opacity: 0.6 },
  line: { marginTop: 6 },
  progressSlot: { marginTop: 6, height: 20, justifyContent: "center", overflow: "hidden" },
  progress: { height: 1, backgroundColor: room.gold },
});
