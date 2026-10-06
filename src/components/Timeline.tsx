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
import { holdTabSwipe } from "@/utils/tabSwipe";
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
 * point between your fingers sideways and from the top of the line down;
 * the page is never scrolled by it, so the profile above is not touched. It is
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
  // How far the zoomed line has been pulled up past its own top edge (never
  // positive). A pinch keeps the point between the fingers under them in
  // both directions; what that pushes above the line's top is clipped
  // there, under the profile, rather than moving the profile — and a
  // finger dragged down brings it back.
  const lift = useRef(new Animated.Value(0)).current;
  const baseHeight = useRef(0);
  const live = useRef({ scale: 1, shift: 0, lift: 0 }).current;
  const pinch = useRef({ distance: 0, scale: 1, cx: 0, cy: 0 }).current;
  // One finger on a zoomed line drags it; this is where the drag began.
  const drag = useRef({ active: false, shift: 0, lift: 0 }).current;
  const [pinching, setPinching] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  // The tab pager reads any sideways movement as a swipe to the next tab,
  // and took the pinch's with it: the whole screen shifted and sometimes
  // changed tabs. While the line is on screen the pager is held still, so
  // every gesture here belongs to the line alone.
  React.useEffect(() => {
    if (rows.length === 0) return;
    return holdTabSwipe();
  }, [rows.length]);

  const sidewaysRoom = (atScale: number) => Math.max(0, (width * atScale - width) / 2);
  const clampShift = (value: number, atScale: number) => {
    const room = sidewaysRoom(atScale);
    return Math.min(room, Math.max(-room, value));
  };
  // Never below zero (the line cannot start below its own top) and never
  // more than the line has grown, so at actual size it sits exactly where it did.
  const clampLift = (value: number, atScale: number) => Math.min(0, Math.max(-Math.max(0, baseHeight.current * (atScale - 1)), value));

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
    // A pinch is claimed only when both fingers are on the line itself —
    // the rows below the profile header. Fingers on the header, the counts
    // or the view switch are left to the page: a pinch that began there
    // used to zoom the line and jump the page beneath the profile.
    const onTheLine = (e: GestureResponderEvent) => {
      const touches = e.nativeEvent.touches;
      if (touches.length === 0) return false;
      const top = Math.min(...touches.map((t) => t.pageY)) - rootTop.current + scrollY.current;
      return top >= blockTop.current;
    };
    const pinchStart = (e: GestureResponderEvent) => twoFingers(e) && onTheLine(e);
    // A zoomed line is dragged sideways with one finger — a drag that is
    // clearly across rather than down the page, so scrolling stays the page's.
    const dragStart = (e: GestureResponderEvent, g: { dx: number; dy: number }) =>
      e.nativeEvent.touches.length === 1 &&
      live.scale > 1.02 &&
      onTheLine(e) &&
      ((Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.3) ||
        // Down, when there is line hidden above to bring back; up is the page's.
        (g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.3 && live.lift < -1));
    return PanResponder.create({
      // Two fingers on the line are a pinch and are claimed before the page
      // can scroll with them; one finger is the page's, unless the line is
      // zoomed and the finger is plainly moving across it.
      onStartShouldSetPanResponderCapture: pinchStart,
      onMoveShouldSetPanResponderCapture: (e, g) => pinchStart(e) || dragStart(e, g),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        shift.stopAnimation((v: number) => {
          live.shift = v;
        });
        lift.stopAnimation((v: number) => {
          live.lift = v;
        });
        if (!twoFingers(e)) {
          drag.active = true;
          drag.shift = live.shift;
          drag.lift = live.lift;
          setPinching(true);
          return;
        }
        drag.active = false;
        const t = read(e);
        if (!t) return;
        pinch.distance = t.distance;
        pinch.scale = live.scale;
        // The point of the line under the fingers, in the line's own
        // unscaled coordinates. It stays under them as the scale changes:
        // sideways by shifting, up and down by lifting — never by scrolling
        // the page, so the profile above does not move.
        pinch.cx = (t.fx - width / 2 - live.shift) / live.scale;
        pinch.cy = (scrollY.current + t.fy - blockTop.current - live.lift) / live.scale;
        setPinching(true);
      },
      onPanResponderMove: (e, g) => {
        if (drag.active) {
          if (e.nativeEvent.touches.length !== 1) return;
          live.shift = clampShift(drag.shift + g.dx, live.scale);
          live.lift = clampLift(drag.lift + g.dy, live.scale);
          shift.setValue(live.shift);
          lift.setValue(live.lift);
          return;
        }
        const t = read(e);
        if (!t || !pinch.distance) return;
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (pinch.scale * t.distance) / pinch.distance));
        // Sideways: only as far as the line has grown past the page edges.
        const nextShift = clampShift(t.fx - width / 2 - pinch.cx * next, next);
        const nextLift = clampLift(scrollY.current + t.fy - blockTop.current - pinch.cy * next, next);
        live.scale = next;
        live.shift = nextShift;
        live.lift = nextLift;
        scale.setValue(next);
        shift.setValue(nextShift);
        lift.setValue(nextLift);
      },
      onPanResponderRelease: (_e, g) => {
        if (drag.active) {
          drag.active = false;
          // Let go with a flick and the line carries on a little, settling
          // inside its room rather than stopping dead under the finger.
          const targetShift = clampShift(live.shift + g.vx * 160, live.scale);
          const targetLift = clampLift(live.lift + g.vy * 160, live.scale);
          live.shift = targetShift;
          live.lift = targetLift;
          Animated.parallel([
            Animated.spring(shift, { toValue: targetShift, velocity: g.vx, damping: 26, stiffness: 180, mass: 0.9, useNativeDriver: false }),
            Animated.spring(lift, { toValue: targetLift, velocity: g.vy, damping: 26, stiffness: 180, mass: 0.9, useNativeDriver: false }),
          ]).start();
        }
        setPinching(false);
        setZoomed(Math.abs(live.scale - 1) > 0.02);
      },
      onPanResponderTerminate: () => {
        drag.active = false;
        setPinching(false);
        setZoomed(Math.abs(live.scale - 1) > 0.02);
      },
    });
  }, [width, base, scale, shift, lift, live, pinch, drag]);

  const actualSize = () => {
    live.scale = 1;
    live.shift = 0;
    live.lift = 0;
    Animated.parallel([
      Animated.timing(scale, { toValue: 1, duration: 220, useNativeDriver: false }),
      Animated.timing(shift, { toValue: 0, duration: 220, useNativeDriver: false }),
      Animated.timing(lift, { toValue: 0, duration: 220, useNativeDriver: false }),
    ]).start();
    setZoomed(false);
  };

  // The scaled block keeps the page the right length: its wrapper is as
  // tall as the rows are at this scale, and the rows are drawn from its
  // top, scaled about the spine.
  const blockHeight = Animated.add(Animated.multiply(base, scale), lift);
  const settle = Animated.add(Animated.divide(Animated.multiply(base, Animated.subtract(scale, 1)), 2), lift);

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
        directionalLockEnabled
        alwaysBounceHorizontal={false}
        horizontal={false}
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
                  baseHeight.current = h;
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
