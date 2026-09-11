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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** How far in and out a pinch can take the line. */
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.2;

/**
 * A member's photographs hung off one line, by the day they were taken.
 *
 * The line runs down the middle of the page. Each photograph sits at the
 * end of a short branch to one side of it, the next one to the other,
 * with the day it was taken written along the branch and the place under
 * it — so the page reads as a life in pictures rather than a log of
 * posts. Years are lettered on the line as they pass, and a long silence
 * between two photographs is said out loud instead of hidden.
 *
 * Pinch to zoom: the frames grow and the line stretches with them, so a
 * decade can be read at a glance or one summer looked at closely. It is a
 * real re-layout, not a scaled screenshot, so nothing goes soft.
 */
export function Timeline({ posts, onOpenPost, header, empty, onRefresh, refreshing }: Props) {
  const { width } = useWindowDimensions();
  const rows = useMemo(() => buildTimeline(posts), [posts]);

  const [zoom, setZoom] = useState(1);
  const [pinching, setPinching] = useState(false);
  const pinch = useRef({ startDistance: 0, startZoom: 1, pending: 1, scheduled: false });

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

  // Each half of the page holds a frame at its outer edge and the branch
  // filling the rest of the way to the spine. Zooming in grows the frame
  // until the branch is just long enough to carry its words, and stretches
  // the spacing on, so time itself opens up; zooming out does the reverse.
  const half = width / 2 - spacing.lg - 6;
  const frame = Math.round(Math.min(half - 40, Math.max(64, half * 0.75 * zoom)));
  const branch = Math.round(half - frame);
  const gap = Math.round(spacing.md * zoom);

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
        renderItem={({ item }) => (
          <Row row={item} branch={branch} frame={frame} gap={gap} onOpenPost={onOpenPost} />
        )}
      />
    </View>
  );
}

function Row({
  row,
  branch,
  frame,
  gap,
  onOpenPost,
}: {
  row: TimelineRow;
  branch: number;
  frame: number;
  gap: number;
  onOpenPost: (post: PostRow) => void;
}) {
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

  const { post, side, date } = row;
  const isVideo = post.media_type === "video";
  const url = isVideo
    ? mediaUrl("thumbnails", post.thumb_path)
    : mediaUrl("thumbnails", post.thumb_path) ?? mediaUrl("media", post.media_path);
  const live = needsDisplayFilter(post) ? cssFilterFor(getFilter(post.filter_id)).filter : null;
  const ratio = aspectRatio(post.width, post.height);
  const stamp = `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  const place = post.location?.trim() || null;
  const left = side === "left";

  const frameHeight = Math.round(frame / ratio);
  // The branch meets the frame at its middle; the words hang under the
  // frame, set toward the spine so the eye reads line → picture → words.
  const armTop = gap + frameHeight / 2;

  const picture = (
    <View style={[styles.column, { width: frame }, left ? styles.columnLeft : styles.columnRight]}>
      <Pressable
        onPress={() => onOpenPost(post)}
        style={[styles.frame, { width: frame, height: frameHeight }]}
        accessibilityRole="imagebutton"
        accessibilityLabel={place ? `${stamp}, ${place}` : stamp}
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
      <Text style={[styles.date, left ? styles.textLeft : styles.textRight]} numberOfLines={1}>
        {stamp}
      </Text>
      {place ? (
        <Text style={[styles.place, left ? styles.textLeft : styles.textRight]} numberOfLines={1}>
          {place}
        </Text>
      ) : null}
    </View>
  );

  const arm = <View style={[styles.armLine, { width: branch, marginTop: armTop }]} />;

  return (
    <View style={[styles.row, { paddingVertical: gap }]}>
      <View style={styles.line} />
      <View style={[styles.node, { top: armTop }]} />
      <View style={[styles.half, styles.halfLeft]}>
        {left ? (
          <>
            {picture}
            {arm}
          </>
        ) : null}
      </View>
      <View style={[styles.half, styles.halfRight]}>
        {!left ? (
          <>
            {arm}
            {picture}
          </>
        ) : null}
      </View>
    </View>
  );
}

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

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  half: { flex: 1, flexDirection: "row", alignItems: "flex-start" },
  halfLeft: { justifyContent: "flex-end" },
  halfRight: { justifyContent: "flex-start" },

  column: { gap: 3 },
  columnLeft: { alignItems: "flex-end" },
  columnRight: { alignItems: "flex-start" },
  armLine: { height: 1, backgroundColor: colors.borderStrong },
  date: {
    marginTop: 3,
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  place: {
    fontSize: 11,
    color: colors.inkFaint,
  },
  textLeft: { textAlign: "right" },
  textRight: { textAlign: "left" },

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

  marker: { alignItems: "center", paddingVertical: spacing.sm },
  year: {
    fontFamily: type.serif,
    fontSize: 15,
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
});
