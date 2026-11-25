import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet } from "react-native";
import type { DarkroomMode, Print } from "@/darkroom/types";
import { GLIDE_INSET } from "./geometry";
import { GLIDE, stripFollow } from "./glide";
import { useLook } from "./look";
import { edgeMarks } from "./replay";
import { ReplayStrip, type StripHandle } from "./ReplayStrip";

/**
 * The glide strip as the room's page holds it: under POST, at the foot of
 * every page of every chapter (`ReplayStrip` draws it).
 *
 * It comes a quarter of a second after the page (`GLIDE.deferMs`), so the
 * first photograph is asked of Photos before any of the strip's frames
 * are, and entering is as quick as it was; then it fades in. It follows
 * the pages once they have settled, never their scroll as it goes: a
 * frame's glide by UIKit's own ease, or a cut (`stripFollow`). A finger's
 * glide is handed to the room as it begins (`onStart`), as the frame
 * under the box changes (`onTo`), and where it comes to rest (`onEnd`),
 * which the room lands on as a page turn would; meanwhile the strip
 * follows nothing. A frame tapped is handed on as itself (`onFrame`).
 *
 * It fades with the stage as a chapter changes (`opacity`), and takes no
 * touch while it should not be used (`enabled`): a develop under way, a
 * chapter on its way, its title card, a page being turned. Silent, and
 * hidden from VoiceOver.
 */
export const GlideStrip = memo(function GlideStrip({
  prints,
  index,
  rebase,
  mode,
  now,
  width,
  enabled,
  opacity,
  onStart,
  onTo,
  onEnd,
  onFrame,
}: {
  prints: readonly Print[];
  /** The page in front: a print, or the page after them. */
  index: number;
  /** Counts each time prints behind the member were taken out. */
  rebase: number;
  mode: DarkroomMode;
  now: number;
  /** The page's width; the strip keeps the plate's gutters. */
  width: number;
  enabled: boolean;
  opacity: Animated.Value | Animated.AnimatedInterpolation<number>;
  onStart: () => void;
  onTo: (index: number) => void;
  /** The glide has come to rest on frame `index`; true when the room lands there (or is there). */
  onEnd: (index: number) => boolean;
  onFrame: (index: number) => void;
}) {
  const look = useLook();
  const strip = useRef<StripHandle>(null);
  const latest = useRef({ index, rebase });
  latest.current = { index, rebase };
  /** Where the strip was last put, and for which rebase. */
  const last = useRef<{ target: number; rebase: number } | null>(null);
  /** A finger is gliding the strip, or its glide is still coming to rest. */
  const gliding = useRef(false);

  // The strip itself, a moment after the page: the first plate's photograph is asked for first.
  const [start, setStart] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const at = latest.current;
      last.current = { target: at.index, rebase: at.rebase };
      setStart(at.index);
    }, GLIDE.deferMs);
    return () => clearTimeout(t);
  }, []);
  const mounted = start != null;

  const fadeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!mounted) return;
    if (look.reduceMotion) {
      fadeIn.setValue(1);
      return;
    }
    const a = Animated.timing(fadeIn, { toValue: 1, duration: GLIDE.inMs, easing: Easing.out(Easing.quad), useNativeDriver: true });
    a.start();
    return () => a.stop();
    // Once, as it comes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  /** Onto the page in front, from wherever the strip was last put. */
  const follow = useCallback(() => {
    if (!mounted || gliding.current) return;
    const at = latest.current;
    const move = stripFollow(last.current, { index: at.index, count: prints.length + 1, rebase: at.rebase }, {
      reduceMotion: look.reduceMotion,
      web: Platform.OS === "web",
    });
    if (!move) return;
    strip.current?.scrollTo(move.to, move.animated);
    last.current = { target: move.to, rebase: at.rebase };
  }, [mounted, prints.length, look.reduceMotion]);

  // The pages settled somewhere new, prints were taken out behind, or a batch was dealt on: the strip follows.
  useEffect(() => {
    follow();
  }, [index, prints.length, rebase, follow]);

  const marks = useMemo(() => edgeMarks(prints, mode, now), [prints, mode, now]);

  // Read when called, so the strip is never handed new handlers.
  const handlers = useRef({ onStart, onTo, onEnd, onFrame, follow });
  handlers.current = { onStart, onTo, onEnd, onFrame, follow };
  const onScrubStart = useCallback(() => {
    gliding.current = true;
    handlers.current.onStart();
  }, []);
  const onScrubTo = useCallback((i: number) => handlers.current.onTo(i), []);
  const onScrubEnd = useCallback((i: number) => {
    gliding.current = false;
    // Where the glide came to rest is where the strip is: the settle that follows the landing moves nothing.
    last.current = { target: i, rebase: latest.current.rebase };
    // The room would not land there (it is no longer in a state to): back to the page in front.
    if (!handlers.current.onEnd(i)) handlers.current.follow();
  }, []);
  const onCell = useCallback((i: number) => handlers.current.onFrame(i), []);

  const stripWidth = Math.max(0, width - 2 * GLIDE_INSET);
  return (
    <Animated.View style={[styles.row, { opacity }]} pointerEvents={enabled ? "box-none" : "none"}>
      {mounted ? (
        <Animated.View style={{ opacity: fadeIn }}>
          <ReplayStrip
            ref={strip}
            prints={prints}
            start={start}
            marks={marks}
            width={stripWidth}
            onScrubStart={onScrubStart}
            onScrubTo={onScrubTo}
            onScrubEnd={onScrubEnd}
            onCell={onCell}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: { flex: 1, alignItems: "center" },
});
