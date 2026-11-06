import React from "react";
import { Dimensions, FlatList, Platform, Pressable, StyleSheet, View, type GestureResponderEvent } from "react-native";
import { Image } from "expo-image";
import Feather from "@expo/vector-icons/Feather";
import { colors } from "@/theme";
import { mediaUrl } from "@/api/media";
import { getFilter } from "@/filters";
import { cssFilterFor } from "@/filters/cssFilter";
import { needsDisplayFilter } from "@/utils/displayFilter";
import { useImageRetry } from "@/media/imageRetry";
import type { PostRow } from "@/types/db";

/** A grid row: the post, and whether it is here because its author tagged you. */
export type GridPost = PostRow & { tagged_in?: boolean };

interface Props {
  posts: GridPost[];
  onOpenPost: (post: GridPost) => void;
  /** Rendered above the grid (profile header). */
  header?: React.ReactElement;
  /** Shown in place of the squares when there are none. */
  empty?: React.ReactElement | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export const GRID_GAP = 2;
/** Screens of squares the grid draws: three either side of the one in view. */
const GRID_SCREENS = 7;

/** The classic three-column square grid. */
export function PhotoGrid({ posts, onOpenPost, header, empty, onRefresh, refreshing }: Props) {
  const size = (Dimensions.get("window").width - GRID_GAP * 2) / 3;
  return (
    <FlatList
      data={posts}
      keyExtractor={(p) => p.id}
      numColumns={3}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      onRefresh={onRefresh}
      refreshing={refreshing ?? false}
      columnWrapperStyle={{ gap: GRID_GAP }}
      contentContainerStyle={{ gap: GRID_GAP, backgroundColor: colors.paper }}
      // Three screens of squares either side of the reader, as an era's
      // sheet draws: the list's default, ten either side, fetched every
      // square of a profile of a few hundred photographs the moment it
      // opened, and held them all.
      windowSize={GRID_SCREENS}
      renderItem={({ item }) => <PhotoTile post={item} size={size} onPress={() => onOpenPost(item)} />}
    />
  );
}

/**
 * One square of the grid: the photograph, or a film's poster, with its
 * small marks. Given a `height` it is a print of other proportions, as the
 * lead of an era is, drawn from the same small copy; and `full`, it is a
 * photograph drawn from itself, over that copy until it is in. A label
 * makes it an image button VoiceOver can name. Held (`onLongPress`), it
 * is a print lifted to be dragged, as an era being arranged lifts one.
 */
export function PhotoTile({
  post,
  size,
  height,
  full,
  onPress,
  onLongPress,
  delayLongPress,
  onPressOut,
  accessibilityLabel,
  accessibilityHint,
}: {
  post: GridPost;
  size: number;
  height?: number;
  /** Drawn too large for the small copy to stay sharp. A film keeps its poster all the same. */
  full?: boolean;
  onPress: () => void;
  /** Held for `delayLongPress`, the print lifts instead of opening; let go sooner, it is a tap as ever. */
  onLongPress?: (e: GestureResponderEvent) => void;
  delayLongPress?: number;
  /** The finger has let go, or the press was taken over (a scroll, a drag). */
  onPressOut?: () => void;
  accessibilityLabel?: string;
  /** What a tap does, when it is not the usual (an era being arranged moves the photograph). */
  accessibilityHint?: string;
}) {
  // A video's square is its poster frame. The media path itself is a
  // movie, which an <Image> cannot draw — so a video with no poster
  // gets a marked placeholder rather than an empty hole in the grid.
  const isVideo = post.media_type === "video";
  const small = isVideo
    ? mediaUrl("thumbnails", post.thumb_path)
    : mediaUrl("thumbnails", post.thumb_path) ?? mediaUrl("media", post.media_path);
  // The small copy stays on screen, at the same fit, until the photograph
  // has come in over it, so nothing blinks or moves.
  const large = full && !isVideo ? mediaUrl("media", post.media_path) : null;
  const url = large ?? small;
  // A square that fails to load is asked for again rather than left empty (src/media/imageRetry.ts).
  const retry = useImageRetry(url);
  // Same rule as the feed: only unbaked media needs the filter applied
  // here, so a square matches the photograph it opens.
  const live = needsDisplayFilter(post) ? cssFilterFor(getFilter(post.filter_id)).filter : null;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      // The browser counts a hold from 50 ms after the touch (its own
      // delayPressIn, which React Native's Pressable does not name); held to
      // lift, it counts from the touch, as a phone does.
      {...(onLongPress && Platform.OS === "web" ? ({ delayPressIn: 0 } as object) : null)}
      onPressOut={onPressOut}
      style={{ width: size, height: height ?? size }}
      accessibilityRole={accessibilityLabel ? "imagebutton" : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {url ? (
        <Image
          source={url}
          placeholder={large ? small : undefined}
          placeholderContentFit="cover"
          style={[styles.cell, live ? ({ filter: live } as object) : null]}
          contentFit="cover"
          transition={60}
          // Held in memory as well as on disk, as the feed's photographs
          // are: the grid draws three screens either side and lets the rest
          // go, and a square scrolled back to was read from disk and
          // decoded again, blinking in with its fade.
          cachePolicy="memory-disk"
          key={retry.attempt}
          onError={retry.onError}
        />
      ) : (
        <View style={[styles.cell, styles.empty]}>
          {isVideo ? <Feather name="film" size={18} color={colors.inkFaint} /> : null}
        </View>
      )}
      {isVideo ? (
        <View style={styles.videoBadge}>
          <Feather name="play" size={11} color="#FFFFFF" />
        </View>
      ) : null}
      {post.tagged_in ? (
        <View style={[styles.videoBadge, styles.tagBadge]}>
          <Feather name="user" size={10} color="#FFFFFF" />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: { flex: 1, backgroundColor: colors.paperSunken },
  empty: {
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  tagBadge: { top: undefined, bottom: 5, left: 5, right: undefined },
  videoBadge: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20, 15, 10, 0.45)",
  },
});
