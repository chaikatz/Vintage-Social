import React from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import Feather from "@expo/vector-icons/Feather";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors, radii, spacing } from "@/theme";
import { mediaUrl, mediaUrlString } from "@/api/media";
import { getFilter } from "@/filters";
import { cssFilterFor } from "@/filters/cssFilter";
import { needsDisplayFilter } from "@/utils/displayFilter";
import { useVideoMuted, toggleVideoMuted } from "@/utils/videoSound";
import { DateStamp } from "./DateStamp";
import { FilterOverlay } from "./FilterOverlay";
import type { PostRow } from "@/types/db";

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
  /**
   * Whether this card is the one on screen. Only the active card's video
   * plays; everything else is paused. Defaults to true for the surfaces
   * that show a single photograph.
   */
  active?: boolean;
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
 * stamp, and the heart that blooms when you double-tap it.
 */
export function PostMedia({ post, onDoubleTap, active = true }: Props) {
  const lastTap = React.useRef(0);
  const heart = React.useRef(new Animated.Value(0)).current;

  const bloom = React.useCallback(() => {
    heart.setValue(0);
    Animated.sequence([
      Animated.timing(heart, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.back(2)),
        useNativeDriver: true,
      }),
      Animated.delay(420),
      Animated.timing(heart, {
        toValue: 0,
        duration: 260,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [heart]);

  const handlePress = React.useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0; // a third tap shouldn't fire it again
      bloom();
      onDoubleTap?.();
      return;
    }
    lastTap.current = now;
  }, [bloom, onDoubleTap]);

  // Every filter can carry the stamp; the post alone decides. It reads the
  // capture date, falling back to the posting time for files that carried
  // no EXIF.
  const stamp = post.show_date_stamp ? (
    <DateStamp iso={post.taken_at ?? post.created_at} />
  ) : null;

  const ratio = aspectRatio(post.width, post.height);
  const filter = getFilter(post.filter_id);
  const live = needsDisplayFilter(post) ? cssFilterFor(filter) : null;

  // The heart is deliberately quiet: warm white, soft-edged, gone in a
  // second. It confirms the like without turning into a firework.
  const heartOverlay = (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.heart,
        {
          opacity: heart.interpolate({ inputRange: [0, 1], outputRange: [0, 0.92] }),
          transform: [
            { scale: heart.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
          ],
        },
      ]}
    >
      <MaterialCommunityIcons name="heart" size={92} color={colors.paperRaised} />
    </Animated.View>
  );

  if (post.media_type === "video") {
    return (
      <View style={[styles.media, { aspectRatio: ratio }]}>
        <VideoMedia
          path={post.media_path}
          poster={post.thumb_path}
          cssFilter={live?.filter ?? null}
          active={active}
          onPress={handlePress}
        />
        {live ? <FilterOverlay filter={filter} /> : null}
        {stamp}
        {heartOverlay}
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
      {heartOverlay}
    </Pressable>
  );
}

/**
 * Video in the feed.
 *
 * Only the card the reader is actually looking at plays. Letting every
 * mounted card autoplay looks harmless in a simulator and falls apart on a
 * phone: iOS gives an app a small number of hardware video decoders, and
 * once they are spent the remaining players sit on a black frame forever —
 * which is exactly the "videos don't always play" everyone hits. Pausing
 * the ones off screen keeps a decoder free for the one that matters.
 *
 * The poster frame sits underneath, so a card that has not started yet
 * shows the photograph rather than a black rectangle.
 */
function VideoMedia({
  path,
  poster,
  cssFilter,
  active,
  onPress,
}: {
  path: string;
  poster: string | null;
  cssFilter: string | null;
  active: boolean;
  onPress: () => void;
}) {
  const url = mediaUrlString("media", path) ?? "";
  const muted = useVideoMuted();
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
  });

  React.useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  React.useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [player, active]);

  const posterUrl = mediaUrl("thumbnails", poster);

  return (
    <View style={StyleSheet.absoluteFill}>
      {posterUrl ? (
        <Image
          source={posterUrl}
          style={[StyleSheet.absoluteFill, cssFilter ? ({ filter: cssFilter } as object) : null]}
          contentFit="cover"
        />
      ) : null}
      <Pressable onPress={onPress} style={StyleSheet.absoluteFill}>
        <VideoView
          player={player}
          style={[StyleSheet.absoluteFill, cssFilter ? ({ filter: cssFilter } as object) : null]}
          contentFit="cover"
          nativeControls={false}
        />
      </Pressable>
      {/* Sound is off until asked for, and the control says so rather than
          leaving people to guess that a tap somewhere might do it. */}
      <Pressable
        onPress={toggleVideoMuted}
        hitSlop={10}
        style={styles.sound}
        accessibilityLabel={muted ? "Turn sound on" : "Turn sound off"}
      >
        <Feather name={muted ? "volume-x" : "volume-2"} size={14} color={colors.onShutter} />
      </Pressable>
    </View>
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
  heart: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    // A soft drop shadow keeps the heart legible over a pale photograph.
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
  },
  sound: {
    position: "absolute",
    right: spacing.sm,
    bottom: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: radii.round,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 25, 21, 0.55)",
  },
});
