import React, { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type Animated,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Image, type ImageErrorEventData } from "expo-image";
import { printSource } from "@/darkroom/printSource";
import type { Print } from "@/darkroom/types";
import { Blades } from "./Blades";
import { Caption } from "./Caption";
import {
  asksAgain,
  captionHeight,
  captionWidth,
  feedCrops,
  groupTop,
  plateBox,
  plateTrouble,
  troubleOffline,
  ratioOf,
} from "./geometry";
import { useLook } from "./look";
import { room } from "./room";
import { RoomText } from "./Type";
import { placeholderWords, type PlateTrouble } from "./words";

/** The soft proof is this wide, scaled up to the plate. */
const PROOF_WIDTH = 48;
/** Past this the plate counts as zoomed in, and a tap on it turns no page. */
const ZOOMED = 1.02;
const DISSOLVE = { duration: 240, effect: "cross-dissolve", timing: "ease-out" } as const;

/**
 * One print: a plate, and its caption hung beneath.
 *
 * The well is sized from the library's own numbers before a pixel
 * arrives, filled with the well colour and framed by a hairline, so
 * nothing moves when the photograph does arrive. It arrives in two steps.
 * First the soft proof (decision 24): the same photograph asked for at
 * 48 pt and scaled up to the plate, which Photos answers at once from the
 * thumbnail it keeps on the phone, so the print develops out of a soft
 * version of itself and never flashes empty. Then the full image,
 * dissolving in over 240 ms (none for a print already drawn this visit,
 * which comes from memory), after which the proof is unmounted. Only the
 * current page and the next have a proof.
 *
 * Why the proof cannot poison the full image's cache. For a `ph://`
 * source expo-image (3.0, `ios/ImageView.swift`) always resizes early: it
 * puts the view's own bounds × screen scale into SDWebImage's context as
 * `imageThumbnailPixelSize`, and SDWebImage's `cacheKeyForURL:context:`
 * appends that thumbnail size to the cache key. So a 48 pt proof and a
 * 361 pt plate of the same URI are two entries under two keys, and
 * `PhotoLibraryAssetLoader` asks Photos for each at its own target size.
 * The one moment they could meet is a view's very first load before
 * layout, when the bounds are still zero and both keys would read
 * {0,0}. To leave no doubt the proof is given `cachePolicy="none"`: it
 * never reads or writes the memory cache at all, so whatever the full
 * image finds there is the full image. Photos keeps the thumbnail on the
 * phone, so asking again costs nothing to speak of. The full image is
 * kept in memory only (`cachePolicy="memory"`): nothing from the camera
 * roll is written to the app's disk cache. A `ph://` URI is never
 * prefetched: without a frame the loader asks Photos for the maximum
 * size.
 *
 * The plate zooms under a pinch, 1–2×, inside its own box (PhotoInspector's
 * ZoomablePhoto, with no double-tap, so a single tap has no delay), and
 * goes back to actual size when the page stops being current, and again
 * as it is taken off screen. At actual size it does not move at all under
 * a drag. A tap on its right half turns to the next print and on its left
 * half to the one before (`tapTurn`), except while it is zoomed in; the
 * room's words stay where they are throughout. Under the editor,
 * neighbours draw their well only, so one full decode is live behind it.
 *
 * When the photograph cannot be drawn the plate says why, in the well:
 * gone from the library, waiting for the phone to be online (it tries
 * again when it is), or anything else, which stays said until the phone
 * has been offline and is back, or the library changes (`plateTrouble`
 * and `asksAgain` in geometry.ts). Expo-image's error text names the
 * asset, so it is never shown or logged — only matched.
 */
export interface PrintPageProps {
  print: Print;
  width: number;
  stageHeight: number;
  fontScale: number;
  pixelRatio: number;
  /** The settled page. */
  current: boolean;
  /** The current page or the next: worth a soft proof. */
  proof: boolean;
  /** Draw the photograph at all (neighbours under the editor do not). */
  images: boolean;
  /** Dissolve the full image in. */
  dissolve: boolean;
  /** The library changed: a print that failed to draw tries again. */
  revision: number;
  online: boolean;
  limited: boolean;
  /** The library says this photograph has gone (deleted, or no longer shared): the plate says so in place. */
  gone: boolean;
  label: string;
  line: string;
  /** The second line carries "· posted in …": two lines of type. */
  long: boolean;
  progress: { fraction: Animated.Value | null } | null;
  wordLabel: string | null;
  wordOn: boolean;
  wordInert: boolean;
  wordHint?: string;
  /** A develop state is showing: the plate keeps its size whatever the caption says. */
  holdLayout: boolean;
  bladesClosed: boolean;
  /** A tap on the photograph: how far across the page the finger lifted, and whether the plate was zoomed in. */
  onTap: (x: number, zoomed: boolean) => void;
  onDate: (print: Print) => void;
  onWord: (print: Print) => void;
  onLoad: (id: string) => void;
  onGone: (id: string) => void;
}

export const PrintPage = memo(function PrintPage(props: PrintPageProps) {
  const {
    print,
    width,
    stageHeight,
    fontScale,
    pixelRatio,
    current,
    holdLayout,
    long,
  } = props;
  const look = useLook();
  const ratio = ratioOf(print);
  const [measured, setMeasured] = useState<number | null>(null);
  const caption = measured ?? captionHeight(fontScale, long ? 2 : 1);
  const box = plateBox(ratio, width, stageHeight, caption, pixelRatio);
  const top = groupTop(stageHeight, box.height, caption);
  const captionW = captionWidth(box.width);

  // A new type size or a new second line is measured afresh.
  const measuredFor = useRef(`${fontScale}:${long}`);
  if (measuredFor.current !== `${fontScale}:${long}`) {
    measuredFor.current = `${fontScale}:${long}`;
    if (measured != null) setMeasured(null);
  }

  return (
    <View style={{ width, height: stageHeight }}>
      <View
        style={[styles.plate, { top, left: (width - box.width) / 2, width: box.width, height: box.height }]}
        testID={current ? "darkroom-plate" : undefined}
      >
        <Zoom box={box} current={current} onTap={props.onTap}>
          <Photograph {...props} box={box} />
        </Zoom>
        {feedCrops(ratio) ? <Blades plate={box} ratio={ratio} closed={props.bladesClosed} /> : null}
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.hairline, { borderColor: look.contrast ? room.lineStrong : room.line }]}
        />
      </View>
      <View style={[styles.caption, { top: top + box.height, left: (width - captionW) / 2 }]}>
        <Caption
          width={captionW}
          label={props.label}
          line={props.line}
          progress={props.progress}
          word={props.wordLabel ? { label: props.wordLabel, on: props.wordOn, inert: props.wordInert, hint: props.wordHint } : null}
          onDate={() => props.onDate(print)}
          onWord={() => props.onWord(print)}
          onHeight={(h) => {
            if (holdLayout) return;
            if (Math.abs(h - caption) >= 1) setMeasured(Math.round(h));
          }}
          testID={current ? "darkroom-caption" : undefined}
        />
      </View>
    </View>
  );
});

/**
 * The plate's own scroll view: a pinch zooms the print inside its box, and
 * nowhere else. A tap is handed on with where the finger lifted across the
 * page — `pageX`, not `locationX`, which is measured from whichever view
 * was touched, and over a plate that says why it has no photograph that
 * is the line of type — and whether the print is zoomed in.
 */
function Zoom({
  box,
  current,
  onTap,
  children,
}: {
  box: { width: number; height: number };
  current: boolean;
  onTap: (x: number, zoomed: boolean) => void;
  children: React.ReactNode;
}) {
  const scroll = useRef<ScrollView>(null);
  const zoomed = useRef(false);
  const latestBox = useRef(box);
  latestBox.current = box;
  // A page swiped away from goes back to actual size while still on screen.
  useEffect(() => {
    if (current || !zoomed.current) return;
    zoomed.current = false;
    actualSize(scroll.current, box);
  }, [current, box.width, box.height]);
  // And a plate taken off screen goes back too, whatever the throttled
  // scroll events last said. Fabric recycles a scroll view, and its
  // prepareForRecycle puts back the offset but not the zoomed content's
  // transform or size, so whichever plate or list is handed this one next
  // would draw its contents shifted and pan over empty well. A layout
  // effect's cleanup runs before the view is deleted, and its command
  // reaches the view ahead of the deletion.
  useLayoutEffect(() => {
    const view = scroll.current;
    return () => actualSize(view, latestBox.current);
  }, []);
  const readZoom = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    zoomed.current = (e.nativeEvent.zoomScale ?? 1) > ZOOMED;
  };

  return (
    <ScrollView
      ref={scroll}
      style={StyleSheet.absoluteFill}
      contentContainerStyle={{ width: box.width, height: box.height }}
      minimumZoomScale={1}
      maximumZoomScale={2}
      bouncesZoom
      // At actual size the print fills its box exactly, so a drag has
      // nothing to show; without these a vertical scroll view still
      // rubber-bands, and the photograph slides under its hairline (§5.4).
      alwaysBounceVertical={false}
      alwaysBounceHorizontal={false}
      centerContent
      scrollsToTop={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      onScroll={readZoom}
      // A pinch ends here, at the scale it settled on, which the throttled
      // scroll events may not have caught: let go back at actual size, the
      // next tap turns the page.
      onScrollEndDrag={readZoom}
      scrollEventThrottle={100}
    >
      <Pressable
        onPress={(e: GestureResponderEvent) => onTap(e.nativeEvent.pageX, zoomed.current)}
        style={{ width: box.width, height: box.height }}
        accessible={false}
      >
        {children}
      </Pressable>
    </ScrollView>
  );
}

/**
 * Back to actual size at once, at the origin. Only iOS zooms a scroll
 * view. The second argument is the one React Native reads: `animated`
 * inside the rect only spares the deprecation warning.
 */
function actualSize(view: ScrollView | null, box: { width: number; height: number }) {
  if (Platform.OS !== "ios" || view == null) return;
  view.scrollResponderZoomTo({ x: 0, y: 0, width: box.width, height: box.height, animated: false }, false);
}

/** The well, the proof, the photograph — or the words that say why there is none. */
function Photograph(props: PrintPageProps & { box: { width: number; height: number } }) {
  const { print, box, images, proof, current, dissolve, revision, online, limited, gone, onLoad, onGone } = props;
  const look = useLook();
  const [trouble, setTrouble] = useState<PlateTrouble | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [drawn, setDrawn] = useState(false);

  // The library changed, or the phone came back online: a print that
  // could not be drawn is asked for again. Never because it failed while
  // online, or it would be asked for again forever.
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    if (trouble) {
      setTrouble(null);
      setAttempt((a) => a + 1);
    }
  }, [revision, trouble]);
  const wasOnline = useRef(online);
  useEffect(() => {
    const recast = troubleOffline(trouble, wasOnline.current, online);
    const again = asksAgain(trouble, wasOnline.current, online);
    wasOnline.current = online;
    if (recast !== trouble) {
      setTrouble(recast);
      return;
    }
    if (again) {
      setTrouble(null);
      setAttempt((a) => a + 1);
    }
  }, [online, trouble]);

  if (trouble || gone) {
    const why: PlateTrouble = gone ? "missing" : (trouble ?? "missing");
    const words = placeholderWords(why, limited);
    return (
      <View style={[styles.well, styles.placeholder]}>
        <RoomText kind="small" maxFontSizeMultiplier={1.5} style={styles.center}>
          {words.line1}
        </RoomText>
        <RoomText kind="foot" maxFontSizeMultiplier={1.5} style={[styles.center, styles.placeholderLine]}>
          {words.line2}
        </RoomText>
      </View>
    );
  }

  const source = printSource(print.uri);
  const ratio = ratioOf(print);
  const proofHeight = PROOF_WIDTH / ratio;
  return (
    <View style={styles.well}>
      {images && source != null && proof && !drawn ? (
        <View style={styles.proofSlot} pointerEvents="none">
          <View style={{ width: PROOF_WIDTH, height: proofHeight, transform: [{ scale: box.width / PROOF_WIDTH }] }}>
            <Image
              source={source}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="none"
              transition={0}
              accessibilityIgnoresInvertColors
            />
          </View>
        </View>
      ) : null}
      {images && source != null ? (
        <Image
          key={`${print.id}:${attempt}`}
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory"
          recyclingKey={print.id}
          priority={current ? "high" : "low"}
          transition={dissolve && !look.reduceMotion ? DISSOLVE : 0}
          onLoad={() => {
            setDrawn(true);
            onLoad(print.id);
          }}
          onError={(e: ImageErrorEventData) => {
            const why = plateTrouble(e?.error, online);
            setTrouble(why);
            if (why === "missing") onGone(print.id);
          }}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  plate: { position: "absolute", overflow: "hidden", backgroundColor: room.well },
  hairline: { borderWidth: StyleSheet.hairlineWidth },
  well: { flex: 1, backgroundColor: room.well, overflow: "hidden" },
  proofSlot: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  placeholder: { alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  placeholderLine: { marginTop: 6 },
  center: { textAlign: "center" },
  caption: { position: "absolute" },
});
