import React, { memo, useMemo, useRef } from "react";
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { haptics } from "./haptics";
import { useLook } from "./look";
import { DIAL, dialIndex, tickOf, turnDelta, type ReplayPhase } from "./replay";
import { dialLabel, PLAY_HINT } from "./words";

const TICK = { width: 1.5, height: 7 };
const HAND = { width: 2, height: 13 };
const GLYPH = 22;

/**
 * The dial, as Retro has one: sixty hairline ticks, no disc and no ring,
 * and a hand in the accent, a little longer than the ticks, that goes once
 * round for the whole replay. At its centre what a press does next: pause
 * while it plays, play while it is held, play again at the end.
 *
 * Turned by a finger, the hand stays under the finger, from wherever it
 * was (it never jumps to the finger), clockwise forward; one full turn is
 * the whole replay, as the hand's own circle is. So up to sixty
 * photographs it is a true dial, a photograph a notch; past that it is
 * the coarse way through, and the strip the fine one. Each tick the hand
 * crosses under the finger is felt (`haptics.detent`), and each end of
 * the turn, never while it plays. Let go, it stays held, as Retro does.
 *
 * VoiceOver sees one button, named by what it does next; its double-tap
 * is the button's own action, never a touch to be read as a turn.
 */
export const ReplayDial = memo(function ReplayDial({
  phase,
  hand,
  count,
  startFraction,
  onToggle,
  onTurnStart,
  onTurn,
  onTurnEnd,
  style,
}: {
  phase: ReplayPhase;
  /** The hand's place round the dial, 0 to 1. */
  hand: Animated.Value;
  /** Photographs in the replay. */
  count: number;
  /** The hand's place as a turn begins: the photograph in front's. */
  startFraction: () => number;
  onToggle: () => void;
  onTurnStart: () => void;
  onTurn: (index: number) => void;
  onTurnEnd: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const look = useLook();
  const view = useRef<View>(null);
  const centre = useRef({ x: 0, y: 0 });
  const measure = () =>
    view.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) centre.current = { x: x + w / 2, y: y + h / 2 };
    });
  const latest = useRef({ count, startFraction, onToggle, onTurnStart, onTurn, onTurnEnd });
  latest.current = { count, startFraction, onToggle, onTurnStart, onTurn, onTurnEnd };

  const pan = useMemo(() => {
    const turn = { on: false, start: 0, total: 0, prev: 0, index: -1, tick: -1, atEnd: false, feltAt: 0 };
    /** The finger's angle about the dial's centre: 0 at 12 o'clock, clockwise. */
    const angle = (e: GestureResponderEvent) => {
      const dx = e.nativeEvent.pageX - centre.current.x;
      const dy = e.nativeEvent.pageY - centre.current.y;
      return (Math.atan2(dx, -dy) * 180) / Math.PI;
    };
    const finish = () => {
      if (!turn.on) return false;
      turn.on = false;
      latest.current.onTurnEnd();
      return true;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        turn.on = false;
        measure();
      },
      onPanResponderMove: (e, g) => {
        const n = latest.current.count;
        if (!turn.on) {
          if (Math.hypot(g.dx, g.dy) < DIAL.turnAfter || n < 2) return;
          turn.on = true;
          turn.start = latest.current.startFraction();
          turn.total = 0;
          turn.prev = angle(e);
          turn.index = dialIndex(turn.start, n);
          turn.tick = tickOf(turn.start);
          turn.atEnd = false;
          latest.current.onTurnStart();
          return;
        }
        const a = angle(e);
        turn.total += turnDelta(turn.prev, a);
        turn.prev = a;
        const max = (n - 1) / n;
        const fraction = Math.max(0, Math.min(max, turn.start + turn.total / 360));
        // Past either end the hand waits there: turning back moves it at once.
        turn.total = (fraction - turn.start) * 360;
        hand.setValue(fraction);
        const i = dialIndex(fraction, n);
        if (i !== turn.index) {
          turn.index = i;
          latest.current.onTurn(i);
        }
        const tick = tickOf(fraction);
        const atEnd = fraction <= 0 || fraction >= max;
        const now = Date.now();
        if ((tick !== turn.tick || (atEnd && !turn.atEnd)) && now - turn.feltAt >= DIAL.detentMs) {
          haptics.detent();
          turn.feltAt = now;
        }
        turn.tick = tick;
        turn.atEnd = atEnd;
      },
      onPanResponderRelease: () => {
        if (!finish()) latest.current.onToggle();
      },
      onPanResponderTerminate: () => {
        finish();
      },
    });
  }, [hand]);

  const rotate = useMemo(() => hand.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }), [hand]);
  const glyph = phase === "playing" ? "pause" : phase === "ended" ? "rotate-ccw" : "play";
  return (
    <View
      ref={view}
      style={[styles.dial, style]}
      hitSlop={DIAL.slop}
      onLayout={measure}
      {...pan.panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={dialLabel(phase)}
      accessibilityHint={phase === "playing" ? undefined : PLAY_HINT}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={(e: AccessibilityActionEvent) => {
        if (e.nativeEvent.actionName === "activate") onToggle();
      }}
      testID="darkroom-replay-dial"
    >
      <Ticks color={look.contrast ? look.room.soft : look.room.lineFirm} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
        <View style={[styles.hand, { backgroundColor: look.room.accent }]} />
      </Animated.View>
      <View pointerEvents="none" style={styles.centre}>
        <Feather name={glyph} size={GLYPH} color={look.room.ink} accessible={false} style={glyph === "play" ? styles.play : undefined} />
      </View>
    </View>
  );
});

/** The sixty ticks, drawn once. */
const Ticks = memo(function Ticks({ color }: { color: string }) {
  return (
    <>
      {Array.from({ length: DIAL.ticks }, (_, k) => (
        <View key={k} pointerEvents="none" style={[styles.tickTurn, { transform: [{ rotate: `${k * (360 / DIAL.ticks)}deg` }] }]}>
          <View style={[styles.tick, { backgroundColor: color }]} />
        </View>
      ))}
    </>
  );
});

const styles = StyleSheet.create({
  dial: { width: DIAL.size, height: DIAL.size, alignSelf: "center" },
  tickTurn: { position: "absolute", left: 0, top: 0, width: DIAL.size, height: DIAL.size },
  tick: { position: "absolute", top: 0, left: (DIAL.size - TICK.width) / 2, width: TICK.width, height: TICK.height },
  hand: { position: "absolute", top: 0, left: (DIAL.size - HAND.width) / 2, width: HAND.width, height: HAND.height, borderRadius: 1 },
  centre: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  // The play glyph's weight sits left of its box: nudged to its optical centre.
  play: { marginLeft: 2 },
});
