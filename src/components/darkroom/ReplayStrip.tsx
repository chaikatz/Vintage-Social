import React, { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import {
  Animated,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Image } from "expo-image";
import { printSource } from "@/darkroom/printSource";
import type { Print } from "@/darkroom/types";
import { useLook } from "./look";
import { STRIP, stripIndex } from "./replay";
import { RoomText } from "./Type";

/** A finger let go with no momentum to follow: the glide has ended after this. */
const END_DRAG_MS = 80;
/** The browser has no momentum events: a strip still for this long has stopped, as the stage's pager does. */
const WEB_SETTLE_MS = 140;
/** The marks' row stands this far above the frames. */
const MARK_GAP = 2;

export interface StripHandle {
  /** The frame under the box: glided to, or a cut. */
  scrollTo(index: number, animated: boolean): void;
  /** A member's glide still coming to rest stops, at once, on the frame it has reached, and its scrub ends. */
  settle(): void;
}

/**
 * The glide strip: Photos' sliding bar, set as a strip cut from a contact
 * sheet. Every photograph of the replay is a small frame; a flick glides
 * with momentum and comes to rest on one. The frame at the centre grows a
 * little inside a box fixed over the middle, drawn in the accent as a
 * photographer marks a contact sheet in grease pencil, and the strip
 * glides under it. Along its top edge, as film is edge-printed, the year
 * or the day where each begins.
 *
 * It is a list that never draws again per photograph: what it shows moves
 * by its own scroll, through `scrollTo`. A finger on it holds the replay
 * and moves the photograph in front with it (`onScrubTo`, at most once a
 * frame), and the leader under it with every scroll (`onGlide`), until
 * the glide comes to rest. It is the replay's one scrubber: the leader
 * only follows it. The replay's own moves never count as the member's:
 * on the phone they never begin with a drag, and in the browser, where
 * there are no drag events, the strip's own moves are cuts to an offset
 * it knows, so any other is the member's.
 *
 * It glides silently, with no haptics, and is hidden from VoiceOver: the
 * photograph's own adjustable element steps through the replay instead.
 */
export const ReplayStrip = memo(
  forwardRef<
    StripHandle,
    {
      prints: readonly Print[];
      start: number;
      /** The edge marks, by frame (`edgeMarks`). */
      marks: ReadonlyMap<number, string>;
      width: number;
      onScrubStart: () => void;
      onScrubTo: (index: number) => void;
      onScrubEnd: () => void;
      /** A finger's glide, at this scroll offset: the leader follows it. */
      onGlide: (x: number) => void;
      /** A frame tapped: held, and straight to it. */
      onCell: (index: number) => void;
    }
  >(function ReplayStrip({ prints, start, marks, width, onScrubStart, onScrubTo, onScrubEnd, onGlide, onCell }, ref) {
    const look = useLook();
    const list = useRef<FlatList<Print>>(null);
    const n = prints.length;
    const scrollX = useRef(new Animated.Value(start * STRIP.pitch)).current;
    /** Where the replay last asked the strip to be. */
    const asked = useRef(start * STRIP.pitch);
    /** Where a member's glide last had it. */
    const glidedTo = useRef(start * STRIP.pitch);
    /** A finger is gliding it, or its glide is still coming to rest. */
    const driving = useRef(false);
    const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const webTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const laidOut = useRef(false);
    const clear = () => {
      if (endTimer.current) clearTimeout(endTimer.current);
      endTimer.current = null;
      if (webTimer.current) clearTimeout(webTimer.current);
      webTimer.current = null;
    };
    useEffect(() => clear, []);

    // Read when called, so the list's handlers never change.
    const on = useRef({ onScrubStart, onScrubTo, onScrubEnd, onGlide });
    on.current = { onScrubStart, onScrubTo, onScrubEnd, onGlide };
    const end = () => {
      clear();
      if (!driving.current) return;
      driving.current = false;
      on.current.onScrubEnd();
    };
    const begin = () => {
      clear();
      if (driving.current) return;
      driving.current = true;
      on.current.onScrubStart();
    };

    useImperativeHandle(
      ref,
      () => ({
        scrollTo(index: number, animated: boolean) {
          // The replay moves the strip for something else (the clock, a frame or a step): a glide of the
          // member's is over. A set offset can stop UIKit's deceleration with no momentum end to say so, and a glide
          // left driving would take the replay's own next glide for a finger's.
          end();
          const offset = Math.max(0, Math.min(n - 1, index)) * STRIP.pitch;
          asked.current = offset;
          list.current?.scrollToOffset({ offset, animated });
        },
        settle() {
          if (!driving.current) return;
          // The frame the glide last read: the one its scrub's end puts in front.
          const offset = stripIndex(glidedTo.current, n) * STRIP.pitch;
          end();
          asked.current = offset;
          list.current?.scrollToOffset({ offset, animated: false });
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [n],
    );

    const onScroll = useMemo(
      () =>
        Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: true,
          listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const x = e.nativeEvent.contentOffset.x;
            if (Platform.OS === "web") {
              // Not where the replay put it: the member moved it.
              if (!driving.current && Math.abs(x - asked.current) < 1) return;
              begin();
              glidedTo.current = x;
              on.current.onScrubTo(stripIndex(x, n));
              on.current.onGlide(x);
              webTimer.current = setTimeout(() => {
                webTimer.current = null;
                const offset = stripIndex(x, n) * STRIP.pitch;
                asked.current = offset;
                list.current?.scrollToOffset({ offset, animated: false });
                end();
              }, WEB_SETTLE_MS);
              return;
            }
            // Only a finger's glide reads the frame: the replay's own glides are already where it wants them.
            if (!driving.current) return;
            glidedTo.current = x;
            on.current.onScrubTo(stripIndex(x, n));
            on.current.onGlide(x);
          },
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [scrollX, n],
    );

    return (
      <View
        style={[styles.strip, { width }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID="darkroom-replay-strip-row"
      >
        <StripList
          listRef={list}
          prints={prints}
          start={start}
          marks={marks}
          width={width}
          scrollX={scrollX}
          reduceMotion={look.reduceMotion}
          contrast={look.contrast}
          onScroll={onScroll}
          onBegin={begin}
          onEndDrag={() => {
            if (endTimer.current) clearTimeout(endTimer.current);
            endTimer.current = setTimeout(end, END_DRAG_MS);
          }}
          onMomentumBegin={() => {
            if (endTimer.current) clearTimeout(endTimer.current);
            endTimer.current = null;
          }}
          onMomentumEnd={() => {
            if (driving.current) end();
          }}
          onLayout={() => {
            if (laidOut.current) return;
            laidOut.current = true;
            list.current?.scrollToOffset({ offset: asked.current, animated: false });
          }}
          onCell={onCell}
        />
        {/* The grease-pencil box, fixed over the middle: the strip glides under it. */}
        <View
          pointerEvents="none"
          style={[styles.box, { left: (width - STRIP.boxW) / 2, borderColor: look.room.accent }]}
          testID="darkroom-replay-box"
        />
      </View>
    );
  }),
);

/** The list itself, drawn once: nothing it is handed changes as the replay plays. */
const StripList = memo(function StripList({
  listRef,
  prints,
  start,
  marks,
  width,
  scrollX,
  reduceMotion,
  contrast,
  onScroll,
  onBegin,
  onEndDrag,
  onMomentumBegin,
  onMomentumEnd,
  onLayout,
  onCell,
}: {
  listRef: React.RefObject<FlatList<Print> | null>;
  prints: readonly Print[];
  start: number;
  marks: ReadonlyMap<number, string>;
  width: number;
  scrollX: Animated.Value;
  reduceMotion: boolean;
  contrast: boolean;
  onScroll: (...args: unknown[]) => void;
  onBegin: () => void;
  onEndDrag: () => void;
  onMomentumBegin: () => void;
  onMomentumEnd: () => void;
  onLayout: () => void;
  onCell: (index: number) => void;
}) {
  // Read when called, so the cells never draw again for a new handler.
  const handlers = useRef({ onBegin, onEndDrag, onMomentumBegin, onMomentumEnd, onLayout, onCell });
  handlers.current = { onBegin, onEndDrag, onMomentumBegin, onMomentumEnd, onLayout, onCell };
  const press = useMemo(() => (i: number) => handlers.current.onCell(i), []);
  return (
    <Animated.FlatList
      ref={listRef as React.RefObject<FlatList<Print>>}
      data={prints as Print[]}
      horizontal
      keyExtractor={(p: Print) => p.id}
      // The side padding is left out on purpose: a frame's offset is then
      // exactly the scroll offset that puts it under the box.
      contentContainerStyle={{ paddingHorizontal: (width - STRIP.pitch) / 2 }}
      getItemLayout={(_: unknown, i: number) => ({ length: STRIP.pitch, offset: STRIP.pitch * i, index: i })}
      initialScrollIndex={Math.max(0, Math.min(prints.length - 1, start))}
      snapToInterval={STRIP.pitch}
      decelerationRate="normal"
      bounces
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      initialNumToRender={16}
      maxToRenderPerBatch={12}
      windowSize={3}
      removeClippedSubviews
      onScroll={onScroll}
      onScrollBeginDrag={() => handlers.current.onBegin()}
      onScrollEndDrag={() => handlers.current.onEndDrag()}
      onMomentumScrollBegin={() => handlers.current.onMomentumBegin()}
      onMomentumScrollEnd={() => handlers.current.onMomentumEnd()}
      onLayout={() => handlers.current.onLayout()}
      testID="darkroom-replay-strip"
      renderItem={({ item, index }: { item: Print; index: number }) => (
        <Cell
          print={item}
          index={index}
          mark={marks.get(index) ?? null}
          scrollX={scrollX}
          reduceMotion={reduceMotion}
          contrast={contrast}
          onPress={press}
        />
      )}
    />
  );
});

/**
 * One frame of the strip: the photograph cropped to 28 × 40 (Photos
 * answers that from its own thumbnails), on the well with a hairline
 * while it comes, kept by its view alone. The frame under the box grows
 * a little as the strip glides it there, on the native driver; not under
 * Reduce Motion.
 */
const Cell = memo(function Cell({
  print,
  index,
  mark,
  scrollX,
  reduceMotion,
  contrast,
  onPress,
}: {
  print: Print;
  index: number;
  mark: string | null;
  scrollX: Animated.Value;
  reduceMotion: boolean;
  contrast: boolean;
  onPress: (index: number) => void;
}) {
  const look = useLook();
  const source = useMemo(() => printSource(print.uri), [print.uri]);
  const scale = useMemo(
    () =>
      reduceMotion
        ? 1
        : scrollX.interpolate({
            inputRange: [(index - 1) * STRIP.pitch, index * STRIP.pitch, (index + 1) * STRIP.pitch],
            outputRange: [1, STRIP.centreScale, 1],
            extrapolate: "clamp",
          }),
    [reduceMotion, scrollX, index],
  );
  return (
    <View style={styles.cell}>
      <View style={styles.markRow} pointerEvents="none">
        {mark ? (
          <View style={styles.mark}>
            <RoomText kind="folio" numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {mark}
            </RoomText>
          </View>
        ) : null}
      </View>
      <Pressable onPress={() => onPress(index)} style={styles.press} testID={`darkroom-replay-cell-${index}`}>
        <Animated.View
          style={[
            styles.frame,
            { backgroundColor: look.room.well, borderColor: contrast ? look.room.lineStrong : look.room.line, transform: [{ scale }] },
          ]}
        >
          {source != null ? (
            <Image
              source={source}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="none"
              recyclingKey={print.id}
              transition={0}
              priority="normal"
              allowDownscaling={false}
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </Animated.View>
      </Pressable>
    </View>
  );
});

const FRAME_INSET = (STRIP.pitch - STRIP.cellW) / 2;

const styles = StyleSheet.create({
  strip: { height: STRIP.marks + MARK_GAP + STRIP.boxH, alignSelf: "center" },
  cell: { width: STRIP.pitch, height: STRIP.marks + MARK_GAP + STRIP.boxH },
  markRow: { height: STRIP.marks, marginBottom: MARK_GAP, overflow: "visible" },
  // Over the first frame of its year or day, running on to the right as far as it needs.
  mark: { position: "absolute", left: FRAME_INSET, top: 0, width: STRIP.pitch * 4, flexDirection: "row" },
  press: { width: STRIP.pitch, height: STRIP.boxH, alignItems: "center", justifyContent: "center" },
  frame: { width: STRIP.cellW, height: STRIP.cellH, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  box: { position: "absolute", top: STRIP.marks + MARK_GAP, width: STRIP.boxW, height: STRIP.boxH, borderWidth: 1.5 },
});
