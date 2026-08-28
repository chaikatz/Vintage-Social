import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors } from "@/theme";
import { mediaUrl } from "@/api/media";
import { filterSupportsDateStamp } from "@/filters";
import { DateStamp } from "./DateStamp";
import type { PostRow } from "@/types/db";

interface Props {
  post: Pick<
    PostRow,
    "media_type" | "media_path" | "thumb_path" | "width" | "height" | "filter_id" | "show_date_stamp" | "created_at"
  >;
  onDoubleTap?: () => void;
}

// Clamp between 4:5 portrait and 1.91:1 landscape, like classic photo feeds.
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 1.91;

function aspectRatio(width: number | null, height: number | null): number {
  if (!width || !height) return 1;
  return Math.min(Math.max(width / height, MIN_RATIO), MAX_RATIO);
}

/**
 * The photograph itself — full-bleed within the card, optional amber date
 * stamp. Videos live inline here exactly like photos: muted, looping, no
 * special chrome and no separate discovery surface.
 */
export function PostMedia({ post, onDoubleTap }: Props) {
  const lastTap = React.useRef(0);
  const handlePress = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) onDoubleTap?.();
    lastTap.current = now;
  };

  const stamp =
    post.show_date_stamp && filterSupportsDateStamp(post.filter_id) ? (
      <DateStamp iso={post.created_at} />
    ) : null;

  const ratio = aspectRatio(post.width, post.height);

  if (post.media_type === "video") {
    return (
      <View style={[styles.media, { aspectRatio: ratio }]}>
        <VideoMedia path={post.media_path} />
        {stamp}
      </View>
    );
  }

  const url = mediaUrl("media", post.media_path);
  return (
    <Pressable onPress={handlePress} style={[styles.media, { aspectRatio: ratio }]}>
      {url ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
      ) : null}
      {stamp}
    </Pressable>
  );
}

function VideoMedia({ path }: { path: string }) {
  const url = mediaUrl("media", path) ?? "";
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  const toggleMute = () => {
    player.muted = !player.muted;
  };
  return (
    <Pressable onPress={toggleMute} style={StyleSheet.absoluteFill}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  media: {
    width: "100%",
    backgroundColor: colors.paperSunken,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
});
