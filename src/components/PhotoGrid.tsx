import React from "react";
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors } from "@/theme";
import { mediaUrl } from "@/api/media";
import type { PostRow } from "@/types/db";

interface Props {
  posts: PostRow[];
  onOpenPost: (post: PostRow) => void;
  /** Rendered above the grid (profile header). */
  header?: React.ReactElement;
  onRefresh?: () => void;
  refreshing?: boolean;
}

const GAP = 2;

/** The classic three-column square grid. */
export function PhotoGrid({ posts, onOpenPost, header, onRefresh, refreshing }: Props) {
  const size = (Dimensions.get("window").width - GAP * 2) / 3;
  return (
    <FlatList
      data={posts}
      keyExtractor={(p) => p.id}
      numColumns={3}
      ListHeaderComponent={header}
      onRefresh={onRefresh}
      refreshing={refreshing ?? false}
      columnWrapperStyle={{ gap: GAP }}
      contentContainerStyle={{ gap: GAP, backgroundColor: colors.paper }}
      renderItem={({ item }) => {
        const url = mediaUrl("thumbnails", item.thumb_path) ?? mediaUrl("media", item.media_path);
        return (
          <Pressable onPress={() => onOpenPost(item)} style={{ width: size, height: size }}>
            {url ? (
              <Image source={url} style={styles.cell} contentFit="cover" transition={60} />
            ) : (
              <View style={[styles.cell, styles.empty]} />
            )}
            {item.media_type === "video" ? <Text style={styles.videoBadge}>▶</Text> : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  cell: { flex: 1, backgroundColor: colors.paperSunken },
  empty: { borderWidth: 1, borderColor: colors.border },
  videoBadge: {
    position: "absolute",
    top: 6,
    right: 8,
    color: "#FFFFFF",
    fontSize: 12,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 4,
  },
});
