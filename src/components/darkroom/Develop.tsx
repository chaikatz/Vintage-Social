import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { ruleWidth } from "@/components/gate/rule";
import { useLook } from "./look";
import { Word } from "./Word";
import { DEVELOP_HINT, type BottomAct, type StateWords } from "./words";

/** The rule draws out under the word as a print develops, and back as the room returns. */
const DRAW_MS = 220;
const UNDRAW_MS = 180;

/**
 * DEVELOP: the room's one ruled word, fixed under the stage and centred,
 * the bridge from the dark room to the editor. Whatever a develop state
 * puts in its place (§6.3) is set here, in the same place and the same
 * type, so the layout never moves; only the word changes.
 *
 * Its opacity is the pager's scroll position on the native driver — full
 * up to the last print, nothing on the end page. It cannot be pressed
 * while a page is being turned, by a swipe or a tap. While a print
 * develops its rule draws out from 26 pt to the width of the letters
 * (not under Reduce Motion), and draws back when the room is in front
 * again. Dimmed, it says why to VoiceOver.
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
  opacity: Animated.Value | Animated.AnimatedInterpolation<number>;
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
          maxFontSizeMultiplier={1.5}
          minHeight={48}
          paddingHorizontal={24}
          style={styles.word}
          testID="darkroom-develop"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: { alignItems: "center", justifyContent: "flex-end", minHeight: 48 },
  slot: { alignItems: "center" },
  word: { minWidth: 116 },
});
