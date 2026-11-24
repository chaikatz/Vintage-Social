import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from "react-native";
import { Image, type ImageErrorEventData } from "expo-image";
import { printSource } from "@/darkroom/printSource";
import type { Print } from "@/darkroom/types";
import { plateTrouble, ratioOf, replayBox } from "./geometry";
import { useLook } from "./look";
import { gateRequest, progressOf, proofHoldMs } from "./plateImage";
import { PROOF_WIDTH, type ReplayCard, type ReplayPhase } from "./replay";
import { TitleCard } from "./TitleCard";
import { RoomText } from "./Type";
import { actionNamed, placeholderWords, spokenActions, STAGE_HINT, STAGE_LABEL, type PlateTrouble, type StageAction } from "./words";

/** A touch that moves less than this is a tap. */
const TAP_SLOP = 10;
/** A swipe across the photograph further than this steps one photograph. */
const SWIPE = 40;

/**
 * The replay's gate: where the photographs stand, one at a time, as hard
 * cuts. It holds the few photographs around the one in front (the tray),
 * each at its own box in the gate (`replayBox`), standing on the gate's
 * bottom edge; only the one in front is seen. Nothing is drawn until the
 * gate has a size, so Photos is never asked for a photograph without one.
 *
 * Each photograph's view asks once, as it is made (`gateRequest`), and
 * never changes while it lives: on the phone a change to any of its props,
 * or to its size, loads it again. Shown or not is the opacity of the view
 * around it, nothing else. It is kept by its view alone (cachePolicy
 * "none"), so a photograph leaving the tray lets its bitmap go, and its
 * download if it was still coming.
 *
 * Under the photograph in front, until it has drawn, its soft proof: the
 * room's 48 pt thumbnail scaled up to the box, which Photos keeps on the
 * phone, so a fast glide never flashes the empty well. One view serves
 * every photograph: as the one in front changes, it keeps its last
 * picture until the next arrives.
 *
 * A tap holds the replay while it plays; held, a tap on the right half
 * steps on and on the left half back, as a tap turns the room's pages
 * (`tapTurn`), and a swipe across steps either way. VoiceOver sees one
 * adjustable element, the room's "Photograph": swiping up or down steps,
 * and Play or Pause is its action; its own double-tap is not a tap here.
 */
export interface GateProps {
  tray: readonly Print[];
  current: Print;
  phase: ReplayPhase;
  /** A title card is up, over the photograph it opens. */
  card: ReplayCard | null;
  pixelRatio: number;
  online: boolean;
  limited: boolean;
  /** The photograph's value for VoiceOver (`replayValue`). */
  value: string;
  /** VoiceOver's action: "Pause", "Play" or "Play again" (`dialLabel`). */
  actionLabel: string;
  viewRef?: React.RefObject<View | null>;
  /** A tap, `x` across the page. */
  onTap: (x: number) => void;
  onStep: (by: -1 | 1, source: "tap" | "vo") => void;
  onToggle: () => void;
  onDrawn: (id: string, ok: boolean) => void;
  onForget: (id: string) => void;
  onGone: (id: string) => void;
  /** iCloud's progress on the photograph in front; null when it has drawn or failed. */
  onCloud: (id: string, fraction: number | null) => void;
}

type Box = { left: number; top: number; width: number; height: number };

export function ReplayGate(props: GateProps) {
  const { tray, current, phase, card, pixelRatio, online, limited } = props;
  const look = useLook();
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** Drawn, and any dissolve over: the proof under them can go. */
  const [developed, setDeveloped] = useState<ReadonlySet<string>>(() => new Set());
  /** Why a photograph in the tray could not be drawn. */
  const [trouble, setTrouble] = useState<ReadonlyMap<string, PlateTrouble>>(() => new Map());

  const latest = useRef(props);
  latest.current = props;
  const screenReader = useRef(look.screenReader);
  screenReader.current = look.screenReader;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
  };
  const boxFor = useCallback(
    (p: Print): Box => replayBox(ratioOf(p), size.width, size.height, pixelRatio),
    [size.width, size.height, pixelRatio],
  );

  const onLoad = useCallback((id: string) => {
    latest.current.onDrawn(id, true);
    latest.current.onCloud(id, null);
  }, []);
  const onDeveloped = useCallback((id: string) => {
    setDeveloped((s) => (s.has(id) ? s : new Set([...s, id])));
  }, []);
  const onError = useCallback((id: string, error: string | undefined) => {
    const why = plateTrouble(error, latest.current.online);
    setTrouble((m) => new Map([...m, [id, why]]));
    latest.current.onCloud(id, null);
    if (why === "missing") latest.current.onGone(id);
    else latest.current.onDrawn(id, false);
  }, []);
  const onProgress = useCallback((id: string, fraction: number) => {
    if (id === latest.current.current.id) latest.current.onCloud(id, fraction);
  }, []);
  const onUnmount = useCallback((id: string) => {
    latest.current.onForget(id);
    latest.current.onCloud(id, null);
    setDeveloped((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    setTrouble((m) => {
      if (!m.has(id)) return m;
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  }, []);

  // One responder for the whole gate: a tap, or a swipe across. None under VoiceOver.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !screenReader.current,
        onMoveShouldSetPanResponder: () => false,
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (e: GestureResponderEvent, g: PanResponderGestureState) => {
          const p = latest.current;
          if (Math.abs(g.dx) > SWIPE && Math.abs(g.dx) > Math.abs(g.dy)) return p.onStep(g.dx < 0 ? 1 : -1, "tap");
          if (Math.abs(g.dx) < TAP_SLOP && Math.abs(g.dy) < TAP_SLOP) return p.onTap(e.nativeEvent.pageX);
          if (p.phase === "playing") p.onToggle();
        },
      }),
    [],
  );

  const actions: StageAction[] = [{ name: "play", label: props.actionLabel }];
  const box = size.width > 0 && size.height > 0 ? boxFor(current) : null;
  const shownTrouble = phase !== "playing" ? trouble.get(current.id) ?? null : null;
  const words = shownTrouble ? placeholderWords(shownTrouble, limited) : null;
  const line = look.contrast ? look.room.lineStrong : look.room.line;

  return (
    <View
      ref={props.viewRef}
      style={styles.gate}
      onLayout={onLayout}
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={STAGE_LABEL}
      accessibilityValue={{ text: props.value }}
      accessibilityHint={STAGE_HINT}
      accessibilityActions={spokenActions(actions)}
      onAccessibilityAction={(e: AccessibilityActionEvent) => {
        const said = e.nativeEvent.actionName;
        if (said === "increment") return props.onStep(1, "vo");
        if (said === "decrement") return props.onStep(-1, "vo");
        if (actionNamed(actions, said) === "play") props.onToggle();
      }}
      testID="darkroom-replay-gate"
    >
      {box ? (
        <>
          <View pointerEvents="none" style={[styles.box, box, { backgroundColor: look.room.well }]} />
          {!developed.has(current.id) ? <ScrubProof print={current} box={box} /> : null}
          {tray.map((p) => {
            const b = boxFor(p);
            return (
              <Slot
                key={p.id}
                print={p}
                left={b.left}
                top={b.top}
                width={b.width}
                height={b.height}
                current={p.id === current.id}
                onLoad={onLoad}
                onDeveloped={onDeveloped}
                onError={onError}
                onProgress={onProgress}
                onUnmount={onUnmount}
              />
            );
          })}
          <View pointerEvents="none" style={[styles.box, box, styles.hairline, { borderColor: line }]} />
          {words ? (
            <View pointerEvents="none" style={[styles.box, box, styles.placeholder, { backgroundColor: look.room.well }]}>
              <RoomText kind="small" maxFontSizeMultiplier={1.5} style={styles.center}>
                {words.line1}
              </RoomText>
              <RoomText kind="foot" maxFontSizeMultiplier={1.5} style={[styles.center, styles.placeholderLine]}>
                {words.line2}
              </RoomText>
            </View>
          ) : null}
          {card ? (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: look.room.page }]} testID="darkroom-replay-card">
              <TitleCard eyebrow={card.eyebrow} title={card.title} year={card.year} waiting={false} />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/**
 * One photograph in the tray, at its own box. Its request is fixed as it
 * is made (`gateRequest`: dissolving in only when made already in front)
 * and never changes while it lives; whether it is seen is its wrapper's
 * opacity, and nothing else.
 */
const Slot = memo(function Slot({
  print,
  left,
  top,
  width,
  height,
  current,
  onLoad,
  onDeveloped,
  onError,
  onProgress,
  onUnmount,
}: {
  print: Print;
  /** Its box in the gate, as numbers, so the slot draws again only when its box or its place in front changes. */
  left: number;
  top: number;
  width: number;
  height: number;
  current: boolean;
  onLoad: (id: string) => void;
  onDeveloped: (id: string) => void;
  onError: (id: string, error: string | undefined) => void;
  onProgress: (id: string, fraction: number) => void;
  onUnmount: (id: string) => void;
}) {
  const look = useLook();
  const [request] = useState(() => gateRequest(current, look.reduceMotion));
  const [source] = useState(() => printSource(print.uri));
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = print.id;
  useEffect(() => {
    // Nothing to ask for: as good as failed, so the replay does not wait on it.
    if (source == null) onError(id, undefined);
    return () => {
      if (hold.current) clearTimeout(hold.current);
      onUnmount(id);
    };
    // For the life of the slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loaded = () => {
    onLoad(id);
    const ms = proofHoldMs(request);
    if (hold.current) clearTimeout(hold.current);
    if (ms === 0) return onDeveloped(id);
    hold.current = setTimeout(() => {
      hold.current = null;
      onDeveloped(id);
    }, ms);
  };
  return (
    <View pointerEvents="none" style={[styles.box, { left, top, width, height, opacity: current ? 1 : 0 }]}>
      {source != null ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={id}
          cachePolicy={request.cachePolicy}
          priority={request.priority}
          allowDownscaling={request.allowDownscaling}
          transition={request.transition}
          onProgress={(e) => {
            const fraction = progressOf(e);
            if (fraction != null) onProgress(id, fraction);
          }}
          onLoad={loaded}
          onError={(e: ImageErrorEventData) => onError(id, e?.error)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  );
});

/**
 * The soft proof under the photograph in front, until that has drawn: a
 * 48 pt view scaled up to the box, as the room's plate draws it. One view
 * for every photograph, so as the one in front changes in a glide, it
 * keeps the last picture until the next arrives.
 */
function ScrubProof({ print, box }: { print: Print; box: Box }) {
  const source = useMemo(() => printSource(print.uri), [print.uri]);
  const ratio = ratioOf(print);
  return (
    <View pointerEvents="none" style={[styles.box, box, styles.proofSlot]}>
      <View style={{ width: PROOF_WIDTH, height: PROOF_WIDTH / ratio, transform: [{ scale: box.width / PROOF_WIDTH }] }}>
        {source != null ? (
          <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="none" transition={0} accessibilityIgnoresInvertColors />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gate: { flex: 1, marginTop: 8, marginHorizontal: 16 },
  box: { position: "absolute", overflow: "hidden" },
  hairline: { borderWidth: StyleSheet.hairlineWidth },
  proofSlot: { alignItems: "center", justifyContent: "center" },
  placeholder: { alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  placeholderLine: { marginTop: 6 },
  center: { textAlign: "center" },
});
