import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View, findNodeHandle } from "react-native";
import { captionFor, clockTime } from "@/darkroom/labels";
import type { DarkroomMode, DayReach, Print, Span } from "@/darkroom/types";
import { Signature } from "./Caption";
import { CAPTION_GAP, signatureGap } from "./geometry";
import { motion, useLook } from "./look";
import { edgeMarks, REPLAY_IN_MS, replayEnding, ROOM_OUT_MS } from "./replay";
import { ReplayGate } from "./ReplayGate";
import { ReplayLeader } from "./ReplayLeader";
import { ReplayStrip, type StripHandle } from "./ReplayStrip";
import { tapTurn } from "./turn";
import { RoomText } from "./Type";
import { useReplay } from "./useReplay";
import { Word } from "./Word";
import { PLAY_HINT, replayEndSaid, replayValue, replayWord } from "./words";

/** iCloud's progress along the signature line follows each step over this, as the plate's does. */
const CLOUD_STEP_MS = 120;
/**
 * The page under the gate, top to bottom: the caption; the strip, this far
 * under it; the leader, this far under the strip; and the word, this far
 * under the leader, in DEVELOP's own slot (48 pt, with the room's bottom
 * margin under it), so HOLD stands exactly where DEVELOP stood. The gate
 * has the rest: on the reference phone (393 × 852) it runs from 111 to
 * 587, a 3:4 portrait 357 × 476, the strip 677 to 745, the leader at 753
 * and the word 762 to 810; on an SE (375 × 667), 72 to 421, a portrait
 * 262 × 349, and the word 595 to 643.
 */
const STRIP_GAP = 16;
const LEADER_GAP = 8;
const WORD_GAP = 8;
/** DEVELOP's slot, and its word's least width (Develop.tsx). */
const WORD_SLOT = 48;
const WORD_MIN_WIDTH = 116;

export interface ReplayHandle {
  /** The room is going out of view: held, if it was playing. */
  hold(reason: "away"): void;
  /** Held, faded out, and handed back to the room on the photograph in the gate. */
  close(): void;
}

export interface ReplayProps {
  /** The chapter's prints as they were when PLAY was pressed, without those known to be gone. */
  prints: readonly Print[];
  start: number;
  mode: DarkroomMode;
  reach: DayReach | null;
  span: Span | null;
  now: number;
  online: boolean;
  limited: boolean;
  missing: ReadonlySet<string>;
  width: number;
  pixelRatio: number;
  bottomInset: number;
  screenReader: boolean;
  onImageGone: (id: string) => void;
  /** The replay has gone: the room lands on this print. */
  onClose: (id: string) => void;
}

/**
 * A handler whose identity never changes but which always runs the latest
 * code, so the strip it is handed to never draws again for it.
 */
function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current(...args), []);
}

/** VoiceOver's focus onto a view. The browser has no native tags to find, and no VoiceOver to tell. */
function focusOn(view: unknown): void {
  if (Platform.OS === "web" || view == null) return;
  try {
    const tag = findNodeHandle(view as never);
    if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
  } catch {
    // Not mounted any more: there is nothing to focus.
  }
}

/**
 * PLAY: the chapter in front of the member played through in the Memory
 * Room's own page, a photograph at a time. It takes the place of the
 * stage and the bottom row; the running head stays, its Back closing the
 * replay rather than the room.
 *
 * Top to bottom: the gate, where the photographs stand as hard cuts at
 * Retro's pace (`ReplayGate`); the caption hung under it, as a print's
 * is, which changes only when its words do, so a burst plays under a
 * caption that stays still; the glide strip (`ReplayStrip`), Photos'
 * scrubber; the leader under it (`ReplayLeader`), a hairline drawn out in
 * the accent as the replay goes, one length for the whole of it; and at
 * the foot, where DEVELOP stands in the room, the room's own ruled word:
 * HOLD while it plays, PLAY when held, AGAIN at the end. One index drives
 * them all, kept by `useReplay`.
 *
 * It plays the prints the room already holds, and asks the library
 * nothing. Every photograph is asked for at its view's size and kept by
 * its view alone, never in the shared cache: closing it lets them all go.
 */
export const Replay = forwardRef<ReplayHandle, ReplayProps>(function Replay(props, ref) {
  const { prints, start, mode, reach, span, now, online, limited, missing, width, pixelRatio, bottomInset, screenReader } = props;
  const look = useLook();
  const n = prints.length;
  const endSaid = useMemo(
    () => replayEndSaid(replayEnding(mode, reach, span), { now, limited, years: null }),
    [mode, reach, span, now, limited],
  );
  const r = useReplay({
    prints,
    start,
    mode,
    reach,
    now,
    online,
    missing,
    reduceMotion: look.reduceMotion,
    screenReader,
    endSaid,
    onImageGone: props.onImageGone,
  });
  const { state } = r;
  const current = prints[Math.max(0, Math.min(n - 1, state.index))];

  // --- in and out --------------------------------------------------------------

  const opacity = useRef(new Animated.Value(look.reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    const a = Animated.timing(opacity, {
      toValue: 1,
      duration: motion(look, REPLAY_IN_MS),
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gate = useRef<View>(null);
  useEffect(() => {
    if (!screenReader) return;
    const t = setTimeout(() => focusOn(gate.current), 120);
    return () => clearTimeout(t);
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closing = useRef(false);
  const close = useEvent(() => {
    if (closing.current) return;
    closing.current = true;
    r.hold();
    const id = prints[r.live.current.index]?.id ?? prints[0]?.id ?? "";
    // Stopped, not finished, only as the replay unmounts under its fade: the room has closed it already, and lands nowhere.
    Animated.timing(opacity, {
      toValue: 0,
      duration: motion(look, ROOM_OUT_MS),
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) props.onClose(id);
    });
  });
  const away = r.away;
  useImperativeHandle(ref, () => ({ hold: () => away(), close }), [away, close]);

  // --- the strip follows every change but its own --------------------------------

  const strip = useRef<StripHandle>(null);
  const followed = useRef(state.index);
  useEffect(() => {
    if (followed.current === state.index) return;
    followed.current = state.index;
    if (state.source === "strip") return;
    // A glide by UIKit's own ease while it plays or a frame is chosen; a cut in the browser, and under Reduce Motion.
    strip.current?.scrollTo(state.index, !look.reduceMotion && Platform.OS !== "web");
  }, [state.index, state.source, look.reduceMotion]);

  const marks = useMemo(() => edgeMarks(prints, r.plan, mode, now), [prints, r.plan, mode, now]);

  // --- the word ----------------------------------------------------------------------

  const word = replayWord(state.phase, r.restarts);
  /**
   * The word pressed. A glide of the strip still coming to rest stops
   * where it is first, on the photograph in front: PLAY is never held
   * again by a flick's last frames.
   */
  const press = useEvent(() => {
    strip.current?.settle();
    r.toggle();
  });
  const foot = useMemo(() => ({ marginTop: WORD_GAP, marginBottom: Math.max(bottomInset, 16) + 8 }), [bottomInset]);

  // --- the gate ----------------------------------------------------------------------

  /** A tap on the photograph: while it plays, a hold; held, the room's own rule, right half on and left half back. */
  const onTap = useEvent((x: number) => {
    const s = r.live.current;
    if (s.phase === "playing") return r.hold();
    const step = tapTurn(x, width, { index: s.index, count: n, zoomed: false, locked: false, turning: false, screenReader: look.screenReader });
    if (step !== 0) r.step(step, "tap");
  });

  // iCloud's progress on the photograph in front, drawn along the signature line while it is held.
  const fraction = useRef(new Animated.Value(0)).current;
  const cloudId = useRef<string | null>(null);
  const [cloudFor, setCloudFor] = useState<string | null>(null);
  const onCloud = useEvent((id: string, f: number | null) => {
    if (f == null) {
      if (cloudId.current !== id) return;
      cloudId.current = null;
      setCloudFor(null);
      return;
    }
    if (cloudId.current !== id) {
      cloudId.current = id;
      fraction.setValue(0);
      setCloudFor(id);
    }
    Animated.timing(fraction, {
      toValue: f,
      duration: look.reduceMotion ? 0 : CLOUD_STEP_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  });
  const downloading = state.phase !== "playing" && cloudFor === current.id;
  const progress = useMemo(() => (downloading ? { fraction } : null), [downloading, fraction]);

  // --- the words ---------------------------------------------------------------------

  const words = captionFor(current.takenAt, now, mode, reach, null);
  const time = mode === "on-this-day" || mode === "span" ? clockTime(current.takenAt) : null;
  const gateWidth = Math.max(0, width - 32);
  const card = state.phase === "playing" && state.wait === "card" ? (r.plan.card[state.index] ?? null) : null;

  return (
    <Animated.View style={[styles.root, { opacity }]} testID="darkroom-replay">
      <ReplayGate
        viewRef={gate}
        tray={r.tray}
        current={current}
        phase={state.phase}
        card={card}
        pixelRatio={pixelRatio}
        online={online}
        limited={limited}
        value={replayValue(current.takenAt, words.line, state.phase)}
        actionLabel={word.said}
        onTap={onTap}
        onStep={r.step}
        onToggle={r.toggle}
        onDrawn={r.drawn}
        onForget={r.forget}
        onGone={r.gone}
        onCloud={onCloud}
      />
      <ReplayCaption
        width={gateWidth}
        gap={signatureGap(gateWidth, pixelRatio)}
        label={words.label}
        time={time}
        line={words.line}
        progress={progress}
      />
      <View style={styles.stripGap}>
        <ReplayStrip
          ref={strip}
          prints={prints}
          start={start}
          marks={marks}
          width={width}
          onScrubStart={r.scrubStart}
          onScrubTo={r.scrubTo}
          onScrubEnd={r.scrubEnd}
          onGlide={r.glide}
          onCell={r.goTo}
        />
      </View>
      <View style={styles.leaderGap}>
        <ReplayLeader fraction={r.leader} width={width} />
      </View>
      <View style={[styles.foot, foot]}>
        <Word
          label={word.label}
          primary
          accessibilityLabel={word.said}
          accessibilityHint={state.phase === "playing" ? undefined : PLAY_HINT}
          onPress={press}
          maxFontSizeMultiplier={1.5}
          minHeight={WORD_SLOT}
          paddingHorizontal={24}
          style={styles.word}
          testID="darkroom-replay-word"
        />
      </View>
    </Animated.View>
  );
});

/**
 * The caption hung under the gate, as the room's plate hangs one: the
 * paper, the signature line, the date in the accent with the time at the
 * right, and the italic line beneath. Drawn again only when its words
 * change. For the eye: VoiceOver hears it all in the photograph's value.
 */
const ReplayCaption = memo(function ReplayCaption({
  width,
  gap,
  label,
  time,
  line,
  progress,
}: {
  width: number;
  gap: number;
  label: string;
  time: string | null;
  line: string;
  progress: { fraction: Animated.Value | null } | null;
}) {
  return (
    <View
      style={[styles.caption, { width, paddingTop: gap }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="darkroom-replay-caption"
    >
      <Signature width={width} progress={progress} />
      <View style={styles.row}>
        <RoomText kind="dateLabel" numberOfLines={1} maxFontSizeMultiplier={1.5} style={styles.date} testID="darkroom-replay-date">
          {label}
        </RoomText>
        {time ? (
          <RoomText kind="folio" numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.time} testID="darkroom-replay-time">
            {time}
          </RoomText>
        ) : null}
      </View>
      <RoomText kind="line" numberOfLines={1} maxFontSizeMultiplier={1.5} style={styles.line} testID="darkroom-replay-line">
        {line}
      </RoomText>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  caption: { alignSelf: "center" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 14, paddingTop: CAPTION_GAP },
  date: { flexShrink: 1 },
  time: { marginLeft: 12 },
  line: { marginTop: 6 },
  stripGap: { marginTop: STRIP_GAP },
  leaderGap: { marginTop: LEADER_GAP },
  // DEVELOP's own block and slot (Develop.tsx): the word stands where DEVELOP stood.
  foot: { alignItems: "center", justifyContent: "flex-end", minHeight: WORD_SLOT },
  word: { minWidth: WORD_MIN_WIDTH },
});
