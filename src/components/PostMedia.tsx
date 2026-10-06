import React from "react";
import { Animated, Easing, PanResponder, Pressable, StyleSheet, View, type GestureResponderEvent } from "react-native";
import { useEvent } from "expo";
import { holdTabSwipe } from "@/utils/tabSwipe";
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
    | "filter_baked"
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
      <MaterialCommunityIcons name="heart" size={92} color="#F6F1E8" />
    </Animated.View>
  );

  const frame = [styles.media, bare && styles.bare, { aspectRatio: ratio }];

  // Pinch a photograph to look closer. It grows about the point between
  // the fingers and springs back when they lift — a look, not a mode. Two
  // fingers are claimed before the list can scroll with them, and the tab
  // pager is held still so the pinch never shifts the screen sideways.
  const zoom = React.useRef(new Animated.Value(1)).current;
  const focus = React.useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  // Where the fingers have moved since the pinch began: the picture follows them.
  const drift = React.useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const pinchRef = React.useRef({ distance: 0, x0: 0, y0: 0, release: null as null | (() => void) });
  const box = React.useRef({ w: 1, h: 1 });
  const frameRef = React.useRef<View>(null);
  const [pinching, setPinching] = React.useState(false);
  const pinchResponder = React.useMemo(() => {
    const two = (e: GestureResponderEvent) => e.nativeEvent.touches.length === 2;
    // Page coordinates: the touched child is the picture itself, which moves
    // and grows under the fingers, so its own local coordinates drift.
    const read = (e: GestureResponderEvent) => {
      const [a, b] = e.nativeEvent.touches;
      return { d: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY), x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 };
    };
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: two,
      onMoveShouldSetPanResponderCapture: two,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        if (!two(e)) return;
        const t = read(e);
        pinchRef.current.distance = t.d;
        pinchRef.current.x0 = t.x;
        pinchRef.current.y0 = t.y;
        pinchRef.current.release = holdTabSwipe();
        drift.setValue({ x: 0, y: 0 });
        setPinching(true);
        // Scale about the fingers: move the picture's origin to the pinch,
        // in the frame's own coordinates.
        frameRef.current?.measureInWindow((fx, fy) => {
          focus.setValue({ x: t.x - fx - box.current.w / 2, y: t.y - fy - box.current.h / 2 });
        });
      },
      onPanResponderMove: (e) => {
        if (!two(e) || !pinchRef.current.distance) return;
        const t = read(e);
        zoom.setValue(Math.min(3, Math.max(1, t.d / pinchRef.current.distance)));
        drift.setValue({ x: t.x - pinchRef.current.x0, y: t.y - pinchRef.current.y0 });
      },
      onPanResponderRelease: () => {
        pinchRef.current.release?.();
        pinchRef.current.release = null;
        Animated.parallel([
          Animated.spring(zoom, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 220 }),
          Animated.spring(drift, { toValue: { x: 0, y: 0 }, useNativeDriver: true, damping: 18, stiffness: 220 }),
        ]).start(() => setPinching(false));
      },
      onPanResponderTerminate: () => {
        pinchRef.current.release?.();
        pinchRef.current.release = null;
        Animated.parallel([
          Animated.spring(zoom, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 220 }),
          Animated.spring(drift, { toValue: { x: 0, y: 0 }, useNativeDriver: true, damping: 18, stiffness: 220 }),
        ]).start(() => setPinching(false));
      },
    });
  }, [zoom, focus, drift]);
  const zoomStyle = {
    transform: [
      { translateX: Animated.add(focus.x, drift.x) },
      { translateY: Animated.add(focus.y, drift.y) },
      { scale: zoom },
      { translateX: Animated.multiply(focus.x, -1) },
      { translateY: Animated.multiply(focus.y, -1) },
    ],
  };
  // While held, the picture may grow past its frame and over what is
  // around it, as it does in any photo feed; let go and it is clipped again.
  const held = pinching ? styles.held : null;

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
  // The pinch's handlers sit on a plain View around the Pressable: a
  // Pressable spreads its own responder handlers last and would override
  // them, leaving a pinch to be read as a press.
  return (
    <View
      ref={frameRef}
      style={[frame, held]}
      onLayout={(e) => {
        box.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
      }}
      {...pinchResponder.panHandlers}
    >
    <Pressable onPress={handlePress} style={StyleSheet.absoluteFill}>
      {url ? (
        <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
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
        </Animated.View>
      ) : null}
      {live ? <FilterOverlay filter={filter} /> : null}
      {stamp}
      {heartOverlay}
    </Pressable>
    </View>
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
 *
 * A clip baked on the phone plays as it is. Only footage posted before
 * baking existed (or from a build that cannot bake) still carries the
 * overlay, and `needsDisplayFilter` is the one place that decides.
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

  // Unmuting is the one moment the audio session is actually claimed —
  // expo-video does that itself when a *playing* player becomes unmuted —
  // so a card that is on screen is nudged to play in the same breath, and
  // the volume is stated rather than assumed.
  React.useEffect(() => {
    player.muted = muted;
    if (!muted) {
      player.volume = 1;
      if (active) player.play();
    }
  }, [player, muted, active]);

  React.useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [player, active]);

  // A play() asked for before the file has loaded is sometimes lost on the
  // way, and the card sat on its poster. So the player is asked again the
  // moment it says it is ready, a failed load is given one more try, and
  // a clip that still has not started a beat after it should have shows a
  // play mark — one tap starts it.
  const { status, error } = useEvent(player, "statusChange", { status: player.status, error: undefined });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const retried = React.useRef(false);
  const activeRef = React.useRef(active);
  activeRef.current = active;
  React.useEffect(() => {
    if (status === "readyToPlay" && active && !player.playing) player.play();
    if (status === "error" && !retried.current && url) {
      retried.current = true;
      // Read `active` when the retry lands, not when it was asked for: a
      // card scrolled away in the meantime must stay quiet.
      player.replaceAsync(url).then(() => activeRef.current && player.play()).catch(() => undefined);
    }
  }, [status, error, active, player, url]);
  const [stalled, setStalled] = React.useState(false);
  React.useEffect(() => {
    if (!active || isPlaying) {
      setStalled(false);
      return;
    }
    const t = setTimeout(() => setStalled(true), 2500);
    return () => clearTimeout(t);
  }, [active, isPlaying, status]);

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
      <Pressable
        onPress={() => {
          if (stalled) {
            player.play();
            setStalled(false);
            return;
          }
          onPress();
        }}
        style={StyleSheet.absoluteFill}
      >
        <VideoView
          player={player}
          style={[StyleSheet.absoluteFill, cssFilter ? ({ filter: cssFilter } as object) : null]}
          contentFit="cover"
          nativeControls={false}
        />
      </Pressable>
      {stalled ? (
        <View pointerEvents="none" style={styles.playMark}>
          <Feather name="play" size={22} color="#F6F1E8" />
        </View>
      ) : null}
      {/* Sound is off until asked for, and the control says so rather than
          leaving people to guess that a tap somewhere might do it. */}
      <Pressable
        onPress={toggleVideoMuted}
        hitSlop={12}
        style={styles.sound}
        accessibilityLabel={muted ? "Turn sound on" : "Turn sound off"}
      >
        {/* Fixed cream: the disc beneath is always dark, whichever print the page is. */}
        <Feather name={muted ? "volume-x" : "volume-2"} size={15} color="#F6F1E8" />
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
  held: { overflow: "visible", zIndex: 20, elevation: 20 },
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
  playMark: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -26,
    marginTop: -26,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 25, 21, 0.55)",
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
