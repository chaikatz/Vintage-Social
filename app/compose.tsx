import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useNavigation, usePreventRemove } from "@react-navigation/native";
import { showAlert } from "@/utils/alert";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import * as VideoThumbnails from "expo-video-thumbnails";
import { useVideoPlayer, VideoView } from "expo-video";
import { Image } from "expo-image";
import Feather from "@expo/vector-icons/Feather";
import { Button } from "@/components/Button";
import { DateStamp } from "@/components/DateStamp";
import { colors, spacing, type } from "@/theme";
import { FILTERS, FilteredImage, dateStampStartsOn, getFilter } from "@/filters";
import type { FilteredImageHandle, FilterSpec } from "@/filters";
import { FilterOverlay } from "@/components/FilterOverlay";
import { cssFilterFor } from "@/filters/cssFilter";
import { bakeVideo, canBakeVideo } from "@/filters/bakeVideo";
import {
  mediaUrlString,
  ownedPath,
  prepareFeedImage,
  prepareThumbnail,
  uploadFile,
} from "@/api/media";
import { isDemoMode } from "@/lib/env";
import { createPost } from "@/api/posts";
import { useSession } from "@/providers/SessionProvider";
import { MAX_CAPTION_LENGTH, MAX_LOCATION_LENGTH } from "@/utils/validation";
import { dateStampText } from "@/utils/time";
import { describePublishFailure, publishStep } from "@/utils/publishError";

/**
 * The darkroom: choose a VINTAGE filter, optionally the amber date stamp,
 * name the place, write a caption, publish. Photos are baked with the
 * filter on-device before upload — and so is video, where the build can
 * (see `bakeVideo`) — and the stamp shows when the shutter fired rather
 * than when the post was made.
 *
 * Laid out like a print being finished: the photograph full-bleed at the
 * top, a contact sheet of the films under it, then the two lines that go
 * on the back. Nothing here is boxed; the rules are hairlines.
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
  // What publishing is doing right now, said under the button. A bake and
  // an upload can take a few seconds each; a spinner alone reads as stuck.
  const [stage, setStage] = useState<string | null>(null);

  const filteredRef = useRef<FilteredImageHandle>(null);
  // The plain photograph sits under the renderer and shows at once; the
  // filtered frame fades in over it when the GPU has the picture. Nobody
  // waits on a black rectangle.
  const [rendererReady, setRendererReady] = useState(false);
  // The renderer could not read the file. Rare now that library originals
  // are re-encoded first, but a black frame must never be what gets posted.
  const [renderFailed, setRenderFailed] = useState(false);
  // Video: the still frame shows the film exactly; "motion" plays the clip
  // with the play-time approximation, muted unless asked.
  const [motion, setMotion] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(true);
  const bakes = isVideo && canBakeVideo();
  // A video's poster frame, pulled once: it makes the filter tray show real
  // frames instead of grey boxes, and it's the thumbnail the grid will use.
  const [poster, setPoster] = useState<{ uri: string; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!isVideo || !uri) return;
    let live = true;
    VideoThumbnails.getThumbnailAsync(uri, { time: 500 })
      .then((p) => live && setPoster({ uri: p.uri, width: p.width, height: p.height }))
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
      // Photographs always leave here with the filter in their pixels.
      let baked = !isVideo;

      if (isVideo) {
        // The film goes into the clip first, where the build can do it, so
        // the file that is uploaded already wears it and every surface
        // simply plays it. If the bake fails the footage goes up as
        // recorded and the look is applied at play time, as it always was.
        let source = uri;
        if (bakes && !isDemoMode()) {
          setStage("Applying the film to the clip…");
          try {
            const out = await publishStep("render", () => bakeVideo(uri, filter));
            source = out.uri;
            finalWidth = out.width;
            finalHeight = out.height;
            baked = true;
          } catch {
            source = uri;
            baked = false;
          }
        }

        // The poster frame is what the profile grid draws — a grid square
        // can't play a movie — so it is made either way, uploaded or not.
        // Cut from the finished clip, so the square matches what plays.
        setStage("Cutting the poster frame…");
        let posterUri: string | null = null;
        try {
          const frame = await VideoThumbnails.getThumbnailAsync(source, { time: 500 });
          posterUri = (await prepareThumbnail(frame.uri)).uri;
        } catch {
          posterUri = null; // a missing poster frame shouldn't block publishing
        }

        if (isDemoMode()) {
          mediaPath = uri; // demo mode keeps the local recording, no upload
          thumbPath = posterUri;
        } else {
          setStage("Uploading the clip…");
          const ext = source.split("?")[0].split(".").pop()?.toLowerCase() ?? "mp4";
          mediaPath = await publishStep("media-upload", () =>
            uploadFile(
              "media",
              ownedPath(userId, `${postId}.${ext}`),
              source,
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
        if (renderFailed) {
          throw new Error("This photograph couldn’t be read. Try choosing it again from your library.");
        }
        // Photos are always baked through the GL renderer, on every platform:
        // the filter has to end up in the pixels, not just in the metadata.
        setStage("Baking the film in…");
        const shot = await publishStep("render", async () => {
          const rendered = await filteredRef.current?.snapshot();
          if (!rendered) throw new Error("The filter renderer isn’t ready yet — try again.");
          return rendered;
        });
        const feedImage = await publishStep("resize", () => prepareFeedImage(shot.uri));
        finalWidth = feedImage.width;
        finalHeight = feedImage.height;
        if (isDemoMode()) {
          mediaPath = feedImage.uri; // keep the baked file locally, no upload
        } else {
          const thumb = await publishStep("resize", () => prepareThumbnail(shot.uri));
          setStage("Uploading…");
          mediaPath = await publishStep("media-upload", () =>
            uploadFile("media", ownedPath(userId, `${postId}.jpg`), feedImage.uri, "image/jpeg"),
          );
          thumbPath = await publishStep("thumbnail-upload", () =>
            uploadFile("thumbnails", ownedPath(userId, `${postId}.jpg`), thumb.uri, "image/jpeg"),
          );
        }
      }

      setStage("Saving…");
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
          filter_baked: baked,
          show_date_stamp: stampOn,
          caption: caption.trim(),
          taken_at: takenAt,
          location: location.trim() || null,
        }),
      );

      // Warm the image cache with what was just uploaded, so the feed and
      // the grid draw the new post at once instead of fetching it back
      // from the CDN. Best-effort and brief: publishing never waits on it.
      if (!isDemoMode()) {
        const warm = [
          isVideo ? null : mediaUrlString("media", mediaPath),
          mediaUrlString("thumbnails", thumbPath),
        ].filter((u): u is string => Boolean(u));
        if (warm.length > 0) {
          await Promise.race([
            Image.prefetch(warm, "memory-disk").catch(() => false),
            new Promise((resolve) => setTimeout(resolve, 1500)),
          ]);
        }
      }

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
      setStage(null);
    }
  };

  const stampLabel = dateStampText(stampIso);
  // What the contact sheet and the still are drawn from.
  const still = isVideo ? poster : { uri, width: width ?? 0, height: height ?? 0 };
  const showStill = isVideo ? bakes && Boolean(poster) && !motion : !renderFailed;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* The frame, full bleed. The plain picture underneath appears at
            once; the filtered render fades over it when the GPU is ready. */}
        <View style={[styles.preview, { aspectRatio: previewRatio }]}>
          {still?.uri ? (
            <Image source={still.uri} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : null}
          {isVideo && !showStill ? (
            <VideoPreview uri={uri} filter={filter} muted={previewMuted} />
          ) : null}
          {showStill && still?.uri ? (
            <View style={[StyleSheet.absoluteFill, { opacity: rendererReady ? 1 : 0 }]}>
              <FilteredImage
                ref={isVideo ? undefined : filteredRef}
                uri={still.uri}
                width={still.width}
                height={still.height}
                filter={filter}
                style={StyleSheet.absoluteFill}
                onReady={() => setRendererReady(true)}
                onError={() => {
                  if (!isVideo) setRenderFailed(true);
                }}
              />
            </View>
          ) : null}
          {stampOn ? <DateStamp iso={stampIso} /> : null}
          <View pointerEvents="none" style={styles.previewFilm}>
            <Text style={styles.previewFilmText}>{filter.name}</Text>
          </View>
          {isVideo ? (
            <View style={styles.previewControls}>
              {bakes && poster ? (
                <Pressable
                  style={styles.previewControl}
                  onPress={() => {
                    // Coming back to the still, the renderer starts over;
                    // let it fade in again rather than flash a blank frame.
                    setRendererReady(false);
                    setMotion((m) => !m);
                  }}
                  accessibilityLabel={motion ? "Show the still" : "Play the clip"}
                >
                  <Feather name={motion ? "pause" : "play"} size={14} color={colors.onShutter} />
                </Pressable>
              ) : null}
              {!showStill ? (
                <Pressable
                  style={styles.previewControl}
                  onPress={() => setPreviewMuted((m) => !m)}
                  accessibilityLabel={previewMuted ? "Turn sound on" : "Turn sound off"}
                >
                  <Feather name={previewMuted ? "volume-x" : "volume-2"} size={14} color={colors.onShutter} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* The contact sheet: every film on the same frame, the chosen one
            underscored in amber. No boxes — a strip of small prints. */}
        <View style={styles.sheetHead}>
          <Text style={styles.eyebrow}>Film</Text>
          <Text style={styles.sheetName}>{filter.name}</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.trayContent}
        >
          {FILTERS.map((f) => {
            const selected = f.id === filterId;
            return (
              <Pressable
                key={f.id}
                style={styles.swatchWrap}
                onPress={() => selectFilter(f.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <View style={styles.swatch}>
                  {still?.uri ? (
                    <>
                      <Image source={still.uri} style={StyleSheet.absoluteFill} contentFit="cover" />
                      <FilteredImage
                        uri={still.uri}
                        width={still.width}
                        height={still.height}
                        filter={f}
                        style={StyleSheet.absoluteFill}
                      />
                    </>
                  ) : null}
                </View>
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
          <Text style={styles.note}>
            {bakes
              ? "The film goes onto the whole clip when you post. The still shows it exactly; play shows the clip with a close approximation."
              : "On video the filter is applied as it plays rather than burned into the file, so your original footage is kept intact."}
          </Text>
        ) : renderFailed ? (
          <Text style={styles.note}>
            This photograph couldn’t be read by the filter renderer. Go back and choose it again — if it
            keeps happening, pick it from the library instead.
          </Text>
        ) : null}

        {/* The back of the print: the stamp, the place, the note. */}
        <View style={styles.rule} />
        <Pressable style={styles.stampRow} onPress={() => setStampOn(!stampOn)}>
          <View style={styles.grow}>
            <Text style={styles.eyebrow}>Date stamp</Text>
            <Text style={[styles.stampValue, !stampOn && styles.stampValueOff]}>{stampLabel}</Text>
            <Text style={styles.hint}>
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

        <View style={styles.rule} />
        <View style={styles.field}>
          <Text style={styles.eyebrow}>Where</Text>
          <TextInput
            value={location}
            onChangeText={(t) => setLocation(t.slice(0, MAX_LOCATION_LENGTH))}
            placeholder="A town, a street, a bar — optional"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            style={styles.input}
          />
        </View>
        <View style={styles.hairline} />
        <View style={styles.field}>
          <Text style={styles.eyebrow}>Caption</Text>
          <TextInput
            value={caption}
            onChangeText={(t) => setCaption(t.slice(0, MAX_CAPTION_LENGTH))}
            placeholder="Optional — keep it quiet."
            placeholderTextColor={colors.inkFaint}
            multiline
            style={[styles.input, styles.inputMultiline]}
          />
        </View>
      </ScrollView>

      {/* The publish bar stays put, so the one thing this screen is for is
          never scrolled off the bottom. */}
      <View style={styles.footer}>
        <Button title="Share to VINTAGE" onPress={publish} loading={busy} />
        {stage ? <Text style={styles.stage}>{stage}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

function VideoPreview({ uri, filter, muted }: { uri: string; filter: FilterSpec; muted: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = "duckOthers";
    p.play();
  });
  useEffect(() => {
    player.muted = muted;
    if (!muted) player.volume = 1;
  }, [player, muted]);
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

const SWATCH = 64;

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
  previewControls: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
    flexDirection: "row",
    gap: spacing.sm,
  },
  previewControl: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 25, 21, 0.6)",
  },

  eyebrow: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  sheetName: { fontFamily: type.serif, fontSize: 17, color: colors.ink },

  trayContent: { paddingHorizontal: spacing.lg, gap: spacing.md },
  swatchWrap: { alignItems: "center", width: SWATCH },
  swatch: {
    width: SWATCH,
    height: SWATCH,
    overflow: "hidden",
    backgroundColor: colors.paperSunken,
  },
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
    marginTop: 4,
  },
  swatchNameSelected: { color: colors.ink },

  filterDescription: {
    fontFamily: type.serif,
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 20,
    color: colors.inkSoft,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  note: {
    ...type.caption,
    fontSize: 12,
    color: colors.inkFaint,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },

  rule: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg, marginTop: spacing.xl },
  hairline: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg },

  stampRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  stampValue: {
    fontFamily: type.mono,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 1,
    color: colors.stamp,
    textShadowColor: colors.stampGlow,
    textShadowRadius: 5,
    textShadowOffset: { width: 0, height: 0 },
    marginTop: spacing.xs,
  },
  stampValueOff: {
    color: colors.inkFaint,
    textShadowColor: "transparent",
  },
  hint: { ...type.caption, fontSize: 12, color: colors.inkFaint, marginTop: 3 },

  field: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  input: {
    fontSize: 15,
    color: colors.ink,
    paddingVertical: spacing.sm,
    paddingHorizontal: 0,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paper,
  },
  stage: { ...type.caption, fontSize: 12, color: colors.inkFaint, textAlign: "center", marginTop: spacing.sm },
});
