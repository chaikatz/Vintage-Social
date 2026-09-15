import React, { useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Image } from "expo-image";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { mediaUrl } from "@/api/media";
import { getFilter } from "@/filters";
import { cssFilterFor } from "@/filters/cssFilter";
import { needsDisplayFilter } from "@/utils/displayFilter";
import { shortDate } from "@/utils/time";
import { buildTimeline, type TimelineRow } from "@/utils/timeline";
import { aspectRatio } from "./PostMedia";
import { PhotoInspector } from "./PhotoInspector";
import type { PostRow } from "@/types/db";

interface Props {
  posts: PostRow[];
  onOpenPost: (post: PostRow) => void;
  /** Rendered above the line (profile header). */
  header?: React.ReactElement;
  empty?: React.ReactElement | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

/** How far a pinch can take the line, in and out. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
/** Two taps closer together than this open the photograph. */
const DOUBLE_TAP_MS = 280;

/**
 * A member's photographs hung off one line, by the day they were taken.
 *
 * The line runs down the middle of the page. Each entry puts the
 * photograph on one side and its words on the other — where, when, and
 * the caption, one under the other on one left edge — and the next entry
 * swaps sides, so the page reads as a life in pictures. Years are
 * lettered on the line as they pass; a long silence between two
 * photographs is said out loud.
 *
 * Pinch magnifies the line, or shrinks it to survey more of it, about the
 * point between your fingers; the profile above it is not touched. It is
 * a transform on the block of rows, nothing more: no row is laid out
 * again, and no native scroll view is ever zoomed. The last point matters
 * — the platform recycles scroll views between screens, and one left at a
 * zoom other than 1 carried that zoom into the grid, the send sheet and
 * anywhere else a list was drawn next. Letting go leaves the line where it
 * is until you pinch back or tap "Actual size". Tap a photograph to see
 * it close, and swipe on from there to the next one along the line.
 */
export function Timeline({ posts, onOpenPost, header, empty, onRefresh, refreshing }: Props) {
  const { width } = useWindowDimensions();
  const rows = useMemo(() => buildTimeline(posts), [posts]);

  // The photographs alone, in the order they hang, for paging through them close.
  const photos = useMemo(() => rows.flatMap((r) => (r.kind === "post" ? [r.post] : [])), [rows]);
  const [inspecting, setInspecting] = useState<number | null>(null);
  const inspect = (post: PostRow) => {
    const i = photos.findIndex((p) => p.id === post.id);
    setInspecting(i < 0 ? null : i);
  };

  // Each half of the page holds either the photograph or its words. The
  // frame takes most of its half; the size is set once and stays.
  const half = width / 2 - spacing.lg;
  const frame = Math.round(half * 0.86);
  const gap = spacing.lg;

  // --- the pinch -----------------------------------------------------------
  const scroll = useRef<ScrollView>(null);
  const root = useRef<View>(null);
  const rootTop = useRef(0); // where the scroll view starts on the screen
  const scrollY = useRef(0); // how far the page is scrolled
  const blockTop = useRef(0); // where the rows begin, within the page
  const [measured, setMeasured] = useState(false);
  // The block's unscaled height, its scale, and its sideways shift. Animated
  // values so the pinch moves the native props frame by frame without a
  // single row rendering again.
  const base = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const shift = useRef(new Animated.Value(0)).current;
  const live = useRef({ scale: 1, shift: 0 }).current;
  const pinch = useRef({ distance: 0, scale: 1, cx: 0, cy: 0 }).current;
  const [pinching, setPinching] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const responder = useMemo(() => {
    const twoFingers = (e: GestureResponderEvent) => e.nativeEvent.touches.length === 2;
    const read = (e: GestureResponderEvent) => {
      const [a, b] = e.nativeEvent.touches;
      if (!a || !b) return null;
      return {
        distance: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
        fx: (a.pageX + b.pageX) / 2,
        fy: (a.pageY + b.pageY) / 2 - rootTop.current,
      };
    };
    return PanResponder.create({
      // Two fingers are a pinch and are claimed before the page can scroll
      // with them; one finger is left entirely to the page.
      onStartShouldSetPanResponderCapture: twoFingers,
      onMoveShouldSetPanResponderCapture: twoFingers,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const t = read(e);
        if (!t) return;
        pinch.distance = t.distance;
        pinch.scale = live.scale;
        // The point of the line under the fingers, in the block's own
        // unscaled coordinates — it stays under them as the scale changes.
        pinch.cx = (t.fx - width / 2 - live.shift) / live.scale;
        pinch.cy = (scrollY.current + t.fy - blockTop.current) / live.scale;
        setPinching(true);
      },
      onPanResponderMove: (e) => {
        const t = read(e);
        if (!t || !pinch.distance) return;
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (pinch.scale * t.distance) / pinch.distance));
        // Sideways: only as far as the line has grown past the page edges.
        const room = Math.max(0, (width * next - width) / 2);
        const nextShift = Math.min(room, Math.max(-room, t.fx - width / 2 - pinch.cx * next));
        live.scale = next;
        live.shift = nextShift;
        scale.setValue(next);
        shift.setValue(nextShift);
        // Up and down: the page scrolls so the same point stays under the fingers.
        const y = Math.max(0, blockTop.current + pinch.cy * next - t.fy);
        scroll.current?.scrollTo({ y, animated: false });
      },
      onPanResponderRelease: () => {
        setPinching(false);
        setZoomed(Math.abs(live.scale - 1) > 0.02);
      },
      onPanResponderTerminate: () => {
        setPinching(false);
        setZoomed(Math.abs(live.scale - 1) > 0.02);
      },
    });
  }, [width, base, scale, shift, live, pinch]);

  const actualSize = () => {
    live.scale = 1;
    live.shift = 0;
    Animated.parallel([
      Animated.timing(scale, { toValue: 1, duration: 220, useNativeDriver: false }),
      Animated.timing(shift, { toValue: 0, duration: 220, useNativeDriver: false }),
    ]).start();
    setZoomed(false);
  };

  // The scaled block keeps the page the right length: its wrapper is as
  // tall as the rows are at this scale, and the rows are drawn from its
  // top, scaled about the spine.
  const blockHeight = Animated.multiply(base, scale);
  const settle = Animated.divide(Animated.multiply(base, Animated.subtract(scale, 1)), 2);

  return (
    <View
      ref={root}
      style={styles.root}
      {...responder.panHandlers}
      onLayout={() => {
        // Measured on screen: where the page begins, for the pinch's arithmetic.
        root.current?.measureInWindow((_x, y) => {
          rootTop.current = y;
        });
      }}
    >
      <ScrollView
        ref={scroll}
        style={styles.root}
        contentContainerStyle={[styles.list, rows.length > 0 && styles.listWithRows]}
        scrollEnabled={!pinching}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={colors.inkFaint as unknown as string} />
          ) : undefined
        }
      >
        {header}
        {rows.length === 0 ? (
          empty
        ) : (
          <Animated.View
            style={[styles.block, measured ? { height: blockHeight } : null]}
            onLayout={(e) => {
              blockTop.current = e.nativeEvent.layout.y;
            }}
          >
            <Animated.View
              style={{ width, transform: [{ translateX: shift }, { translateY: settle }, { scale }] }}
              onLayout={(e) => {
                const h = e.nativeEvent.layout.height;
                if (h > 0) {
                  base.setValue(h);
                  if (!measured) setMeasured(true);
                }
              }}
            >
              {rows.map((row) => (
                <Row key={row.key} row={row} frame={frame} gap={gap} onOpenPost={onOpenPost} onInspect={inspect} />
              ))}
            </Animated.View>
          </Animated.View>
        )}
      </ScrollView>
      {zoomed ? (
        <Pressable style={styles.reset} onPress={actualSize} hitSlop={8} accessibilityLabel="Back to actual size">
          <Feather name="minimize-2" size={12} color={colors.inkSoft} />
          <Text style={styles.resetText}>Actual size</Text>
        </Pressable>
      ) : null}
      <PhotoInspector
        posts={photos}
        index={inspecting}
        onClose={() => setInspecting(null)}
        onOpenPost={(p) => {
          setInspecting(null);
          onOpenPost(p);
        }}
      />
    </View>
  );
}

function Row({
  row,
  frame,
  gap,
  onOpenPost,
  onInspect,
}: {
  row: TimelineRow;
  frame: number;
  gap: number;
  onOpenPost: (post: PostRow) => void;
  onInspect: (post: PostRow) => void;
}) {
  const lastTap = useRef(0);
  if (row.kind === "year") {
    return (
      <View style={styles.marker}>
        <View style={styles.line} />
        <Text style={styles.year}>{row.year}</Text>
      </View>
    );
  }
  if (row.kind === "gap") {
    return (
      <View style={styles.gap}>
        <View style={styles.gapLine} />
        <Text style={styles.gapText}>{row.label}</Text>
      </View>
    );
  }

  const { post, side } = row;
  const isVideo = post.media_type === "video";
  const url = isVideo
    ? mediaUrl("thumbnails", post.thumb_path)
    : mediaUrl("thumbnails", post.thumb_path) ?? mediaUrl("media", post.media_path);
  const live = needsDisplayFilter(post) ? cssFilterFor(getFilter(post.filter_id)).filter : null;
  const ratio = aspectRatio(post.width, post.height);
  const frameHeight = Math.round(frame / ratio);
  const left = side === "left";
  const place = post.location?.trim() || null;
  const caption = post.caption?.trim() || null;

  // One tap inspects the picture; a second within a beat does the same,
  // so a double-tap never falls through to anything else.
  const tap = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    onInspect(post);
  };

  const picture = (
    <Pressable
      onPress={tap}
      onLongPress={() => onOpenPost(post)}
      style={[styles.frame, { width: frame, height: frameHeight }]}
      accessibilityRole="imagebutton"
      accessibilityLabel={caption ?? "Photograph"}
    >
      {url ? (
        <Image
          source={url}
          style={[StyleSheet.absoluteFill, live ? ({ filter: live } as object) : null]}
          contentFit="cover"
          transition={80}
          cachePolicy="memory-disk"
          recyclingKey={post.id}
        />
      ) : null}
      {isVideo ? (
        <View style={styles.videoBadge}>
          <Feather name="play" size={10} color="#FFFFFF" />
        </View>
      ) : null}
    </Pressable>
  );

  // The words: where, when, and what was said, one under the other on a
  // single left edge, whichever side of the line they sit. The block is as
  // tall as the frame across from it and the lines sit in its middle, so
  // the branch that reaches them meets them at their centre, as the
  // branch on the other side meets the photograph at its centre.
  const words = (
    <Pressable
      style={[styles.words, { minHeight: frameHeight }, left ? styles.wordsRight : styles.wordsLeft]}
      onPress={() => onOpenPost(post)}
      accessibilityRole="button"
    >
      <View style={styles.wordsBlock}>
        {place ? (
          <Text style={styles.place} numberOfLines={1}>
            {place}
          </Text>
        ) : null}
        <Text style={styles.date}>{shortDate(post.taken_at ?? post.created_at)}</Text>
        {caption ? (
          <Text style={styles.caption} numberOfLines={5}>
            {caption}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  // Two branches leave the one node: one to the middle of the frame, one
  // to the middle of the words.
  const armTop = frameHeight / 2;

  return (
    <View style={[styles.row, { paddingVertical: gap }]}>
      <View style={styles.line} />
      <View style={[styles.node, { top: gap + armTop }]} />
      <View style={[styles.half, styles.halfLeft]}>
        {left ? (
          <>
            {picture}
            <View style={[styles.arm, { marginTop: armTop }]} />
          </>
        ) : (
          <>
            {words}
            <View style={[styles.arm, styles.armCentred]} />
          </>
        )}
      </View>
      <View style={[styles.half, styles.halfRight]}>
        {left ? (
          <>
            <View style={[styles.arm, styles.armCentred]} />
            {words}
          </>
        ) : (
          <>
            <View style={[styles.arm, { marginTop: armTop }]} />
            {picture}
          </>
        )}
      </View>
    </View>
  );
}

const ARM = 10;

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingBottom: spacing.xxl },
  listWithRows: { paddingBottom: spacing.xxl * 2 },
  // Whatever the scale, the block clips to its own height so the rows never
  // draw over the profile above or past the end of the page.
  block: { overflow: "hidden" },

  // The spine. Every row draws its own segment, so the line is exactly as
  // long as the page and needs no measuring.
  line: {
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    width: 1,
    marginLeft: -0.5,
    backgroundColor: colors.borderStrong,
  },
  node: {
    position: "absolute",
    left: "50%",
    width: 7,
    height: 7,
    marginLeft: -3.5,
    marginTop: -3,
    borderRadius: 4,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.ink,
  },
  arm: { width: ARM, height: 1, backgroundColor: colors.borderStrong },
  // The branch to the words: level with the middle of however many lines there are.
  armCentred: { alignSelf: "center" },

  row: { flexDirection: "row", alignItems: "flex-start" },
  half: { flex: 1, flexDirection: "row", alignItems: "flex-start" },
  halfLeft: { justifyContent: "flex-end" },
  halfRight: { justifyContent: "flex-start" },

  frame: {
    backgroundColor: colors.paperSunken,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  videoBadge: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20, 15, 10, 0.45)",
  },

  words: { flex: 1, justifyContent: "center" },
  // The words sit on the side opposite the picture, a step off the branch.
  wordsRight: { paddingLeft: spacing.md, paddingRight: spacing.lg },
  wordsLeft: { paddingRight: spacing.md, paddingLeft: spacing.lg },
  // Every line starts on the same left edge, on either side of the line.
  wordsBlock: { alignItems: "flex-start" },
  place: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  date: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.inkFaint,
    marginTop: 4,
  },
  caption: {
    fontFamily: type.serif,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
    marginTop: spacing.sm,
    textAlign: "left",
  },

  marker: { alignItems: "center", paddingVertical: spacing.sm },
  year: {
    fontFamily: type.serif,
    fontSize: 16,
    letterSpacing: 1,
    color: colors.ink,
    backgroundColor: colors.paper,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },

  gap: { alignItems: "center", paddingVertical: spacing.sm },
  gapLine: {
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    width: 1,
    marginLeft: -0.5,
    borderLeftWidth: 1,
    borderStyle: "dotted",
    borderColor: colors.borderStrong,
    backgroundColor: "transparent",
  },
  gapText: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.inkFaint,
    backgroundColor: colors.paper,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },

  reset: {
    position: "absolute",
    bottom: spacing.lg,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.paperRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  resetText: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
});
