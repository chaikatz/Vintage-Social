import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { printSource } from "@/darkroom/printSource";
import type { Print } from "@/darkroom/types";
import { Caption } from "./Caption";
import { plateFrame, ratioOf } from "./geometry";
import { GLIDE, GLIDE_IDLE, glideReducer, measuredCaption, sheetShows } from "./glide";
import { useLook } from "./look";
import { glideRequest, photographRequest, proofHoldMs } from "./plateImage";
import { knownCaptionHeight } from "./PrintPage";

export interface GlideSheetHandle {
  /** A finger has come down on the strip, over the page in front. */
  start(origin: number): void;
  /** The frame under the box: shown at most once a frame, the latest winning. */
  to(index: number): void;
  /** The glide has come to rest: on print `id`, which the pager now cuts to, or on the page in front or the blank frame (null). `warm`: its photograph has drawn this visit. */
  end(id: string | null, warm: boolean): void;
  /** A plate's photograph has drawn. */
  drawn(id: string): void;
  /** Gone at once, whatever it showed. */
  reset(): void;
}

/** The caption's words for a print, as its page sets them. */
export interface GlideWords {
  label: string;
  line: string;
  long: boolean;
  gone: boolean;
  /** The word at the caption's right (SET ASIDE, PUT BACK…), set as its page sets it so the caption wraps alike; never pressed here. */
  word: { label: string; on: boolean } | null;
}

/** What the sheet shows: a frame of the strip, the print's id (none for the blank frame), and whether it is sharp. */
type Shown = { index: number; id: string | null; sharp: boolean };

const noop = () => undefined;

type PrintSource = NonNullable<ReturnType<typeof printSource>>;

/**
 * The preview over the photograph's area while a finger glides the strip,
 * as Photos' bar does: the page follows the frame under the box at the
 * finger's pace, while the pager itself does not move until the glide has
 * come to rest. It is drawn where the plate it stands in for would stand
 * (`plateFrame`), with that print's caption hung beneath, words and all,
 * and laid out at the height that caption measures, as its page is, so
 * the landing is seamless whatever the caption's width.
 *
 * At once, the soft proof: the photograph at 48 pt, scaled up to the
 * plate, which Photos answers from the thumbnail it keeps on the phone.
 * One view serves every frame of a glide, so it keeps its last picture
 * until the next arrives; it is there, unseen, from the moment a finger
 * comes down, standing for the page in front (or, on the blank frame, the
 * print before it), so it has a picture before the sheet ever shows. A
 * sheet coming over the page waits for its proof to draw, a moment at
 * most (`GLIDE.revealMs`), the page in front staying in view meanwhile, so
 * it never opens on an empty well. Once the frame under the box has
 * stayed there a moment (`GLIDE.sharpMs`: the finger has slowed or
 * paused), the photograph sharp, at the plate's own size, dissolving in
 * over the proof (a cut under Reduce Motion). Only one sharp photograph
 * is ever alive: the frame changing unmounts it, which cancels its request
 * and lets its bitmap go. It is kept by its view alone (`glideRequest`),
 * never in the shared cache or on disk, and one Photos would have to bring
 * down from iCloud is let go at the first word of progress, or of
 * failure: a glide never fetches a photograph. Over the blank frame, the
 * page after the last print, as the room has it (`renderTail`).
 *
 * It covers the page only while the frame under the box is another page
 * than the one in front, so a touch alone never blurs the sharp plate.
 * Let go on another print, it stays while the pager cuts there underneath
 * and then fades, once that page's photograph has drawn — and, where that
 * photograph dissolves in over its own proof beneath a sharp preview, once
 * the dissolve is over, so it never softens as it is handed over — or a
 * short while has passed. Its states are `glideReducer`'s (glide.ts), kept
 * here, so each frame of a glide draws the sheet again and nothing else.
 * For the eye alone: it takes no touch and VoiceOver never hears it. It
 * asks the library nothing.
 */
export const GlideSheet = memo(
  forwardRef<
    GlideSheetHandle,
    {
      prints: readonly Print[];
      /** The page the room has settled on. */
      index: number;
      /** The pager is being turned. */
      dragging: boolean;
      width: number;
      stageHeight: number;
      fontScale: number;
      pixelRatio: number;
      /** The caption's words for a print, as its page sets them. */
      wordsFor: (print: Print) => GlideWords;
      /** The page after the last print: the end page, or the title card while more is dealt. */
      renderTail: () => React.ReactNode;
    }
  >(function GlideSheet({ prints, index, dragging, width, stageHeight, fontScale, pixelRatio, wordsFor, renderTail }, ref) {
    const look = useLook();
    const [state, dispatch] = useReducer(glideReducer, GLIDE_IDLE);
    /** The print landed on had already drawn this visit. */
    const warm = useRef(false);
    /** The print landed on, while it is. */
    const landed = useRef<string | null>(null);
    /** Photographs Photos would have had to bring down from iCloud: soft until landed on. */
    const [refused, setRefused] = useState<ReadonlySet<string>>(() => new Set());
    const opacity = useRef(new Animated.Value(1)).current;
    /** A fade out has finished, or there was none to run. */
    const [faded, setFaded] = useState(true);
    const lastShown = useRef<Shown | null>(null);
    /** The print the preview last stood for: still drawn, unseen, beneath the blank frame's page. */
    const held = useRef<string | null>(null);
    /** The print whose soft proof the preview has drawn: its picture until the next one's arrives. */
    const proofOf = useRef<string | null>(null);
    /** Over the page, from the first frame it shows to the glide's return to the page in front. */
    const [raised, setRaised] = useState(false);
    /** The print whose proof, once drawn, brings the sheet over the page. */
    const awaiting = useRef<string | null>(null);
    /** The print whose sharp photograph the preview has drawn, while it has. */
    const sharpOf = useRef<string | null>(null);
    /** Handed over to a plate that dissolves in from its proof under a sharp preview: the fade waits for the dissolve. */
    const dissolving = useRef(false);
    /** The caption's height as last measured under the preview, the way its page settles one; until then, the pages'. */
    const measured = useRef<number | null>(null);
    const [, laidOutAgain] = useReducer((n: number) => n + 1, 0);

    // The frame under the box, once a frame: the latest wins.
    const pending = useRef<number | null>(null);
    const frame = useRef<number | null>(null);
    const cancelFrame = () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
    const flush = () => {
      cancelFrame();
      const i = pending.current;
      pending.current = null;
      if (i != null) dispatch({ type: "to", index: i });
    };
    useEffect(() => cancelFrame, []);

    useImperativeHandle(
      ref,
      () => ({
        start(origin: number) {
          cancelFrame();
          pending.current = null;
          held.current = null;
          landed.current = null;
          dissolving.current = false;
          setRefused((r) => (r.size === 0 ? r : new Set()));
          opacity.stopAnimation();
          opacity.setValue(1);
          setFaded(false);
          dispatch({ type: "start", origin });
        },
        to(i: number) {
          pending.current = i;
          if (frame.current != null) return;
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            flush();
          });
        },
        end(id: string | null, isWarm: boolean) {
          flush();
          warm.current = isWarm;
          landed.current = id;
          dispatch({ type: "end", id });
        },
        drawn(id: string) {
          if (id === landed.current) dissolving.current = !warm.current && sharpOf.current === id;
          dispatch({ type: "drawn", id });
        },
        reset() {
          cancelFrame();
          pending.current = null;
          landed.current = null;
          dispatch({ type: "reset" });
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    // The room settles: arrived where the glide landed, or, once arrived, moved on from it.
    useEffect(() => {
      dispatch({ type: "settled", index });
    }, [index]);
    // A page turned or dragged by hand, once landed, ends the preview at once.
    useEffect(() => {
      if (dragging) dispatch({ type: "pagerMoved" });
    }, [dragging]);

    // Still under the box a moment: sharp. Never over the page in front, or the blank frame, which have nothing to sharpen.
    const restingOn = state.kind === "gliding" && !state.sharp && state.index !== state.origin && state.index < prints.length ? state.index : null;
    useEffect(() => {
      if (restingOn == null) return;
      const t = setTimeout(() => dispatch({ type: "rested", index: restingOn }), GLIDE.sharpMs);
      return () => clearTimeout(t);
    }, [restingOn]);

    // Landed: waits for the page's own photograph, a short while at most.
    const landingOn = state.kind === "landing" ? state.id : null;
    useEffect(() => {
      if (landingOn == null) return;
      const t = setTimeout(() => dispatch({ type: "timedOut" }), warm.current ? GLIDE.warmLandMs : GLIDE.landMaxMs);
      return () => clearTimeout(t);
    }, [landingOn]);

    // Handed back: fades out, or goes at once under Reduce Motion; over a plate still dissolving in, once it has.
    const fadingOut = state.kind === "idle" && state.fade;
    useEffect(() => {
      if (!fadingOut) return;
      if (look.reduceMotion) {
        setFaded(true);
        return;
      }
      const delay = dissolving.current ? proofHoldMs(photographRequest(true, look.reduceMotion)) : 0;
      const a = Animated.timing(opacity, { toValue: 0, duration: GLIDE.outMs, delay, easing: Easing.out(Easing.quad), useNativeDriver: true });
      a.start(({ finished }) => {
        if (finished) setFaded(true);
      });
      return () => a.stop();
    }, [fadingOut, look.reduceMotion, opacity]);

    // What it shows: the frame under the box, or, handed back, the last it showed while it fades.
    const fading = fadingOut && !faded;
    let shown: Shown | null = null;
    if (state.kind === "gliding") shown = { index: state.index, id: prints[state.index]?.id ?? null, sharp: state.sharp };
    else if (state.kind === "landing") shown = { index: state.index, id: state.id, sharp: state.sharp };
    else if (fading) shown = lastShown.current;
    const shows = sheetShows(state);
    if (shows) lastShown.current = shown;
    const wants = shown != null && (shows || fading);

    // A print is found by its id: prints taken out behind the member meanwhile move it along.
    const id = shown?.id ?? null;
    const own = shown == null || id == null ? null : prints[shown.index]?.id === id ? prints[shown.index] : (prints.find((p) => p.id === id) ?? null);
    const lost = id != null && own == null;
    if (own) held.current = own.id;
    const tail = shown != null && id == null;
    // Over the blank frame, or gliding from it, the print the preview last stood for, or the last print, drawn unseen beneath.
    const print = own ?? (tail ? (prints.find((p) => p.id === held.current) ?? prints[prints.length - 1] ?? null) : null);
    const words = print ? wordsFor(print) : null;

    // Over the page once its proof has drawn, or a moment has passed; then it stays over the page while the glide is off the page in front.
    const ready = tail || print == null || words?.gone === true || proofOf.current === print.id;
    const up = wants && (raised || (state.kind === "gliding" && ready));
    const holding = wants && !up && state.kind === "gliding";
    awaiting.current = holding && print ? print.id : null;
    useEffect(() => {
      if (raised !== up) setRaised(up);
    }, [raised, up]);
    useEffect(() => {
      if (!holding) return;
      const t = setTimeout(() => setRaised(true), GLIDE.revealMs);
      return () => clearTimeout(t);
    }, [holding]);

    const refuse = useCallback((p: string) => setRefused((r) => (r.has(p) ? r : new Set([...r, p]))), []);
    const onProof = useCallback((p: string) => {
      proofOf.current = p;
      if (awaiting.current === p) setRaised(true);
    }, []);
    const onSharp = useCallback((p: string, drawn: boolean) => {
      if (drawn) sharpOf.current = p;
      else if (sharpOf.current === p) sharpOf.current = null;
    }, []);
    // Measured as its page measures its own (`measuredCaption`), and laid out again when that moves it.
    const onMeasured = useCallback((h: number, at: number, known: number) => {
      const next = measuredCaption(h, known);
      measured.current = next;
      if (Math.abs(next - at) >= 0.5) laidOutAgain();
    }, []);

    if (shown == null || stageHeight <= 0 || lost) return null;
    return (
      <View style={[StyleSheet.absoluteFill, !up && styles.unseen]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: look.room.page, opacity }]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="darkroom-glide-sheet"
        >
          {print != null && words != null ? (
            <View style={[StyleSheet.absoluteFill, tail && styles.unseen]}>
              <Preview
                print={print}
                sharp={!tail && shown.sharp && !refused.has(print.id)}
                words={words}
                width={width}
                stageHeight={stageHeight}
                fontScale={fontScale}
                pixelRatio={pixelRatio}
                measured={measured.current}
                onMeasured={onMeasured}
                onProof={onProof}
                onSharp={onSharp}
                onRefuse={refuse}
              />
            </View>
          ) : null}
          {tail && wants ? renderTail() : null}
        </Animated.View>
      </View>
    );
  }),
);

/** The plate as its page would stand it, the soft proof in it, the sharp photograph over that once rested on, and the caption under it. */
function Preview({
  print,
  sharp,
  words,
  width,
  stageHeight,
  fontScale,
  pixelRatio,
  measured,
  onMeasured,
  onProof,
  onSharp,
  onRefuse,
}: {
  print: Print;
  sharp: boolean;
  words: GlideWords;
  width: number;
  stageHeight: number;
  fontScale: number;
  pixelRatio: number;
  /** The caption's height as last measured here, or null for the pages' own. */
  measured: number | null;
  onMeasured: (height: number, laidOutAt: number, known: number) => void;
  onProof: (id: string) => void;
  onSharp: (id: string, drawn: boolean) => void;
  onRefuse: (id: string) => void;
}) {
  const look = useLook();
  const ratio = ratioOf(print);
  const known = knownCaptionHeight(fontScale, words.long);
  const caption = measured ?? known;
  const f = plateFrame(ratio, width, stageHeight, caption, pixelRatio);
  const source = useMemo(() => (words.gone ? null : printSource(print.uri)), [print.uri, words.gone]);
  const id = print.id;
  return (
    <>
      <View
        style={[styles.plate, { top: f.top, left: f.left, width: f.box.width, height: f.box.height, backgroundColor: look.room.well }]}
        testID="darkroom-glide-plate"
      >
        <View style={styles.proofSlot}>
          <View style={{ width: GLIDE.proof, height: GLIDE.proof / ratio, transform: [{ scale: f.box.width / GLIDE.proof }] }}>
            {source != null ? (
              <Image
                source={source}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="none"
                transition={0}
                onLoad={() => onProof(id)}
                accessibilityIgnoresInvertColors
              />
            ) : null}
          </View>
        </View>
        {sharp && source != null ? <Sharp key={print.id} id={print.id} source={source} onSharp={onSharp} onRefuse={onRefuse} /> : null}
        <View style={[StyleSheet.absoluteFill, styles.hairline, { borderColor: look.contrast ? look.room.lineStrong : look.room.line }]} />
      </View>
      <View style={[styles.caption, { top: f.top + f.box.height, left: f.captionLeft }]}>
        <Caption
          width={f.captionW}
          gap={f.gap}
          label={words.label}
          line={words.line}
          word={words.word ? { label: words.word.label, on: words.word.on, inert: true } : null}
          onDate={noop}
          onWord={noop}
          onHeight={(h) => onMeasured(h, caption, known)}
          testID="darkroom-glide-caption"
        />
      </View>
    </>
  );
}

/**
 * The photograph sharp, at the plate's size, over the proof. Its request
 * is fixed as its view is made (`glideRequest`); a new frame is a new
 * view, and the old one, unmounted, lets its bitmap go. Given up at the
 * first word of a download from iCloud, or of failure.
 */
const Sharp = memo(function Sharp({
  id,
  source,
  onSharp,
  onRefuse,
}: {
  id: string;
  source: PrintSource;
  onSharp: (id: string, drawn: boolean) => void;
  onRefuse: (id: string) => void;
}) {
  const look = useLook();
  const [request] = useState(() => glideRequest(look.reduceMotion));
  useEffect(() => () => onSharp(id, false), [id, onSharp]);
  return (
    <View style={StyleSheet.absoluteFill} testID="darkroom-glide-sharp">
      <Image
        source={source}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        recyclingKey={id}
        cachePolicy={request.cachePolicy}
        priority={request.priority}
        allowDownscaling={request.allowDownscaling}
        transition={request.transition}
        onLoad={() => onSharp(id, true)}
        onProgress={() => onRefuse(id)}
        onError={() => onRefuse(id)}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
});

const styles = StyleSheet.create({
  plate: { position: "absolute", overflow: "hidden" },
  proofSlot: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  hairline: { borderWidth: StyleSheet.hairlineWidth },
  caption: { position: "absolute" },
  unseen: { opacity: 0 },
});
