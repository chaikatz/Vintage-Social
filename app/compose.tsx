import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useNavigation, usePreventRemove } from "@react-navigation/native";
import { showAlert } from "@/utils/alert";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import * as VideoThumbnails from "expo-video-thumbnails";
import { useVideoPlayer, VideoView } from "expo-video";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { DateStamp } from "@/components/DateStamp";
import { colors, hairline, radii, spacing, type } from "@/theme";
import { FILTERS, FilteredImage, dateStampStartsOn, getFilter } from "@/filters";
import type { FilteredImageHandle, FilterSpec } from "@/filters";
import { FilterOverlay } from "@/components/FilterOverlay";
import { cssFilterFor } from "@/filters/cssFilter";
import { ownedPath, prepareFeedImage, prepareThumbnail, uploadFile } from "@/api/media";
import { isDemoMode } from "@/lib/env";
import { createPost } from "@/api/posts";
import { useSession } from "@/providers/SessionProvider";
import { MAX_CAPTION_LENGTH, MAX_LOCATION_LENGTH } from "@/utils/validation";
import { dateStampText } from "@/utils/time";
import { describePublishFailure, publishStep } from "@/utils/publishError";

/**
 * The darkroom: choose a VINTAGE filter, optionally the amber date stamp,
 * name the place, write a caption, publish. Photos are baked with the
 * filter on-device before upload, and the stamp shows when the shutter
 * fired rather than when the post was made.
 */
export default function Compose() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, refreshProfile } = useSession();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    uri: string;
    mediaType: "photo" | "video";
    width: string;
    height: string;
    duration: string;
    takenAt: string;
  }>();

  const uri = params.uri ?? "";
  const isVideo = params.mediaType === "video";
  const width = Number(params.width) || null;
  const height = Number(params.height) || null;

  const [filterId, setFilterId] = useState(FILTERS[0].id);
  const filter = getFilter(filterId);
  const [stampOn, setStampOn] = useState(dateStampStartsOn(FILTERS[0].id));
  const [caption, setCaption] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);

  const filteredRef = useRef<FilteredImageHandle>(null);
  // A video's poster frame, pulled once: it makes the filter tray show real
  // frames instead of grey boxes, and it's the thumbnail the grid will use.
  const [poster, setPoster] = useState<string | null>(null);
  useEffect(() => {
    if (!isVideo || !uri) return;
    let live = true;
    VideoThumbnails.getThumbnailAsync(uri, { time: 500 })
      .then((p) => live && setPoster(p.uri))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isVideo, uri]);

  const nowIso = useMemo(() => new Date().toISOString(), []);
  // What the stamp says: when the shutter fired, falling back to now for
  // files that carry no capture date.
  const takenAt = params.takenAt || null;
  const stampIso = takenAt ?? nowIso;

  const selectFilter = (id: string) => {
    setFilterId(id);
    setStampOn(dateStampStartsOn(id));
  };

  const previewRatio = width && height ? Math.min(Math.max(width / height, 4 / 5), 1.91) : 1;

  // The back gesture is off for this screen (see app/_layout.tsx) because a
  // stray swipe threw away a post someone had set up. The header button
  // still works, and asks first once there are words worth keeping.
  const [published, setPublished] = useState(false);
  const hasWritten = caption.trim().length > 0 || location.trim().length > 0;
  usePreventRemove(hasWritten && !published && !busy, ({ data }) => {
    showAlert("Discard this post?", "Your caption and location will be lost.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  const publish = async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    setBusy(true);
    try {
      const postId = Crypto.randomUUID();
      let mediaPath: string;
      let thumbPath: string | null = null;
      let finalWidth = width;
      let finalHeight = height;

      if (isVideo) {
        // The poster frame is what the profile grid draws — a grid square
        // can't play a movie — so it is made either way, uploaded or not.
        let posterUri: string | null = null;
        try {
          const poster = await VideoThumbnails.getThumbnailAsync(uri, { time: 500 });
          posterUri = (await prepareThumbnail(poster.uri)).uri;
        } catch {
          posterUri = null; // a missing poster frame shouldn't block publishing
        }

        if (isDemoMode()) {
          mediaPath = uri; // demo mode keeps the local recording, no upload
          thumbPath = posterUri;
        } else {
          const ext = uri.split(".").pop()?.toLowerCase() ?? "mp4";
          mediaPath = await publishStep("media-upload", () =>
            uploadFile(
              "media",
              ownedPath(userId, `${postId}.${ext}`),
              uri,
              `video/${ext === "mov" ? "quicktime" : "mp4"}`,
            ),
          );
          thumbPath = posterUri
            ? await publishStep("thumbnail-upload", () =>
                uploadFile("thumbnails", ownedPath(userId, `${postId}.jpg`), posterUri!, "image/jpeg"),
              )
            : null;
        }
      } else {
        // Photos are always baked through the GL renderer, on every platform:
        // the filter has to end up in the pixels, not just in the metadata.
        const baked = await publishStep("render", async () => {
          const shot = await filteredRef.current?.snapshot();
          if (!shot) throw new Error("The filter renderer isn’t ready yet — try again.");
          return shot;
        });
        const feedImage = await publishStep("resize", () => prepareFeedImage(baked.uri));
        finalWidth = feedImage.width;
        finalHeight = feedImage.height;
        if (isDemoMode()) {
          mediaPath = feedImage.uri; // keep the baked file locally, no upload
        } else {
          const thumb = await publishStep("resize", () => prepareThumbnail(baked.uri));
          mediaPath = await publishStep("media-upload", () =>
            uploadFile("media", ownedPath(userId, `${postId}.jpg`), feedImage.uri, "image/jpeg"),
          );
          thumbPath = await publishStep("thumbnail-upload", () =>
            uploadFile("thumbnails", ownedPath(userId, `${postId}.jpg`), thumb.uri, "image/jpeg"),
          );
        }
      }

      await publishStep("post-insert", () =>
        createPost({
          id: postId,
          author_id: userId,
          media_type: isVideo ? "video" : "photo",
          media_path: mediaPath,
          thumb_path: thumbPath,
          width: finalWidth,
          height: finalHeight,
          duration_seconds: isVideo ? Number(params.duration) || null : null,
          filter_id: filterId,
          show_date_stamp: stampOn,
          caption: caption.trim(),
          taken_at: takenAt,
          location: location.trim() || null,
        }),
      );

      queryClient.invalidateQueries({ queryKey: ["feed"] });
      queryClient.invalidateQueries({ queryKey: ["user-posts"] });
      queryClient.invalidateQueries({ queryKey: ["explore"] });
      // post_count lives on the profile row and is bumped by a trigger, so
      // the number on your own grid only moves when the profile is re-read.
      await refreshProfile();
      setPublished(true);
      router.dismissAll();
      router.replace("/(tabs)");
    } catch (err) {
      showAlert("Couldn’t publish", describePublishFailure(err));
    } finally {
      setBusy(false);
    }
  };

  const stampLabel = dateStampText(stampIso);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* The frame, full bleed, with the film stock struck across the
            bottom-left the way a lab writes it on the sleeve. */}
        <View style={[styles.preview, { aspectRatio: previewRatio }]}>
          {isVideo ? (
            <VideoPreview uri={uri} filter={filter} />
          ) : (
            <FilteredImage ref={filteredRef} uri={uri} filter={filter} style={StyleSheet.absoluteFill} />
          )}
          {stampOn ? <DateStamp iso={stampIso} /> : null}
          <View pointerEvents="none" style={styles.previewFilm}>
            <Text style={styles.previewFilmText}>{filter.name}</Text>
          </View>
        </View>

        <SectionLabel>Film</SectionLabel>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.trayContent}
        >
          {FILTERS.map((f) => {
            const selected = f.id === filterId;
            return (
              <Pressable key={f.id} style={styles.swatchWrap} onPress={() => selectFilter(f.id)}>
                <View style={[styles.swatch, selected && styles.swatchSelected]}>
                  {!isVideo || poster ? (
                    <FilteredImage uri={poster ?? uri} filter={f} style={styles.swatchImage} />
                  ) : (
                    <View style={[styles.swatchImage, styles.swatchVideo]} />
                  )}
                </View>
                {/* The selected stock is underscored in amber rather than
                    boxed in — a mark on the contact sheet, not a button. */}
                <View style={[styles.swatchRule, selected && styles.swatchRuleOn]} />
                <Text style={[styles.swatchName, selected && styles.swatchNameSelected]} numberOfLines={1}>
                  {f.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={styles.filterDescription}>{filter.description}</Text>
        {isVideo ? (
          <Text style={styles.videoNote}>
            On video the filter is applied as it plays rather than burned into the file, so your
            original footage is kept intact.
          </Text>
        ) : null}

        {/* Available on every filter — the preset only decides the default. */}
        <SectionLabel>Date stamp</SectionLabel>
        <Pressable style={styles.stampRow} onPress={() => setStampOn(!stampOn)}>
          <View style={styles.grow}>
            <Text style={[styles.stampValue, !stampOn && styles.stampValueOff]}>{stampLabel}</Text>
            <Text style={styles.stampHint}>
              {takenAt
                ? "Read from the file — when the shutter actually fired."
                : "This one carried no capture date, so today’s is used."}
            </Text>
          </View>
          <Switch
            value={stampOn}
            onValueChange={setStampOn}
            trackColor={{ true: colors.accent, false: colors.borderStrong }}
            thumbColor={colors.paperRaised}
          />
        </Pressable>

        <SectionLabel>The note</SectionLabel>
        <View style={styles.fields}>
          <TextField
            label="Location"
            value={location}
            onChangeText={(t) => setLocation(t.slice(0, MAX_LOCATION_LENGTH))}
            placeholder="Optional — a town, a street, a bar."
            autoCapitalize="words"
          />
          <TextField
            label="Caption"
            value={caption}
            onChangeText={(t) => setCaption(t.slice(0, MAX_CAPTION_LENGTH))}
            multiline
            placeholder="Optional — keep it quiet."
          />
        </View>
      </ScrollView>

      {/* The publish bar stays put, so the one thing this screen is for is
          never scrolled off the bottom. */}
      <View style={styles.footer}>
        <Button title="Share to VINTAGE" onPress={publish} loading={busy} />
      </View>
    </KeyboardAvoidingView>
  );
}

/** A hairline ruled across the page with its name set into the left of it. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionLabelText}>{children}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

function VideoPreview({ uri, filter }: { uri: string; filter: FilterSpec }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  const css = cssFilterFor(filter);
  return (
    <>
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFill, { filter: css.filter } as object]}
        contentFit="cover"
        nativeControls={false}
      />
      <FilterOverlay filter={filter} />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingBottom: spacing.xl },
  grow: { flex: 1 },

  preview: {
    width: "100%",
    backgroundColor: colors.shutter,
    overflow: "hidden",
  },
  previewFilm: { position: "absolute", left: spacing.lg, bottom: spacing.md },
  previewFilmText: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    color: colors.onShutter,
    opacity: 0.85,
  },

  sectionLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionLabelText: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  sectionRule: { flex: 1, height: 1, backgroundColor: colors.border },

  trayContent: { paddingHorizontal: spacing.lg, gap: spacing.md },
  swatchWrap: { alignItems: "center", width: 72 },
  swatch: {
    width: 72,
    height: 72,
    borderRadius: radii.sm,
    overflow: "hidden",
    backgroundColor: colors.paperSunken,
    ...hairline,
  },
  swatchSelected: { borderColor: colors.ink },
  swatchImage: { width: 70, height: 70 },
  swatchVideo: { backgroundColor: colors.paperSunken },
  swatchRule: {
    height: 2,
    width: 22,
    marginTop: spacing.sm,
    backgroundColor: "transparent",
  },
  swatchRuleOn: { backgroundColor: colors.accent },
  swatchName: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.inkFaint,
    marginTop: 5,
  },
  swatchNameSelected: { color: colors.ink },

  filterDescription: {
    ...type.body,
    fontFamily: type.serif,
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkSoft,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  videoNote: {
    ...type.caption,
    fontSize: 12,
    color: colors.inkFaint,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },

  stampRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  stampValue: {
    fontFamily: type.mono,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 1,
    color: colors.stamp,
    textShadowColor: colors.stampGlow,
    textShadowRadius: 5,
    textShadowOffset: { width: 0, height: 0 },
  },
  stampValueOff: {
    color: colors.inkFaint,
    textShadowColor: "transparent",
  },
  stampHint: { ...type.caption, fontSize: 12, color: colors.inkFaint, marginTop: 3 },

  fields: { paddingHorizontal: spacing.lg },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paper,
  },
});
