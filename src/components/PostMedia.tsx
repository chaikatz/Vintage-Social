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
import { FilterOverlay } from "./FilterOverlay";
import type { PostRow } from "@/types/db";

/**
 * Which media still needs its filter applied at display time.
 *
 * A photograph published through the app is baked at compose time, so it
 * arrives already filtered. Two kinds aren't: the bundled demo library,
 * which ships as plain photographs, and video — burning a filter into
 * footage needs a transcode VINTAGE doesn't do yet, so a video's filter is
 * applied live on every play.
 */
function needsDisplayFilter(post: Pick<PostRow, "media_type" | "media_path">): boolean {
  return post.media_type === "video" || post.media_path.startsWith(DEMO_PREFIX);
}

interface Props {
  post: Pick<
    PostRow,
    | "media_type"
    | "media_path"
    | "thumb_path"
    | "width"
    | "height"
    | "filter_id"
    | "show_date_stamp"
    | "taken_at"
    | "created_at"
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

  // Every filter can carry the stamp; the post alone decides. It reads the
  // capture date, falling back to the posting time for files that carried
  // no EXIF.
  const stamp = post.show_date_stamp ? (
    <DateStamp iso={post.taken_at ?? post.created_at} />
  ) : null;

  const ratio = aspectRatio(post.width, post.height);
  const filter = getFilter(post.filter_id);
  const live = needsDisplayFilter(post) ? cssFilterFor(filter) : null;

  if (post.media_type === "video") {
    return (
      <View style={[styles.media, { aspectRatio: ratio }]}>
        <VideoMedia path={post.media_path} cssFilter={live?.filter ?? null} />
        {live ? <FilterOverlay filter={filter} /> : null}
        {stamp}
      </View>
    );
  }

  const url = mediaUrl("media", post.media_path);
  return (
    <Pressable onPress={handlePress} style={[styles.media, { aspectRatio: ratio }]}>
      {url ? (
        <Image
          source={url}
          style={[StyleSheet.absoluteFill, live ? ({ filter: live.filter } as object) : null]}
          contentFit="cover"
          transition={120}
        />
      ) : null}
      {live ? <FilterOverlay filter={filter} /> : null}
      {stamp}
    </Pressable>
  );
}

function VideoMedia({ path, cssFilter }: { path: string; cssFilter: string | null }) {
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
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFill, cssFilter ? ({ filter: cssFilter } as object) : null]}
        contentFit="cover"
        nativeControls={false}
      />
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
