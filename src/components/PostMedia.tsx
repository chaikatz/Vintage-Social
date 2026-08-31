import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors } from "@/theme";
import { mediaUrl, mediaUrlString } from "@/api/media";
import { getFilter } from "@/filters";
import { cssFilterFor } from "@/filters/cssFilter";
import { DEMO_PREFIX } from "@/demo/photos";
import { DateStamp } from "./DateStamp";
import type { PostRow } from "@/types/db";

/**
 * Anything published through the app has its filter baked into the pixels
 * at compose time, so the feed renders stored media untouched. The only
 * exception is the bundled demo library: those photographs ship unfiltered,
 * so the post's filter_id is approximated at display time to make the
 * seeded world read the way a real one would.
 */
function needsDisplayFilter(mediaPath: string): boolean {
  return mediaPath.startsWith(DEMO_PREFIX);
}

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

  // Every filter can carry the stamp; the post alone decides.
  const stamp = post.show_date_stamp ? <DateStamp iso={post.created_at} /> : null;

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
  const web = needsDisplayFilter(post.media_path) ? cssFilterFor(getFilter(post.filter_id)) : null;
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
