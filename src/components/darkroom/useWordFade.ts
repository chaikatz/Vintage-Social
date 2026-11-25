import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Animated, Easing } from "react-native";
import { fadeStart, WORD_FADE_MS, wordOpacity } from "./wordFade";

const kit = {
  add: (a: Animated.Value, b: Animated.Value) => Animated.add<number>(a, b),
  multiply: (a: Animated.Value, b: Animated.AnimatedInterpolation<number>) => Animated.multiply<number>(a, b),
};

/**
 * The opacity of the room's word, on the native driver: one graph for as
 * long as the room is open, built again only if the page width changes,
 * and never handed over to another value (`wordFade.ts` says why that is
 * what kept losing the word). `shown` — a photograph's page settled in
 * front, no title card — fades it in and out over WORD_FADE_MS, a cut
 * under Reduce Motion; the pager's scroll fades it toward the end page
 * from the chapter's last photograph, `count` of them, as it always has.
 */
export function useWordFade(
  scrollX: Animated.Value,
  count: number,
  width: number,
  shown: boolean,
  reduceMotion: boolean,
): Animated.AnimatedInterpolation<number> {
  const on = useRef(new Animated.Value(shown ? 1 : 0)).current;
  const start = useRef(new Animated.Value(fadeStart(count, width))).current;
  const opacity = useMemo(() => wordOpacity(kit, scrollX, on, start, width), [scrollX, on, start, width]);

  // The fade begins at the last photograph, wherever prints dealt on or taken out have put it.
  useLayoutEffect(() => {
    start.setValue(fadeStart(count, width));
  }, [start, count, width]);

  useEffect(() => {
    const fade = Animated.timing(on, {
      toValue: shown ? 1 : 0,
      duration: reduceMotion ? 0 : WORD_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [on, shown, reduceMotion]);

  return opacity;
}
