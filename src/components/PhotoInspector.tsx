import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { mediaUrl, mediaUrlString } from "@/api/media";
import { toggleVideoMuted, useVideoMuted } from "@/utils/videoSound";
import { Byline } from "./PostCard";
import type { PostRow } from "@/types/db";

interface Props {
  /** The photographs, in the order they hang on the line. */
  posts: PostRow[];
  /** Which one is open; null when the inspector is closed. */
  index: number | null;
  onClose: () => void;
  /** Open the post's own page — comments, likes, the rest. */
  onOpenPost?: (post: PostRow) => void;
}

const MAX_ZOOM = 5;

/**
 * One photograph, close — and the next, and the one before.
 *
 * The timeline is for surveying a life in pictures; this is for looking
 * at them one at a time. It sits over the timeline rather than replacing
 * it, so closing lands exactly where you were. Swipe sideways to move
 * along the line without going back to it. A photograph is drawn at full
 * resolution with the platform's own pinch and pan; a film plays, with
 * the feed's sound switch, and a tap on it turns the sound on and off.
 */
export function PhotoInspector({ posts, index, onClose, onOpenPost }: Props) {
  const { width, height } = useWindowDimensions();
  const [current, setCurrent] = useState(index ?? 0);
  useEffect(() => {
    if (index != null) setCurrent(index);
  }, [index]);

  if (index == null || posts.length === 0) return null;
  const post = posts[Math.min(Math.max(current, 0), posts.length - 1)];

  // Closing deactivates every page first, so a zoomed photograph is put back
  // to scale 1 before its scroll view is torn down. The platform recycles
  // scroll views between screens, and one left zoomed would carry that zoom
  // into whatever list is drawn next.
  const close = () => {
    setCurrent(-1);
    requestAnimationFrame(onClose);
  };

  const onPage = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== current && next >= 0 && next < posts.length) setCurrent(next);
  };

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={close}>
      <View style={styles.root}>
        <FlatList
          data={posts}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(p) => p.id}
          initialScrollIndex={Math.min(index, posts.length - 1)}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={onPage}
          onScrollToIndexFailed={() => undefined}
          initialNumToRender={1}
          windowSize={3}
          renderItem={({ item, index: i }) => (
            <Page post={item} width={width} height={height} active={i === current} />
          )}
        />

        {/* The words, under the picture, out of the way of the pinch. */}
        <View style={styles.caption} pointerEvents="box-none">
          <View style={styles.captionRow}>
            <Byline post={post} size="large" style={styles.byline} />
            {posts.length > 1 ? (
              <Text style={styles.count}>
                {current + 1} / {posts.length}
              </Text>
            ) : null}
          </View>
          {post.caption ? (
            <Text style={styles.captionText} numberOfLines={3}>
              {post.caption}
            </Text>
          ) : null}
          {onOpenPost ? (
            <Pressable
              hitSlop={8}
              onPress={() => {
                setCurrent(-1);
                requestAnimationFrame(() => onOpenPost(post));
              }}
              style={styles.open}
            >
              <Text style={styles.openText}>Open the post</Text>
              <Feather name="arrow-right" size={13} color={colors.accent} />
            </Pressable>
          ) : null}
        </View>

        <Pressable style={styles.close} hitSlop={12} onPress={close} accessibilityLabel="Back to the timeline">
          <Feather name="x" size={20} color={colors.ink} />
        </Pressable>
      </View>
    </Modal>
  );
}

/** One page of the pager: a zoomable photograph, or a playing film. */
function Page({ post, width, height, active }: { post: PostRow; width: number; height: number; active: boolean }) {
  const isVideo = post.media_type === "video";
  const ratio = post.width && post.height ? post.width / post.height : 1;
  // Fit the whole picture in view: the frame is the screen, the picture
  // sits inside it at its own proportions.
  const fitWidth = Math.min(width, height * ratio);
  const fitHeight = fitWidth / ratio;
  const thumb = mediaUrl("thumbnails", post.thumb_path);

  if (isVideo) {
    return (
      <View style={[styles.frame, { width, height }]}>
        {active ? (
          <Film post={post} width={fitWidth} height={fitHeight} />
        ) : thumb ? (
          <Image source={thumb} style={{ width: fitWidth, height: fitHeight }} contentFit="contain" cachePolicy="memory-disk" />
        ) : null}
      </View>
    );
  }

  const url = mediaUrl("media", post.media_path) ?? thumb;
  return (
    <ZoomablePhoto
      url={url}
      placeholder={thumb && thumb !== url ? thumb : undefined}
      width={width}
      height={height}
      fitWidth={fitWidth}
      fitHeight={fitHeight}
      active={active}
    />
  );
}

function ZoomablePhoto({
  url,
  placeholder,
  width,
  height,
  fitWidth,
  fitHeight,
  active,
}: {
  url: string | number | null;
  placeholder?: string | number;
  width: number;
  height: number;
  fitWidth: number;
  fitHeight: number;
  active: boolean;
}) {
  const scroll = useRef<ScrollView>(null);
  const zoomed = useRef(false);
  const lastTap = useRef(0);

  // A page you have swiped away from, or are closing, goes back to actual
  // size while it is still on screen — see the note on `close` above.
  useEffect(() => {
    if (!active && zoomed.current) {
      zoomed.current = false;
      scroll.current?.scrollResponderZoomTo({ x: 0, y: 0, width, height, animated: false });
    }
  }, [active, width, height]);

  const onTap = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      const view = scroll.current;
      if (!view) return;
      if (zoomed.current) {
        view.scrollResponderZoomTo({ x: 0, y: 0, width, height, animated: true });
        zoomed.current = false;
      } else {
        // Go in on the point that was tapped, so what was under the finger
        // stays under it.
        const zoom = 2.5;
        const w = width / zoom;
        const h = height / zoom;
        const { locationX, locationY } = e.nativeEvent;
        view.scrollResponderZoomTo({ x: locationX - w / 2, y: locationY - h / 2, width: w, height: h, animated: true });
        zoomed.current = true;
      }
      return;
    }
    lastTap.current = now;
  };

  return (
    <ScrollView
      ref={scroll}
      style={{ width, height }}
      contentContainerStyle={{ width, height }}
      minimumZoomScale={1}
      maximumZoomScale={MAX_ZOOM}
      bouncesZoom
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      onScroll={(e) => {
        zoomed.current = e.nativeEvent.zoomScale > 1.05;
      }}
      scrollEventThrottle={100}
    >
      <Pressable style={[styles.frame, { width, height }]} onPress={onTap}>
        {url ? (
          <Image
            source={url}
            placeholder={placeholder}
            placeholderContentFit="contain"
            style={{ width: fitWidth, height: fitHeight }}
            contentFit="contain"
            transition={120}
            priority="high"
            cachePolicy="memory-disk"
          />
        ) : null}
      </Pressable>
    </ScrollView>
  );
}

/**
 * A film, playing. Only the page on screen mounts one of these, so a
 * single decoder is in use however many films hang on the line.
 */
function Film({ post, width, height }: { post: PostRow; width: number; height: number }) {
  const url = mediaUrlString("media", post.media_path) ?? "";
  const muted = useVideoMuted();
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = "duckOthers";
    p.staysActiveInBackground = false;
  });

  useEffect(() => {
    player.muted = muted;
    if (!muted) player.volume = 1;
    player.play();
  }, [player, muted]);

  const poster = mediaUrl("thumbnails", post.thumb_path);
  return (
    <Pressable onPress={toggleVideoMuted} style={{ width, height }} accessibilityLabel={muted ? "Turn sound on" : "Turn sound off"}>
      {poster ? <Image source={poster} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory-disk" /> : null}
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      <View style={styles.sound} pointerEvents="none">
        <Feather name={muted ? "volume-x" : "volume-2"} size={15} color={colors.onShutter} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  frame: { alignItems: "center", justifyContent: "center" },
  close: {
    position: "absolute",
    top: 54,
    right: spacing.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paperRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sound: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.shutter,
    opacity: 0.85,
  },
  caption: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 44,
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  captionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  byline: { marginTop: 0, flexShrink: 1 },
  count: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.inkFaint,
  },
  captionText: {
    fontFamily: type.serif,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
    marginTop: spacing.sm,
  },
  open: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  openText: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.accent,
  },
});
