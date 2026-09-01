import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { showAlert } from "@/utils/alert";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import * as VideoThumbnails from "expo-video-thumbnails";
import { useVideoPlayer, VideoView } from "expo-video";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { DateStamp } from "@/components/DateStamp";
import { colors, radii, spacing, type } from "@/theme";
import { FILTERS, FilteredImage, dateStampStartsOn, getFilter } from "@/filters";
import type { FilteredImageHandle, FilterSpec } from "@/filters";
import { FilterOverlay } from "@/components/FilterOverlay";
import { cssFilterFor } from "@/filters/cssFilter";
import { prepareFeedImage, prepareThumbnail, uploadFile } from "@/api/media";
import { isDemoMode } from "@/lib/env";
import { createPost } from "@/api/posts";
import { useSession } from "@/providers/SessionProvider";
import { MAX_CAPTION_LENGTH, MAX_LOCATION_LENGTH } from "@/utils/validation";

/**
 * The darkroom: choose a VINTAGE filter, optionally the amber date stamp,
 * name the place, write a caption, publish. Photos are baked with the
 * filter on-device before upload, and the stamp shows when the shutter
 * fired rather than when the post was made.
 */
export default function Compose() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
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
          mediaPath = await uploadFile("media", `${userId}/${postId}.${ext}`, uri, `video/${ext === "mov" ? "quicktime" : "mp4"}`);
          thumbPath = posterUri
            ? await uploadFile("thumbnails", `${userId}/${postId}.jpg`, posterUri, "image/jpeg")
            : null;
        }
      } else {
        // Photos are always baked through the GL renderer, on every platform:
        // the filter has to end up in the pixels, not just in the metadata.
        const baked = await filteredRef.current?.snapshot();
        if (!baked) throw new Error("The filter renderer isn’t ready yet — try again.");
        const feedImage = await prepareFeedImage(baked.uri);
        finalWidth = feedImage.width;
        finalHeight = feedImage.height;
        if (isDemoMode()) {
          mediaPath = feedImage.uri; // keep the baked file locally, no upload
        } else {
          const thumb = await prepareThumbnail(baked.uri);
          mediaPath = await uploadFile("media", `${userId}/${postId}.jpg`, feedImage.uri, "image/jpeg");
          thumbPath = await uploadFile("thumbnails", `${userId}/${postId}.jpg`, thumb.uri, "image/jpeg");
        }
      }

      await createPost({
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
      });

      queryClient.invalidateQueries({ queryKey: ["feed"] });
      queryClient.invalidateQueries({ queryKey: ["user-posts"] });
      router.dismissAll();
      router.replace("/(tabs)");
    } catch (err) {
      showAlert("Couldn’t publish", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll padded={false}>
      <View style={[styles.preview, { aspectRatio: previewRatio }]}>
        {isVideo ? (
          <VideoPreview uri={uri} filter={filter} />
        ) : (
          <FilteredImage ref={filteredRef} uri={uri} filter={filter} style={StyleSheet.absoluteFill} />
        )}
        {stampOn ? <DateStamp iso={stampIso} /> : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tray}
        contentContainerStyle={styles.trayContent}
      >
        {FILTERS.map((f) => (
          <Pressable key={f.id} style={styles.swatchWrap} onPress={() => selectFilter(f.id)}>
            <View style={[styles.swatch, f.id === filterId && styles.swatchSelected]}>
              {!isVideo || poster ? (
                <FilteredImage uri={poster ?? uri} filter={f} style={styles.swatchImage} />
              ) : (
                <View style={[styles.swatchImage, styles.swatchVideo]} />
              )}
            </View>
            <Text style={[styles.swatchName, f.id === filterId && styles.swatchNameSelected]}>
              {f.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={styles.filterDescription}>{filter.description}</Text>
      {isVideo ? (
        <Text style={styles.videoNote}>
          The filter is applied to video as it plays rather than burned into the file, so the
          original footage is kept intact.
        </Text>
      ) : null}

      {/* Available on every filter — the preset only decides the default. */}
      <View style={styles.stampRow}>
        <Text style={styles.stampLabel}>Date stamp</Text>
        <Switch
          value={stampOn}
          onValueChange={setStampOn}
          trackColor={{ true: colors.accent, false: colors.borderStrong }}
          thumbColor={colors.paperRaised}
        />
      </View>

      <View style={styles.captionWrap}>
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
        <Button title="Share to VINTAGE" onPress={publish} loading={busy} />
      </View>
    </Screen>
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
  preview: {
    width: "100%",
    backgroundColor: colors.paperSunken,
    borderBottomWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  tray: { marginTop: spacing.md },
  trayContent: { paddingHorizontal: spacing.lg, gap: spacing.md },
  swatchWrap: { alignItems: "center", width: 68 },
  swatch: {
    width: 62,
    height: 62,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: "transparent",
    overflow: "hidden",
  },
  swatchSelected: { borderColor: colors.ink },
  swatchImage: { width: 58, height: 58 },
  swatchVideo: { backgroundColor: colors.paperSunken },
  swatchName: { fontSize: 11, color: colors.inkFaint, marginTop: 4 },
  swatchNameSelected: { color: colors.ink, fontWeight: "600" },
  filterDescription: {
    ...type.caption,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  videoNote: { ...type.caption, paddingHorizontal: spacing.lg, marginTop: spacing.xs, color: colors.inkFaint },
  stampRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  stampLabel: { fontSize: 14, color: colors.ink },
  captionWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
});
