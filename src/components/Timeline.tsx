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

/** How far in a pinch can go. Out is where it started. */
const ZOOM_MAX = 3;
/** Two taps closer together than this open the photograph. */
const DOUBLE_TAP_MS = 280;

/** The spine's distance from the left edge, and how far the entries sit right of it. */
const SPINE_X = spacing.lg + 4;
const ARM = 14;
const INDENT = SPINE_X + ARM + spacing.sm;

/**
 * A member's photographs hung off one line, by the day they were taken.
 *
 * The line runs down the left of the page. Every entry hangs to its right
 * at one set size — the photograph, and under it, all on the same left
 * edge, where it was taken, when, and what the member said about it.
 * Years are lettered on the line as they pass; a long silence between two
 * photographs is said out loud.
 *
 * Nothing here moves when you pinch. The page is a print: pinching
 * magnifies it where your fingers are, the way a photograph magnifies,
 * and letting go leaves it there until you pinch back out or tap
 * "Actual size". Tap a photograph to see it close, at full resolution.
 */
export function Timeline({ posts, onOpenPost, header, empty, onRefresh, refreshing }: Props) {
  const { width } = useWindowDimensions();
  const rows = useMemo(() => buildTimeline(posts), [posts]);
  const [inspecting, setInspecting] = useState<PostRow | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const scroll = useRef<ScrollView>(null);

  // One set size: the frame takes the width to the right of the spine,
  // less a margin, so a photograph is a photograph and not a thumbnail.
  const frame = Math.round(width - INDENT - spacing.lg * 1.5);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const z = e.nativeEvent.zoomScale ?? 1;
    const next = z > 1.02;
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
        contentContainerStyle={styles.list}
        minimumZoomScale={1}
        maximumZoomScale={ZOOM_MAX}
        bouncesZoom
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
          {rows.length === 0 ? (
            empty
          ) : (
            <View style={styles.page}>
              {rows.map((row) => (
                <Row key={row.key} row={row} frame={frame} onOpenPost={onOpenPost} onInspect={setInspecting} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      {zoomed ? (
        <Pressable style={styles.reset} onPress={actualSize} hitSlop={8} accessibilityLabel="Back to actual size">
          <Feather name="minimize-2" size={12} color={colors.inkSoft} />
          <Text style={styles.resetText}>Actual size</Text>
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
  onOpenPost,
  onInspect,
}: {
  row: TimelineRow;
  frame: number;
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

  const { post } = row;
  const isVideo = post.media_type === "video";
  const url = isVideo
    ? mediaUrl("thumbnails", post.thumb_path)
    : mediaUrl("thumbnails", post.thumb_path) ?? mediaUrl("media", post.media_path);
  const live = needsDisplayFilter(post) ? cssFilterFor(getFilter(post.filter_id)).filter : null;
  const ratio = aspectRatio(post.width, post.height);
  const frameHeight = Math.round(frame / ratio);
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

  return (
    <View style={styles.row}>
      <View style={styles.line} />
      {/* The branch: a node on the spine, an arm to the frame's top edge. */}
      <View style={[styles.node, { top: spacing.lg + 8 }]} />
      <View style={[styles.arm, { top: spacing.lg + 11 }]} />

      <View style={styles.entry}>
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

        {/* The words, one under the other, all on the frame's left edge:
            where, when, and what was said. */}
        <Pressable style={[styles.words, { width: frame }]} onPress={() => onOpenPost(post)} accessibilityRole="button">
          {place ? (
            <Text style={styles.place} numberOfLines={1}>
              {place}
            </Text>
          ) : null}
          <Text style={styles.date}>{shortDate(post.taken_at ?? post.created_at)}</Text>
          {caption ? (
            <Text style={styles.caption} numberOfLines={6}>
              {caption}
            </Text>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingBottom: spacing.xxl * 2 },
  page: { paddingTop: spacing.sm },

  // The spine. Every row draws its own segment, so the line is exactly as
  // long as the page and needs no measuring.
  line: {
    position: "absolute",
    left: SPINE_X,
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.borderStrong,
  },
  node: {
    position: "absolute",
    left: SPINE_X - 3,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.ink,
  },
  arm: { position: "absolute", left: SPINE_X + 4, width: ARM + spacing.sm - 4, height: 1, backgroundColor: colors.borderStrong },

  row: { paddingVertical: spacing.lg },
  entry: { paddingLeft: INDENT },

  frame: {
    backgroundColor: colors.paperSunken,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  videoBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20, 15, 10, 0.45)",
  },

  words: { paddingTop: spacing.md, alignItems: "flex-start" },
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

  marker: { paddingLeft: INDENT, paddingVertical: spacing.sm },
  year: {
    fontFamily: type.serif,
    fontSize: 16,
    letterSpacing: 1,
    color: colors.ink,
    alignSelf: "flex-start",
  },

  gap: { paddingLeft: INDENT, paddingVertical: spacing.sm },
  gapLine: {
    position: "absolute",
    left: SPINE_X,
    top: 0,
    bottom: 0,
    width: 1,
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
    alignSelf: "flex-start",
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
