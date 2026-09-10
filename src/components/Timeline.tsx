import React, { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
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

/**
 * A member's photographs hung off one line, by the day they were taken.
 *
 * The line runs down the middle of the page. Each photograph sits at the
 * end of a short branch to one side of it, the next one to the other,
 * with the capture date written along the branch — so the page reads as
 * a life in pictures rather than a log of posts. Years are lettered on
 * the line as they pass, and a long silence between two photographs is
 * said out loud instead of hidden.
 */
export function Timeline({ posts, onOpenPost, header, empty, onRefresh, refreshing }: Props) {
  const { width } = useWindowDimensions();
  const rows = useMemo(() => buildTimeline(posts), [posts]);
  // The branch is a quarter of the page; the frame takes the rest of its
  // half, with a small margin so a landscape frame never touches the edge.
  const branch = Math.round(width * 0.11);
  const frame = Math.round(width / 2 - branch - spacing.lg - 6);

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.key}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      onRefresh={onRefresh}
      refreshing={refreshing ?? false}
      contentContainerStyle={[styles.list, rows.length > 0 && styles.listWithRows]}
      renderItem={({ item }) => <Row row={item} branch={branch} frame={frame} onOpenPost={onOpenPost} />}
    />
  );
}

function Row({
  row,
  branch,
  frame,
  onOpenPost,
}: {
  row: TimelineRow;
  branch: number;
  frame: number;
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
  const stamp = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  const left = side === "left";

  const picture = (
    <Pressable
      onPress={() => onOpenPost(post)}
      style={[styles.frame, { width: frame, aspectRatio: ratio }]}
      accessibilityRole="imagebutton"
      accessibilityLabel={`${stamp}, ${date.getFullYear()}`}
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

  // The branch: a hairline from the spine to the frame, the date set along
  // it on the spine side so the eye reads line → date → picture.
  const arm = (
    <View style={[styles.arm, { width: branch }, left ? styles.armLeft : styles.armRight]}>
      <View style={styles.armLine} />
      <Text style={[styles.date, left ? styles.dateLeft : styles.dateRight]} numberOfLines={1}>
        {stamp}
      </Text>
    </View>
  );

  return (
    <View style={styles.row}>
      <View style={styles.line} />
      <View style={styles.node} />
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
    top: "50%",
    width: 7,
    height: 7,
    marginLeft: -3.5,
    marginTop: -3.5,
    borderRadius: 4,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.ink,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  half: { flex: 1, flexDirection: "row", alignItems: "center" },
  halfLeft: { justifyContent: "flex-end" },
  halfRight: { justifyContent: "flex-start" },

  arm: { justifyContent: "center" },
  armLeft: { alignItems: "flex-start" },
  armRight: { alignItems: "flex-end" },
  armLine: { width: "100%", height: 1, backgroundColor: colors.borderStrong },
  date: {
    position: "absolute",
    top: -15,
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  dateLeft: { right: 6 },
  dateRight: { left: 6 },

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
