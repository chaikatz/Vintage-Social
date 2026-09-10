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
  /** Draw without the hairline rules above and below — for the full-bleed detail page. */
  bare?: boolean;
  /** Load this one first; it is the photograph the screen is for. */
  priority?: "high" | "normal";
}

// Clamp between 4:5 portrait and 1.91:1 landscape, like classic photo feeds.
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 1.91;

/** Two taps closer together than this are one double-tap. */
const DOUBLE_TAP_MS = 280;

export function aspectRatio(width: number | null, height: number | null): number {
  if (!width || !height) return 1;
  return Math.min(Math.max(width / height, MIN_RATIO), MAX_RATIO);
}

/**
 * The photograph itself — full-bleed within the card, optional amber date
 * stamp, and the heart that blooms when you double-tap it.
 *
 * On video a single tap is the sound: the same gesture as every other feed,
 * and a target the size of the picture rather than a 28-point button. The
 * tap is held for a beat so a double-tap only likes and never flickers
 * the sound on and off on its way to the heart.
 */
export function PostMedia({ post, onDoubleTap, active = true, bare = false, priority = "normal" }: Props) {
  const lastTap = React.useRef(0);
  const singleTap = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const heart = React.useRef(new Animated.Value(0)).current;
  const isVideo = post.media_type === "video";

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

  React.useEffect(
    () => () => {
      if (singleTap.current) clearTimeout(singleTap.current);
    },
    [],
  );

  const handlePress = React.useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0; // a third tap shouldn't fire it again
      if (singleTap.current) {
        clearTimeout(singleTap.current);
        singleTap.current = null;
      }
      bloom();
      onDoubleTap?.();
      return;
    }
    lastTap.current = now;
    if (isVideo) {
      if (singleTap.current) clearTimeout(singleTap.current);
      singleTap.current = setTimeout(() => {
        singleTap.current = null;
        toggleVideoMuted();
      }, DOUBLE_TAP_MS);
    }
  }, [bloom, onDoubleTap, isVideo]);

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

  const frame = [styles.media, bare && styles.bare, { aspectRatio: ratio }];

  if (isVideo) {
    return (
      <View style={frame}>
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
  const thumb = mediaUrl("thumbnails", post.thumb_path);
  return (
    <Pressable onPress={handlePress} style={frame}>
      {url ? (
        <Image
          source={url}
          // The grid's small square is almost always already on disk, so
          // it stands in while the full frame arrives instead of a blank.
          placeholder={thumb && thumb !== url ? thumb : undefined}
          placeholderContentFit="cover"
          style={[StyleSheet.absoluteFill, live ? ({ filter: live.filter } as object) : null]}
          contentFit="cover"
          transition={120}
          priority={priority}
          cachePolicy="memory-disk"
          recyclingKey={post.media_path}
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
 *
 * Sound: the player is created muted and follows the feed-wide switch. It
 * asks to duck other audio rather than stop it, and while muted it mixes,
 * so scrolling past a silent clip never interrupts someone's music.
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
    p.audioMixingMode = "duckOthers";
    p.staysActiveInBackground = false;
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
          cachePolicy="memory-disk"
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
        hitSlop={12}
        style={styles.sound}
        accessibilityLabel={muted ? "Turn sound on" : "Turn sound off"}
      >
        <Feather name={muted ? "volume-x" : "volume-2"} size={15} color={colors.onShutter} />
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
  bare: { borderTopWidth: 0, borderBottomWidth: 0 },
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
    right: spacing.sm + 2,
    bottom: spacing.sm + 2,
    width: 32,
    height: 32,
    borderRadius: radii.round,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 25, 21, 0.6)",
  },
});
