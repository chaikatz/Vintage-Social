import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
import { setStatusBarHidden } from "expo-status-bar";

const CHROME_MS = 180;

/**
 * The top inset to lay the room out by. On an iPhone with a Home button
 * the status bar is the whole of the top inset, so hiding it with the
 * words takes 20 pt from above the running head and gives it to the
 * stage, and every plate would move (§3.4: nothing moves). So the inset
 * seen while the words were showing is kept while they are hidden, and
 * until the status bar is back and the inset with it.
 */
export function steadyTop(kept: number, inset: number, hidden: boolean): number {
  return hidden || inset <= 0 ? kept : inset;
}

/**
 * The room's words, hidden and shown by a tap on the plate (§3.7): the
 * running head, the captions and DEVELOP fade to nothing together over
 * 180 ms, and the status bar goes with them. The choice holds across page
 * turns and is undone when the room comes back into focus. It is never
 * applied while VoiceOver is running — the words are how VoiceOver gets
 * about — and while a develop state is showing the words stay, because
 * they are what the state says. `top` is the safe-area inset to lay the
 * room out by, held still while the status bar is away (`steadyTop`).
 */
export function useChrome(opts: { screenReader: boolean; locked: boolean; reduceMotion: boolean; top: number }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [hidden, setHidden] = useState(false);
  const hiddenNow = useRef(false);
  const top = useRef(opts.top);
  top.current = steadyTop(top.current, opts.top, hiddenNow.current);
  const reduce = useRef(opts.reduceMotion);
  reduce.current = opts.reduceMotion;
  // Read when tapped, so the tap's handler never changes and the pages need not redraw.
  const held = useRef(false);
  held.current = opts.screenReader || opts.locked;

  const apply = useCallback(
    (hide: boolean) => {
      hiddenNow.current = hide;
      setHidden(hide);
      Animated.timing(opacity, {
        toValue: hide ? 0 : 1,
        duration: reduce.current ? 0 : CHROME_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      setStatusBarHidden(hide, "fade");
    },
    [opacity],
  );

  const toggle = useCallback(() => {
    if (held.current) return;
    apply(!hiddenNow.current);
  }, [apply]);

  /** Back into focus: the words come back. */
  const reset = useCallback(() => {
    if (hiddenNow.current) apply(false);
    else opacity.setValue(1);
  }, [apply, opacity]);

  // VoiceOver turned on while the words were hidden: they come back.
  useEffect(() => {
    if (opts.screenReader && hidden) apply(false);
  }, [opts.screenReader, hidden, apply]);

  return { opacity, hidden, toggle, reset, top: top.current };
}
