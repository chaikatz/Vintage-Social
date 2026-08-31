import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors } from "@/theme";
import { mediaUrl, mediaUrlString } from "@/api/media";
import { isDemoMode } from "@/lib/env";
import { filterSupportsDateStamp, getFilter } from "@/filters";
import { cssFilterFor } from "@/filters/cssFilter";
import { DateStamp } from "./DateStamp";
import type { PostRow } from "@/types/db";

/**
 * On iOS the filter is baked into the uploaded JPEG, so feeds show media
 * as stored. In browser demo mode the placeholder photos are unfiltered,
 * so the stored filter_id is applied at display time with the CSS
 * approximation — the feed reads the way it would with real baked media.
 */
const APPLY_DISPLAY_FILTER = Platform.OS === "web" && isDemoMode();

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
  const web = APPLY_DISPLAY_FILTER ? cssFilterFor(getFilter(post.filter_id)) : null;
  return (
    <Pressable onPress={handlePress} style={[styles.media, { aspectRatio: ratio }]}>
      {url ? (
        <Image
          source={url}
          style={[StyleSheet.absoluteFill, web ? ({ filter: web.filter } as object) : null]}
          contentFit="cover"
          transition={120}
        />
      ) : null}
      {web?.fadeOverlay ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: web.fadeOverlay }]} />
      ) : null}
      {web?.tintOverlay ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: web.tintOverlay }]} />
      ) : null}
      {web?.vignetteBoxShadow ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { boxShadow: web.vignetteBoxShadow } as object]}
        />
      ) : null}
      {stamp}
    </Pressable>
  );
}

function VideoMedia({ path }: { path: string }) {
  const url = mediaUrlString("media", path) ?? "";
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
