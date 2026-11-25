import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { ruleWidth } from "@/components/gate/rule";
import { DEVELOP_HEIGHT } from "./geometry";
import { useLook } from "./look";
import { Word } from "./Word";
import { DEVELOP_HINT, WORD_MAX_SCALE, type BottomAct, type StateWords } from "./words";

/** The rule draws out under the word as a print develops, and back as the room returns. */
const DRAW_MS = 220;
const UNDRAW_MS = 180;
/** The word's letters stand this far into the top of its block. */
const WORD_TOP = 6;

/**
 * POST: the room's one ruled word, the photograph's action, set right
 * under the photograph's area and over the glide strip, centred: the
 * bridge from the dark room to the editor. Whatever a develop state puts
 * in its place (§6.3) is set here, in the same place and the same type,
 * in a block of one height, so the layout never moves; only the word
 * changes. (The code still calls it Develop, as it calls the room the
 * Darkroom; only what a member reads or hears says POST.)
 *
 * Its opacity is handed in (`useWordFade`): whole on every photograph's
 * page settled in front, fading with the pager's scroll toward the end
 * page, and gone on the end page, the waiting card and under a title card.
 * It cannot be pressed while a page is being turned, by a swipe or a tap.
 * While a print develops its rule draws out from 26 pt to the width of
 * the letters (not under Reduce Motion), and draws back when the room is
 * in front again. Dimmed, it says why to VoiceOver.
 */
export function Develop({
  words,
  opacity,
  interactive,
  dragging,
  drawing,
  onPress,
}: {
  words: StateWords["bottom"];
  /** The same node on every render (`useWordFade`): never swapped for another, which lost the word in build 58. */
  opacity: Animated.AnimatedInterpolation<number>;
  interactive: boolean;
  dragging: boolean;
  drawing: boolean;
  onPress: (act: BottomAct) => void;
}) {
  const look = useLook();
  const scale = useRef(new Animated.Value(1)).current;
  const [labelWidth, setLabelWidth] = useState(0);
  const base = ruleWidth(words.label);

  useEffect(() => {
    const target = drawing && !look.reduceMotion && labelWidth > 0 ? labelWidth / base : 1;
    const anim = Animated.timing(scale, {
      toValue: target,
      duration: look.reduceMotion ? 0 : drawing ? DRAW_MS : UNDRAW_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [drawing, labelWidth, base, look.reduceMotion, scale]);

  const inert = words.act === "none" || dragging;
  return (
    <Animated.View style={[styles.block, { opacity }]} pointerEvents={interactive ? "box-none" : "none"}>
      <View style={styles.slot}>
        <Word
          label={words.label}
          primary
          ruled={words.ruled}
          disabled={inert && !words.dim}
          dim={words.dim}
          busy={words.busy}
          ruleScale={scale}
          onLabelWidth={setLabelWidth}
          onPress={() => onPress(words.act)}
          accessibilityHint={words.reason ?? (words.act === "develop" ? DEVELOP_HINT : undefined)}
          maxFontSizeMultiplier={WORD_MAX_SCALE}
          minHeight={DEVELOP_HEIGHT}
          paddingHorizontal={24}
          style={styles.word}
          testID="darkroom-develop"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: { alignItems: "center", justifyContent: "center", height: DEVELOP_HEIGHT },
  slot: { alignItems: "center" },
  // The letters near the top of their 48-point press, so the word sits closer to the caption above than to the
  // strip below, and reads as the photograph's; the press keeps its height, and reaches down toward the strip.
  word: { minWidth: 116, justifyContent: "flex-start", paddingTop: WORD_TOP },
});
