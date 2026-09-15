import React, { useMemo, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
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

/** How far a pinch can take the page, in and out. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
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
 * Nothing here moves when you pinch. The page is a print: pinching
 * magnifies it where your fingers are, the way a photograph magnifies,
 * or shrinks it to survey more of the line, and letting go leaves it
 * there until you pinch back or tap "Actual size". Tap a photograph to
 * see it close, at full resolution, and swipe on from there to the next
 * one along the line; closing lands exactly where you were.
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
  const [zoomed, setZoomed] = useState(false);
  const scroll = useRef<ScrollView>(null);

  // Each half of the page holds either the photograph or its words. The
  // frame takes most of its half; the size is set once and stays.
  const half = width / 2 - spacing.lg;
  const frame = Math.round(half * 0.86);
  const gap = spacing.lg;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.abs((e.nativeEvent.zoomScale ?? 1) - 1) > 0.02;
    if (next !== zoomed) setZoomed(next);
  };
  const actualSize = () => {
    scroll.current?.scrollResponderZoomTo({ x: 0, y: 0, width, height: 1, animated: true });
    setZoomed(false);
  };

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scroll}
        style={styles.root}
        contentContainerStyle={[styles.list, rows.length > 0 && styles.listWithRows]}
        minimumZoomScale={ZOOM_MIN}
        maximumZoomScale={ZOOM_MAX}
        bouncesZoom
        // Shrunk below the page, the print sits in the middle rather than
        // in a corner.
        centerContent
        // A pinch zooms the print; nothing is laid out again.
        pinchGestureEnabled
        onScroll={onScroll}
        scrollEventThrottle={120}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={colors.inkFaint as unknown as string} />
          ) : undefined
        }
      >
        {/* One child: the page. The scroll view zooms this as a whole. */}
        <View style={{ width }}>
          {header}
          {rows.length === 0
            ? empty
            : rows.map((row) => (
                <Row key={row.key} row={row} frame={frame} gap={gap} onOpenPost={onOpenPost} onInspect={inspect} />
              ))}
        </View>
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
    fontSize: 16,
    lineHeight: 24,
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
