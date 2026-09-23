import React from "react";
import { Dimensions, FlatList, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import Feather from "@expo/vector-icons/Feather";
import { colors } from "@/theme";
import { mediaUrl } from "@/api/media";
import { getFilter } from "@/filters";
import { cssFilterFor } from "@/filters/cssFilter";
import { needsDisplayFilter } from "@/utils/displayFilter";
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
      renderItem={({ item }) => <PhotoTile post={item} size={size} onPress={() => onOpenPost(item)} />}
    />
  );
}

/** One square of the grid: the photograph, or a film's poster, with its small marks. */
export function PhotoTile({ post, size, onPress }: { post: GridPost; size: number; onPress: () => void }) {
  // A video's square is its poster frame. The media path itself is a
  // movie, which an <Image> cannot draw — so a video with no poster
  // gets a marked placeholder rather than an empty hole in the grid.
  const isVideo = post.media_type === "video";
  const url = isVideo
    ? mediaUrl("thumbnails", post.thumb_path)
    : mediaUrl("thumbnails", post.thumb_path) ?? mediaUrl("media", post.media_path);
  // Same rule as the feed: only unbaked media needs the filter applied
  // here, so a square matches the photograph it opens.
  const live = needsDisplayFilter(post) ? cssFilterFor(getFilter(post.filter_id)).filter : null;
  return (
    <Pressable onPress={onPress} style={{ width: size, height: size }}>
      {url ? (
        <Image
          source={url}
          style={[styles.cell, live ? ({ filter: live } as object) : null]}
          contentFit="cover"
          transition={60}
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
