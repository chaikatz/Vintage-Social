import { useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
import { JUMP_HALF_MS, type Loading } from "./chapter";
import { titleCardWords } from "./words";

/** A chapter not ready by now gets its title card… */
export const CARD_AFTER_MS = 250;
/** …which then stays at least this long, so it reads as a page and not a flash… */
export const CARD_HOLD_MS = 400;
/** …and gives way to the first print over this. */
export const CARD_FADE_MS = 240;

export interface ShownCard {
  eyebrow: string;
  title: string;
  year: boolean;
  /** When the waiting began, for the card's "Looking through your library…". */
  since: number;
}

/**
 * When the stage cuts, fades, or shows a title card (§3.8, §5.3).
 *
 * A chapter chosen in Contents is a cut. If it is not ready within a
 * quarter of a second its title card is shown (a cut too); once shown,
 * it stays at least 400 ms, then cross-fades into the first print over
 * 240 ms. A jump inside a chapter — a month, the caption thread, MORE
 * FROM, another roll — fades the stage out over 80 ms and back in over
 * 80 ms when the chapter is ready, with the same title card should it
 * take longer than a quarter of a second. Under Reduce Motion every fade
 * is a cut, and the card keeps its timing.
 *
 * `stage` is the opacity of whatever the stage shows (the pager, or a
 * word page); `card` the title card's, over it. Both on the native driver.
 */
export function useStageFades(loading: Loading | null, now: number, reduceMotion: boolean) {
  const stage = useRef(new Animated.Value(1)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const [card, setCard] = useState<ShownCard | null>(null);
  const shownAt = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fading = useRef<Animated.CompositeAnimation | null>(null);

  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };
  const after = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, Math.max(0, ms)));
  };
  const run = (anim: Animated.CompositeAnimation) => {
    fading.current?.stop();
    fading.current = anim;
    anim.start(() => {
      if (fading.current === anim) fading.current = null;
    });
  };
  const ease = Easing.out(Easing.quad);
  const to = (value: Animated.Value, toValue: number, duration: number) =>
    Animated.timing(value, { toValue, duration: reduceMotion ? 0 : duration, easing: ease, useNativeDriver: true });

  const since = loading?.since ?? null;
  const mode = loading?.mode ?? null;
  const jump = loading?.jump ?? false;
  const year = loading?.year ?? null;
  const month = loading?.month ?? 0;

  // Loading begins, or learns which chapter it is.
  useEffect(() => {
    if (since == null) return;
    const words = mode ? titleCardWords(mode, year, month, now) : null;
    if (shownAt.current != null) {
      // A card is already up: it carries on, with the new chapter's words.
      fading.current?.stop();
      cardOpacity.setValue(1);
      stage.setValue(0);
      if (words) setCard({ ...words, since });
      return;
    }
    if (jump) run(to(stage, 0, JUMP_HALF_MS));
    clearTimers();
    after(since + CARD_AFTER_MS - Date.now(), () => {
      if (!words) return;
      shownAt.current = Date.now();
      setCard({ ...words, since });
      fading.current?.stop();
      cardOpacity.setValue(1);
      stage.setValue(0);
    });
    return clearTimers;
    // The loading's own identity: when it began, and what it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [since, mode, year, month]);

  // Loading ends: back to the stage, through the card if one is up.
  useEffect(() => {
    if (since != null) return;
    clearTimers();
    const at = shownAt.current;
    if (at == null) {
      run(to(stage, 1, JUMP_HALF_MS));
      return;
    }
    after(at + CARD_HOLD_MS - Date.now(), () => {
      run(
        Animated.parallel([to(cardOpacity, 0, CARD_FADE_MS), to(stage, 1, CARD_FADE_MS)]),
      );
      after(reduceMotion ? 0 : CARD_FADE_MS, () => {
        shownAt.current = null;
        setCard(null);
      });
    });
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [since]);

  useEffect(
    () => () => {
      clearTimers();
      fading.current?.stop();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { stage, cardOpacity, card };
}
