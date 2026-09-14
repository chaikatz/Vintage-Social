import React, { useRef } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { mediaUrl } from "@/api/media";
import { Byline } from "./PostCard";
import type { PostRow } from "@/types/db";

interface Props {
  post: PostRow | null;
  onClose: () => void;
  /** Open the post's own page — comments, likes, the rest. */
  onOpenPost?: (post: PostRow) => void;
}

const MAX_ZOOM = 5;

/**
 * One photograph, close.
 *
 * The timeline is for surveying a life in pictures; this is for looking
 * at one of them. It sits over the timeline rather than replacing it, so
 * closing lands exactly where you were. The zoom is the platform's own:
 * pinch anchors where the fingers are, panning follows, a double-tap goes
 * in on the point you tapped and out again. The full-size photograph is
 * loaded here — the timeline shows the thumbnail — so detail is real.
 */
export function PhotoInspector({ post, onClose, onOpenPost }: Props) {
  const { width, height } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const zoomed = useRef(false);
  const lastTap = useRef(0);

  if (!post) return null;

  const isVideo = post.media_type === "video";
  const url = isVideo
    ? mediaUrl("thumbnails", post.thumb_path)
    : mediaUrl("media", post.media_path) ?? mediaUrl("thumbnails", post.thumb_path);
  const thumb = mediaUrl("thumbnails", post.thumb_path);
  const ratio = post.width && post.height ? post.width / post.height : 1;
  // Fit the whole photograph in view at zoom 1: the frame is the screen,
  // the picture sits inside it at its own proportions.
  const fitWidth = Math.min(width, height * ratio);
  const fitHeight = fitWidth / ratio;

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
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.root}>
        <ScrollView
          ref={scroll}
          style={styles.root}
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
                placeholder={thumb && thumb !== url ? thumb : undefined}
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

        {/* The words, under the picture, out of the way of the pinch. */}
        <View style={styles.caption} pointerEvents="box-none">
          <Byline post={post} size="large" style={styles.byline} />
          {post.caption ? (
            <Text style={styles.captionText} numberOfLines={3}>
              {post.caption}
            </Text>
          ) : null}
          {onOpenPost ? (
            <Pressable hitSlop={8} onPress={() => onOpenPost(post)} style={styles.open}>
              <Text style={styles.openText}>Open the post</Text>
              <Feather name="arrow-right" size={13} color={colors.accent} />
            </Pressable>
          ) : null}
        </View>

        <Pressable style={styles.close} hitSlop={12} onPress={onClose} accessibilityLabel="Back to the timeline">
          <Feather name="x" size={20} color={colors.ink} />
        </Pressable>
      </View>
    </Modal>
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
  byline: { marginTop: 0 },
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
