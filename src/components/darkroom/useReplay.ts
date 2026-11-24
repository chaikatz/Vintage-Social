import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing } from "react-native";
import { markSeen, SEEN_AFTER_MS } from "@/darkroom/history";
import type { DarkroomMode, DayReach, Print } from "@/darkroom/types";
import { stayAwake } from "./awake";
import {
  dwellAt,
  HOLD_EASE_MS,
  leaderAt,
  PACE,
  playRestarts,
  READY_WAIT_MS,
  REST_MS,
  replayInit,
  replayPlan,
  replayReducer,
  trayRange,
  type ReducerContext,
  type ReplayEvent,
  type ReplayPlan,
  type ReplaySource,
  type ReplayState,
} from "./replay";
import { replayCardSaid } from "./words";

/**
 * The replay's clock, and everything that follows the photograph in front.
 *
 * The states are `replayReducer`'s (replay.ts), which never reads the
 * clock; this keeps the time. One timer at a time: while playing, `due`
 * once the photograph in front has stayed its dwell, counted from when it
 * was actually shown, so a slow photograph never shortens the next and
 * drift never adds up; `cardOver` after a title card's second; and
 * `waitedOut` after `READY_WAIT_MS` waiting on an image that has not come.
 *
 * It owns the leader, how far the replay has come as one length for the
 * whole of it (0 to 1): a linear sweep through the photograph's share of
 * it while it plays, still on a card or a wait, eased back onto the
 * photograph's place when held, and drawn whole at the end; stepped, not
 * swept, under Reduce Motion. A finger gliding the strip draws it itself
 * (`glide`), so it follows the strip, frame by frame.
 *
 * And the rest: the photographs the gate holds ready (`tray`), re-centred
 * once the member has come to rest; which have drawn (`ready`); the
 * screen kept awake while it plays; holding when the app leaves the
 * foreground; marking a photograph seen once it has been held in front,
 * drawn, as long as the room takes (not on the shelf); and VoiceOver told
 * of each card and of the end, never of each photograph.
 */
export interface ReplayOptions {
  prints: readonly Print[];
  start: number;
  mode: DarkroomMode;
  reach: DayReach | null;
  now: number;
  online: boolean;
  /** Prints the room knows are gone. */
  missing: ReadonlySet<string>;
  reduceMotion: boolean;
  screenReader: boolean;
  /** Said as the replay ends: the chapter's end title. */
  endSaid: string;
  /** Photos said a photograph is gone: the room hears of it too. */
  onImageGone: (id: string) => void;
}

export function useReplay(o: ReplayOptions) {
  const { prints, mode, reach, now, reduceMotion } = o;
  const n = prints.length;
  const plan: ReplayPlan = useMemo(() => replayPlan(prints, { mode, reach, now, reduceMotion }), [prints, mode, reach, now, reduceMotion]);
  const indexOf = useMemo(() => new Map(prints.map((p, i) => [p.id, i])), [prints]);

  /** Shown in full, or failed: either way ready, as nothing better is coming. */
  const readyIds = useRef(new Set<string>());
  /** Shown in full. */
  const drewIds = useRef(new Set<string>());
  /** Photos said these are gone. */
  const goneIds = useRef(new Set<string>());

  const latest = useRef(o);
  latest.current = o;
  const ctx = useRef<ReducerContext>(null as unknown as ReducerContext);
  ctx.current = {
    n,
    gone: (i) => {
      const id = prints[i]?.id;
      return id == null || goneIds.current.has(id) || latest.current.missing.has(id);
    },
    ready: (i) => {
      const id = prints[i]?.id;
      return id != null && readyIds.current.has(id);
    },
    card: (i) => plan.card[i] != null,
    online: o.online,
  };
  const reducer = useCallback((s: ReplayState, e: ReplayEvent) => replayReducer(s, e, ctx.current), []);
  const [state, dispatch] = useReducer(reducer, o.start, (start: number) => {
    const opened = replayInit(start, ctx.current);
    // The app left the foreground while the room faded out: it opens held, as it would have been.
    return AppState.currentState === "active" ? opened : replayReducer(opened, { type: "away" }, ctx.current);
  });
  const live = useRef(state);
  live.current = state;

  // --- the clock -------------------------------------------------------------

  /** When what the gate shows last changed. */
  const shownAt = useRef(Date.now());
  useEffect(() => {
    shownAt.current = Date.now();
  }, [state.shown]);

  useEffect(() => {
    if (state.phase !== "playing") return;
    let ms: number;
    let event: ReplayEvent;
    if (state.wait === "card") {
      ms = PACE.card - (Date.now() - shownAt.current);
      event = { type: "cardOver" };
    } else if (state.wait === "image") {
      ms = READY_WAIT_MS;
      event = { type: "waitedOut" };
    } else {
      ms = dwellAt(plan, state.index, state.fresh) - (Date.now() - shownAt.current);
      event = { type: "due" };
    }
    const t = setTimeout(() => dispatch(event), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [state.phase, state.wait, state.shown, state.index, state.fresh, plan]);

  // Held, the photographs kept ready move to the one in front once nothing has changed for a moment.
  useEffect(() => {
    if (state.phase === "playing" || state.centre === state.index) return;
    const t = setTimeout(() => dispatch({ type: "rest" }), REST_MS);
    return () => clearTimeout(t);
  }, [state.phase, state.index, state.centre]);

  // --- the leader ------------------------------------------------------------

  const leader = useRef(new Animated.Value(n > 0 ? o.start / n : 0)).current;
  useEffect(() => {
    // While a finger glides the strip, the glide draws the leader (`glide`).
    if (n === 0 || state.scrubbing) return;
    const i = state.index;
    const to = (value: number, duration: number, easing: (t: number) => number) => {
      if (reduceMotion || duration <= 0) {
        leader.setValue(value);
        return undefined;
      }
      const a = Animated.timing(leader, { toValue: value, duration, easing, useNativeDriver: true });
      a.start();
      return () => a.stop();
    };
    if (state.phase === "ended") return to(1, HOLD_EASE_MS, Easing.out(Easing.quad));
    if (state.phase === "held") return to(i / n, HOLD_EASE_MS, Easing.out(Easing.quad));
    if (state.wait != null) {
      leader.stopAnimation();
      return;
    }
    leader.setValue(i / n);
    // Under Reduce Motion the leader steps onto each photograph's place, and stays there: it never sweeps ahead.
    if (reduceMotion) return;
    const left = dwellAt(plan, i, state.fresh) - (Date.now() - shownAt.current);
    return to((i + 1) / n, Math.max(0, left), Easing.linear);
  }, [state.phase, state.wait, state.shown, state.index, state.scrubbing, state.fresh, plan, n, reduceMotion, leader]);

  /**
   * A finger's glide of the strip, at scroll offset `x` (the strip says so
   * only while a finger drives it): the leader follows it, frame by frame,
   * and a photograph at a time under Reduce Motion.
   */
  const glide = useCallback((x: number) => leader.setValue(leaderAt(x, n, latest.current.reduceMotion)), [leader, n]);

  // --- away, awake, said, seen -------------------------------------------------

  useEffect(() => {
    // Not only the background: inactive too (Control Center, a call, the app switcher), as the room's own putAway.
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") dispatch({ type: "away" });
    });
    // Gone between the first draw and listening: held all the same.
    if (AppState.currentState !== "active") dispatch({ type: "away" });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    stayAwake(state.phase === "playing");
  }, [state.phase]);
  useEffect(() => () => stayAwake(false), []);

  useEffect(() => {
    if (!o.screenReader || state.phase !== "playing" || state.wait !== "card") return;
    const card = plan.card[state.index];
    if (card) AccessibilityInfo.announceForAccessibility(replayCardSaid(card));
    // Each card is said once, as it comes up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.wait, state.shown]);

  useEffect(() => {
    if (o.screenReader && state.phase === "ended") AccessibilityInfo.announceForAccessibility(latest.current.endSaid);
    // Said once, as it ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  /** Bumped when the photograph in front draws in full, for the look that marks it seen. */
  const [drawTick, setDrawTick] = useState(0);
  const currentId = prints[state.index]?.id ?? null;
  useEffect(() => {
    if (state.phase === "playing" || state.scrubbing || mode === "set-aside" || currentId == null) return;
    if (!drewIds.current.has(currentId)) return;
    // Held in front, drawn, as long as the room takes to call a print seen. A glimpse while playing is not a look.
    const t = setTimeout(() => markSeen(currentId), SEEN_AFTER_MS);
    return () => clearTimeout(t);
  }, [state.phase, state.scrubbing, currentId, mode, drawTick]);

  // --- the photographs held ready ------------------------------------------------

  const [first, last] = trayRange(state.centre, n, state.phase === "playing");
  const tray = useMemo(() => prints.slice(first, last + 1), [prints, first, last]);

  /** A photograph in the gate has drawn (`ok`), or failed: either way it is ready. */
  const drawn = useCallback(
    (id: string, ok: boolean) => {
      readyIds.current.add(id);
      if (ok) drewIds.current.add(id);
      const i = indexOf.get(id);
      if (i == null) return;
      dispatch({ type: "drawn", index: i });
      if (ok && i === live.current.index) setDrawTick((t) => t + 1);
    },
    [indexOf],
  );

  /** A photograph has left the gate, and its bitmap with it: it is no longer ready. */
  const forget = useCallback((id: string) => {
    readyIds.current.delete(id);
    drewIds.current.delete(id);
  }, []);

  /** Photos said a photograph is gone: it is passed over from now on. */
  const gone = useCallback(
    (id: string) => {
      goneIds.current.add(id);
      readyIds.current.add(id);
      latest.current.onImageGone(id);
      const i = indexOf.get(id);
      if (i != null) dispatch({ type: "gone", index: i });
    },
    [indexOf],
  );

  // --- what the member does ------------------------------------------------------

  const toggle = useCallback(() => dispatch({ type: "toggle" }), []);
  const play = useCallback(() => dispatch({ type: "play" }), []);
  const hold = useCallback(() => dispatch({ type: "hold" }), []);
  const away = useCallback(() => dispatch({ type: "away" }), []);
  const step = useCallback((by: -1 | 1, source: "tap" | "vo") => dispatch({ type: "step", by, source }), []);
  /** Held, and straight to a photograph: a frame tapped on the strip. */
  const goTo = useCallback((index: number) => dispatch({ type: "scrubTo", index, by: "tap" }), []);

  // A finger on the strip moves the photograph at most once a frame, the latest index winning.
  const pendingScrub = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const flush = useCallback(() => {
    frame.current = null;
    const index = pendingScrub.current;
    pendingScrub.current = null;
    if (index != null) dispatch({ type: "scrubTo", index, by: "strip" });
  }, []);
  const scrubStart = useCallback(() => dispatch({ type: "scrubStart" }), []);
  const scrubTo = useCallback(
    (index: number) => {
      pendingScrub.current = index;
      if (frame.current == null) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );
  const scrubEnd = useCallback(() => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      flush();
    }
    dispatch({ type: "scrubEnd" });
  }, [flush]);
  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const source: ReplaySource = state.source;
  const rest = state.phase !== "playing" && state.centre === state.index;
  /** A press of play would start again from the first print, so the word says AGAIN (`playRestarts`). */
  const restarts = playRestarts(state, ctx.current);
  return {
    state,
    restarts,
    plan,
    leader,
    tray,
    rest,
    source,
    /** The state as of the last change, for handlers that outlive a render. */
    live,
    toggle,
    play,
    hold,
    away,
    step,
    goTo,
    scrubStart,
    scrubTo,
    scrubEnd,
    glide,
    drawn,
    forget,
    gone,
  };
}

export type Replaying = ReturnType<typeof useReplay>;
