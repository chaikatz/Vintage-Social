import React, { useMemo, useRef, useState } from "react";
import {
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from "react-native";
import { Image } from "expo-image";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { mediaUrl } from "@/api/media";
import { getFilter } from "@/filters";
import { cssFilterFor } from "@/filters/cssFilter";
import { needsDisplayFilter } from "@/utils/displayFilter";
import { buildTimeline, type TimelineRow } from "@/utils/timeline";
import { aspectRatio } from "./PostMedia";
import { Byline } from "./PostCard";
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

/** How far in and out a pinch can take the line. */
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.4;
/** Two taps closer together than this open the photograph. */
const DOUBLE_TAP_MS = 280;

/**
 * A member's photographs hung off one line, by the day they were taken.
 *
 * The line runs down the middle of the page. Each entry puts the
 * photograph on one side and its words on the other — where and when,
 * then the caption, set large enough to be read as part of the picture
 * rather than as metadata under it — and the next entry swaps sides, so
 * the page reads as a life in pictures. Years are lettered on the line as
 * they pass; a long silence between two photographs is said out loud.
 *
 * Pinch to zoom the whole history: out to survey a decade at a glance, in
 * to read one summer. It is a real re-layout — frames, type and spacing
 * grow together — so nothing goes soft and the list keeps its place. Tap
 * a photograph (or double-tap) to inspect it close, at full resolution,
 * with the platform's own pinch and pan; closing lands exactly where you
 * were on the line.
 */
export function Timeline({ posts, onOpenPost, header, empty, onRefresh, refreshing }: Props) {
  const { width } = useWindowDimensions();
  const rows = useMemo(() => buildTimeline(posts), [posts]);

  const [zoom, setZoom] = useState(1);
  const [pinching, setPinching] = useState(false);
  const pinch = useRef({ startDistance: 0, startZoom: 1, pending: 1, scheduled: false });
  const [inspecting, setInspecting] = useState<PostRow | null>(null);

  // Two fingers are a pinch and are claimed before the list can scroll
  // with them; one finger is left entirely to the list.
  const responder = useMemo(() => {
    const distance = (e: GestureResponderEvent) => {
      const [a, b] = e.nativeEvent.touches;
      if (!a || !b) return 0;
      return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
    };
    const twoFingers = (e: GestureResponderEvent) => e.nativeEvent.touches.length === 2;
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: twoFingers,
      onMoveShouldSetPanResponderCapture: twoFingers,
      onPanResponderGrant: (e) => {
        pinch.current.startDistance = distance(e);
        pinch.current.startZoom = pinch.current.pending;
        setPinching(true);
      },
      onPanResponderMove: (e) => {
        const d = distance(e);
        if (!pinch.current.startDistance || !d) return;
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (pinch.current.startZoom * d) / pinch.current.startDistance));
        pinch.current.pending = next;
        // One layout per frame, however many touch events arrive.
        if (!pinch.current.scheduled) {
          pinch.current.scheduled = true;
          requestAnimationFrame(() => {
            pinch.current.scheduled = false;
            setZoom(pinch.current.pending);
          });
        }
      },
      onPanResponderRelease: () => setPinching(false),
      onPanResponderTerminate: () => setPinching(false),
      onPanResponderTerminationRequest: () => false,
    });
  }, []);

  const resetZoom = () => {
    pinch.current.pending = 1;
    setZoom(1);
  };

  // Each half of the page holds either the photograph or its words. The
  // frame takes most of its half and grows with the zoom until it meets
  // the gutter; the type grows more gently so it stays readable rather
  // than shouting.
  const half = width / 2 - spacing.lg;
  const frame = Math.round(Math.min(half - 10, Math.max(72, half * 0.86 * zoom)));
  const gap = Math.round(spacing.lg * zoom);
  const typeScale = Math.min(1.35, Math.max(0.8, 0.6 + zoom * 0.4));

  return (
    <View style={styles.root} {...responder.panHandlers}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        onRefresh={onRefresh}
        refreshing={refreshing ?? false}
        scrollEnabled={!pinching}
        contentContainerStyle={[styles.list, rows.length > 0 && styles.listWithRows]}
        // Frames are drawn from the grid thumbnail until inspected; the
        // window is kept modest so a long history scrolls without stutter.
        windowSize={7}
        maxToRenderPerBatch={6}
        removeClippedSubviews
        renderItem={({ item }) => (
          <Row
            row={item}
            frame={frame}
            gap={gap}
            typeScale={typeScale}
            onOpenPost={onOpenPost}
            onInspect={setInspecting}
          />
        )}
      />
      {Math.abs(zoom - 1) > 0.05 ? (
        <Pressable style={styles.reset} onPress={resetZoom} hitSlop={8} accessibilityLabel="Back to the overview">
          <Feather name="minimize-2" size={12} color={colors.inkSoft} />
          <Text style={styles.resetText}>Overview</Text>
        </Pressable>
      ) : null}
      <PhotoInspector
        post={inspecting}
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
  typeScale,
  onOpenPost,
  onInspect,
}: {
  row: TimelineRow;
  frame: number;
  gap: number;
  typeScale: number;
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

  // The words: where and when on one line, the caption under it with air
  // around it, set toward the spine so the eye reads line → words.
  const words = (
    <Pressable
      style={[styles.words, left ? styles.wordsRight : styles.wordsLeft]}
      onPress={() => onOpenPost(post)}
      accessibilityRole="button"
    >
      <Byline
        post={post}
        size="large"
        style={[styles.wordsByline, { justifyContent: left ? "flex-start" : "flex-end" }]}
      />
      {caption ? (
        <Text
          style={[
            styles.caption,
            { fontSize: Math.round(16 * typeScale), lineHeight: Math.round(25 * typeScale) },
            left ? styles.textLeft : styles.textRight,
          ]}
          numberOfLines={typeScale > 1.1 ? 8 : 5}
        >
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );

  // The branch meets the frame at its middle; the words sit level with it.
  const armTop = gap + frameHeight / 2;

  return (
    <View style={[styles.row, { paddingVertical: gap }]}>
      <View style={styles.line} />
      <View style={[styles.node, { top: armTop }]} />
      <View style={[styles.half, styles.halfLeft]}>
        {left ? (
          <>
            {picture}
            <View style={[styles.arm, { marginTop: armTop }]} />
          </>
        ) : (
          words
        )}
      </View>
      <View style={[styles.half, styles.halfRight]}>
        {left ? (
          words
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

  words: { flex: 1, paddingTop: 2 },
  // The words sit on the side opposite the picture, hugging the spine.
  wordsRight: { paddingLeft: spacing.md + ARM, paddingRight: spacing.lg, alignItems: "flex-start" },
  wordsLeft: { paddingRight: spacing.md + ARM, paddingLeft: spacing.lg, alignItems: "flex-end" },
  wordsByline: { marginTop: 0 },
  caption: {
    fontFamily: type.serif,
    color: colors.ink,
    marginTop: spacing.sm,
  },
  textLeft: { textAlign: "left" },
  textRight: { textAlign: "right" },

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
