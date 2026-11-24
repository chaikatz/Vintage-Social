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

/** One frame of the strip: a print, or the blank frame after the last of them. */
type Frame = { kind: "print"; print: Print } | { kind: "tail" };

export interface StripHandle {
  /** The frame under the box: glided to, or a cut. */
  scrollTo(index: number, animated: boolean): void;
}

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

/**
 * The glide strip: Photos' sliding bar, set as a strip cut from a contact
 * sheet, under the caption on every page of the room. Every photograph of
 * the chapter is a small frame, in the chapter's order, with a blank frame
 * after the last for the end page (or the title card while more is
 * dealt), so frame and page are counted alike. A flick glides with
 * momentum and comes to rest on a frame. The frame at the centre grows a
 * little inside a box fixed over the middle, drawn in the accent as a
 * photographer marks a contact sheet in grease pencil, and the strip
 * glides under it. Along its top edge, as film is edge-printed, the year,
 * the day or the month where each begins (`edgeMarks`).
 *
 * It is a list that never draws again as it moves: what it shows moves
 * by its own scroll, through `scrollTo`, which is how it follows the
 * pages. A finger on it is a glide (`onScrubStart`), the frame under the
 * box is handed on as it changes (`onScrubTo`, at most once a frame), and
 * the frame it comes to rest on is handed on once (`onScrubEnd`). A tapped
 * frame is handed on as itself (`onCell`). Its own moves never count as
 * the member's: on the phone they never begin with a drag, and in the
 * browser, where there are no drag events, its own moves are cuts to an
 * offset it knows, so any other is the member's. How many frames there
 * are is read as each event comes, so a batch dealt onto its end while a
 * finger glides never makes its handlers anew.
 *
 * It glides silently, with no haptics, and is hidden from VoiceOver: the
 * stage's own adjustable element turns the pages, and the strip follows.
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
      /** The glide has come to rest on this frame. */
      onScrubEnd: (index: number) => void;
      /** A frame tapped: straight to it. The blank frame is `prints.length`. */
      onCell: (index: number) => void;
    }
  >(function ReplayStrip({ prints, start, marks, width, onScrubStart, onScrubTo, onScrubEnd, onCell }, ref) {
    const look = useLook();
    const list = useRef<FlatList<Frame>>(null);
    /** The frames: the prints and the blank one after them. */
    const count = useRef(prints.length + 1);
    count.current = prints.length + 1;
    const scrollX = useRef(new Animated.Value(start * STRIP.pitch)).current;
    /** Where the room last asked the strip to be. */
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
    const on = useRef({ onScrubStart, onScrubTo, onScrubEnd });
    on.current = { onScrubStart, onScrubTo, onScrubEnd };
    const end = () => {
      clear();
      if (!driving.current) return;
      driving.current = false;
      on.current.onScrubEnd(stripIndex(glidedTo.current, count.current));
    };
    const begin = () => {
      clear();
      if (driving.current) return;
      driving.current = true;
      on.current.onScrubStart();
    };
    /** Where a finger's glide stopped, as the list says as it ends. */
    const restAt = (e: ScrollEvent | undefined) => {
      const x = e?.nativeEvent?.contentOffset?.x;
      if (driving.current && typeof x === "number" && Number.isFinite(x)) glidedTo.current = x;
    };

    useImperativeHandle(
      ref,
      () => ({
        scrollTo(index: number, animated: boolean) {
          // The room moves the strip for something else (a page turned, a frame tapped): a glide of the
          // member's is over. A set offset can stop UIKit's deceleration with no momentum end to say so, and a
          // glide left driving would take the room's own next glide for a finger's.
          end();
          const offset = Math.max(0, Math.min(count.current - 1, index)) * STRIP.pitch;
          asked.current = offset;
          list.current?.scrollToOffset({ offset, animated });
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const onScroll = useMemo(
      () =>
        Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: true,
          listener: (e: ScrollEvent) => {
            const x = e.nativeEvent.contentOffset.x;
            if (Platform.OS === "web") {
              // Not where the room put it: the member moved it.
              if (!driving.current && Math.abs(x - asked.current) < 1) return;
              begin();
              glidedTo.current = x;
              on.current.onScrubTo(stripIndex(x, count.current));
              webTimer.current = setTimeout(() => {
                webTimer.current = null;
                const offset = stripIndex(x, count.current) * STRIP.pitch;
                asked.current = offset;
                glidedTo.current = offset;
                list.current?.scrollToOffset({ offset, animated: false });
                end();
              }, WEB_SETTLE_MS);
              return;
            }
            // Only a finger's glide reads the frame: the room's own glides are already where it wants them.
            if (!driving.current) return;
            glidedTo.current = x;
            on.current.onScrubTo(stripIndex(x, count.current));
          },
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [scrollX],
    );

    return (
      <View
        style={[styles.strip, { width }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID="darkroom-glide-strip-row"
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
          onEndDrag={(e) => {
            restAt(e);
            if (endTimer.current) clearTimeout(endTimer.current);
            endTimer.current = setTimeout(end, END_DRAG_MS);
          }}
          onMomentumBegin={() => {
            if (endTimer.current) clearTimeout(endTimer.current);
            endTimer.current = null;
          }}
          onMomentumEnd={(e) => {
            restAt(e);
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
          testID="darkroom-glide-box"
        />
      </View>
    );
  }),
);

/** The list itself: drawn again only when the chapter's prints, its marks or the page's width change. */
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
  listRef: React.RefObject<FlatList<Frame> | null>;
  prints: readonly Print[];
  start: number;
  marks: ReadonlyMap<number, string>;
  width: number;
  scrollX: Animated.Value;
  reduceMotion: boolean;
  contrast: boolean;
  onScroll: (...args: unknown[]) => void;
  onBegin: () => void;
  onEndDrag: (e: ScrollEvent) => void;
  onMomentumBegin: () => void;
  onMomentumEnd: (e: ScrollEvent) => void;
  onLayout: () => void;
  onCell: (index: number) => void;
}) {
  // Read when called, so the cells never draw again for a new handler.
  const handlers = useRef({ onBegin, onEndDrag, onMomentumBegin, onMomentumEnd, onLayout, onCell });
  handlers.current = { onBegin, onEndDrag, onMomentumBegin, onMomentumEnd, onLayout, onCell };
  const press = useMemo(() => (i: number) => handlers.current.onCell(i), []);
  const data = useMemo<Frame[]>(() => [...prints.map((print) => ({ kind: "print" as const, print })), { kind: "tail" as const }], [prints]);
  return (
    <Animated.FlatList
      ref={listRef as React.RefObject<FlatList<Frame>>}
      data={data}
      horizontal
      keyExtractor={(f: Frame) => (f.kind === "print" ? f.print.id : "tail")}
      // The side padding is left out on purpose: a frame's offset is then
      // exactly the scroll offset that puts it under the box.
      contentContainerStyle={{ paddingHorizontal: (width - STRIP.pitch) / 2 }}
      getItemLayout={(_: unknown, i: number) => ({ length: STRIP.pitch, offset: STRIP.pitch * i, index: i })}
      initialScrollIndex={Math.max(0, Math.min(data.length - 1, start))}
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
      onScrollEndDrag={(e: ScrollEvent) => handlers.current.onEndDrag(e)}
      onMomentumScrollBegin={() => handlers.current.onMomentumBegin()}
      onMomentumScrollEnd={(e: ScrollEvent) => handlers.current.onMomentumEnd(e)}
      onLayout={() => handlers.current.onLayout()}
      testID="darkroom-glide-strip"
      renderItem={({ item, index }: { item: Frame; index: number }) =>
        item.kind === "print" ? (
          <Cell
            print={item.print}
            index={index}
            mark={marks.get(index) ?? null}
            scrollX={scrollX}
            reduceMotion={reduceMotion}
            contrast={contrast}
            onPress={press}
          />
        ) : (
          <TailCell index={index} scrollX={scrollX} reduceMotion={reduceMotion} contrast={contrast} onPress={press} />
        )
      }
    />
  );
});

/** The frame under the box grows a little as the strip glides it there, on the native driver; not under Reduce Motion. */
function useCentreScale(scrollX: Animated.Value, index: number, reduceMotion: boolean) {
  return useMemo(
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
}

/**
 * One frame of the strip: the photograph cropped to 28 × 40 (Photos
 * answers that from its own thumbnails), on the well with a hairline
 * while it comes, kept by its view alone.
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
  const scale = useCentreScale(scrollX, index, reduceMotion);
  return (
    <View style={styles.cell}>
      <View style={styles.markRow} pointerEvents="none">
        {mark ? (
          <View style={styles.mark} testID={`darkroom-glide-mark-${index}`}>
            <RoomText kind="folio" numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {mark}
            </RoomText>
          </View>
        ) : null}
      </View>
      <Pressable onPress={() => onPress(index)} style={styles.press} testID={`darkroom-glide-cell-${index}`}>
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

/**
 * The blank frame after the last print: the end page's, or the title
 * card's while more is being dealt. The paper inside a hairline, with no
 * photograph and no mark.
 */
const TailCell = memo(function TailCell({
  index,
  scrollX,
  reduceMotion,
  contrast,
  onPress,
}: {
  index: number;
  scrollX: Animated.Value;
  reduceMotion: boolean;
  contrast: boolean;
  onPress: (index: number) => void;
}) {
  const look = useLook();
  const scale = useCentreScale(scrollX, index, reduceMotion);
  return (
    <View style={styles.cell}>
      <View style={styles.markRow} pointerEvents="none" />
      <Pressable onPress={() => onPress(index)} style={styles.press} testID="darkroom-glide-tail">
        <Animated.View
          style={[
            styles.frame,
            { backgroundColor: look.room.page, borderColor: contrast ? look.room.lineStrong : look.room.line, transform: [{ scale }] },
          ]}
        />
      </Pressable>
    </View>
  );
});

const FRAME_INSET = (STRIP.pitch - STRIP.cellW) / 2;

const styles = StyleSheet.create({
  strip: { height: STRIP.marks + MARK_GAP + STRIP.boxH, alignSelf: "center" },
  cell: { width: STRIP.pitch, height: STRIP.marks + MARK_GAP + STRIP.boxH },
  markRow: { height: STRIP.marks, marginBottom: MARK_GAP, overflow: "visible" },
  // Over the first frame of its year, day or month, running on to the right as far as it needs.
  mark: { position: "absolute", left: FRAME_INSET, top: 0, width: STRIP.pitch * 4, flexDirection: "row" },
  press: { width: STRIP.pitch, height: STRIP.boxH, alignItems: "center", justifyContent: "center" },
  frame: { width: STRIP.cellW, height: STRIP.cellH, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  box: { position: "absolute", top: STRIP.marks + MARK_GAP, width: STRIP.boxW, height: STRIP.boxH, borderWidth: 1.5 },
});
