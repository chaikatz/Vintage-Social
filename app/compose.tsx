import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
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
import * as Crypto from "expo-crypto";
import * as VideoThumbnails from "expo-video-thumbnails";
import { useVideoPlayer, VideoView } from "expo-video";
import { Image } from "expo-image";
import Feather from "@expo/vector-icons/Feather";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { DateStamp } from "@/components/DateStamp";
import { colors, hairline, radii, spacing, type } from "@/theme";
import { BAKE_MAX_SIDE, FILTERS, FilteredImage, dateStampStartsOn, getFilter } from "@/filters";
import { isNoFilter } from "@/filters/presets";
import type { FilteredImageHandle, FilterSpec } from "@/filters";
import { FilterOverlay } from "@/components/FilterOverlay";
import { cssFilterFor } from "@/filters/cssFilter";
import { canBakeVideo } from "@/filters/bakeVideo";
import { prepareImage } from "@/media/nativeMedia";
import { TagPicker, type Taggable } from "@/components/TagPicker";
import { Avatar } from "@/components/Avatar";
import { PlacePicker, type PlaceChoice } from "@/components/PlacePicker";
import { placeFields } from "@/api/places";
import { isDemoMode } from "@/lib/env";
import { enqueuePost } from "@/uploads";
import { useSession } from "@/providers/SessionProvider";
import { MAX_CAPTION_LENGTH } from "@/utils/validation";
import { dateStampText } from "@/utils/time";
import { perfStart } from "@/utils/perf";
import {
  authorFrom,
  bakesOnScreen,
  buildPostDraft,
  createShareGuard,
  developForPost,
  type ComposeChoices,
  type DevelopInput,
  type PlaceInput,
} from "@/utils/composeDraft";

/**
 * The film tray draws fifteen swatches 70 pt square, about 210 px on a 3x
 * phone. Each is its own renderer, and each used to decode the full 2048 px
 * photograph (or a 4K poster frame) on the JS thread to draw that much.
 * One small copy, made once, is all fifteen need.
 */
const TRAY_MAX_SIDE = 240;
const TRAY_QUALITY = 0.85;
/** A clip's still preview: the frame the film is judged on, at the feed's size. */
const STILL_MAX_SIDE = 1440;
const STILL_QUALITY = 0.9;

/** Where Share is: choosing, developing the film into the photograph, or handed to the outbox. */
type Phase = "editing" | "developing" | "posted";

/** A picture on this phone and its pixel size. */
interface Frame {
  uri: string;
  width: number;
  height: number;
}

/**
 * The darkroom: choose a VINTAGE filter, optionally the amber date stamp,
 * name the place, write a caption, share. A photograph's film is developed
 * here, through the renderer on screen; everything after that (preparing,
 * uploading, saving, a clip's own bake) happens in the outbox, which keeps
 * going on Home while the post shows as pending. The stamp shows when the
 * shutter fired rather than when the post was made.
 */
export default function Compose() {
  const router = useRouter();
  const { session, profile } = useSession();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    uri: string;
    mediaType: "photo" | "video";
    width: string;
    height: string;
    duration: string;
    takenAt: string;
    /** Set when the Darkroom opened the editor: the library identifier of the photograph. */
    assetId?: string;
    from?: string;
  }>();

  const uri = params.uri ?? "";
  const isVideo = params.mediaType === "video";
  const width = Number(params.width) || null;
  const height = Number(params.height) || null;

  const [filterId, setFilterId] = useState(FILTERS[0].id);
  const filter = getFilter(filterId);
  const [stampOn, setStampOn] = useState(dateStampStartsOn(FILTERS[0].id));
  const [caption, setCaption] = useState("");
  // Where it was taken: a place chosen from the map, or words alone.
  const [place, setPlace] = useState<PlaceChoice>(null);
  const [placing, setPlacing] = useState(false);
  const location = place?.kind === "place" ? place.place.name : place?.kind === "text" ? place.text : "";
  // Who was there. Sent with the post; each of them decides.
  const [tags, setTags] = useState<Taggable[]>([]);
  const [picking, setPicking] = useState(false);

  // One post per visit to this screen. The id is the post's from the first
  // tap: the outbox keys both uploads and the insert by it, so a Share that
  // is tried again after a failure is the same post, never a second one.
  const [postId] = useState(() => Crypto.randomUUID());
  // Checked and set in the tap itself; the button only disables after a render.
  const [guard] = useState(createShareGuard);
  const [phase, setPhase] = useState<Phase>("editing");
  const busy = phase !== "editing";
  // Said under the button while the film is being developed, the one wait
  // left on this screen. A spinner alone reads as stuck.
  const [stage, setStage] = useState<string | null>(null);
  // The tap-to-Home timing, ended when the screen actually leaves.
  const leaveTimerRef = useRef<((extra?: Record<string, unknown>) => number) | null>(null);
  const leftRef = useRef(false);

  const filteredRef = useRef<FilteredImageHandle>(null);
  // The renderer could not read the file. Rare now that every photograph
  // is decoded to a JPEG before it gets here, but a black frame must never
  // be what gets posted: the photograph then goes up unbaked.
  const [renderFailed, setRenderFailed] = useState(false);
  // Video: the still frame shows the film exactly; "motion" plays the clip
  // over it with the play-time approximation, muted unless asked.
  const [motion, setMotion] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(true);
  const bakes = isVideo && canBakeVideo();

  // The small copy every swatch in the tray draws from, and for a clip the
  // still its film is shown on. Both come from one decode, made once.
  const [tray, setTray] = useState<Frame | null>(null);
  const [still, setStill] = useState<Frame | null>(null);
  useEffect(() => {
    if (!uri) return;
    let live = true;
    void (async () => {
      if (!isVideo) {
        try {
          const small = await prepareImage(uri, { maxSide: TRAY_MAX_SIDE, quality: TRAY_QUALITY });
          if (live) setTray(sized(small));
        } catch {
          // The swatches stay as empty wells; the films are still named under them.
        }
        return;
      }
      // A clip's poster frame, pulled once. The film is judged on it, and
      // the tray shows real frames instead of empty wells. The outbox cuts
      // its own poster from the finished clip, so this one is for the
      // screen only.
      let poster: Frame;
      try {
        const frame = await VideoThumbnails.getThumbnailAsync(uri, { time: 500 });
        poster = { uri: frame.uri, width: frame.width, height: frame.height };
      } catch {
        return;
      }
      try {
        // The frame comes out at the clip's own resolution, 4K from most
        // phones. Brought down to the feed's size for the still, and to the
        // tray's size from the same decode.
        const prepared = await prepareImage(
          poster.uri,
          bakes
            ? { maxSide: STILL_MAX_SIDE, quality: STILL_QUALITY, thumbSide: TRAY_MAX_SIDE, thumbQuality: TRAY_QUALITY }
            : { maxSide: TRAY_MAX_SIDE, quality: TRAY_QUALITY },
        );
        if (!live) return;
        if (bakes) {
          setStill(sized(prepared));
          setTray(prepared.thumb ? sized(prepared.thumb) : null);
        } else {
          setTray(sized(prepared));
        }
      } catch {
        // One renderer can still read the full frame; fifteen should not.
        if (live && bakes) setStill(poster);
      }
    })();
    return () => {
      live = false;
    };
  }, [uri, isVideo, bakes]);

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
  // still works, and asks first once there are words worth keeping. While
  // the film is being developed the post is half made, so leaving is held
  // and the back button is not offered; once the outbox has the post the
  // screen may go, and does.
  const hasWritten = caption.trim().length > 0 || location.trim().length > 0;
  usePreventRemove(phase === "developing" || (phase === "editing" && hasWritten), ({ data }) => {
    // A render behind the guard: the post is already in the outbox.
    if (guard.state === "shared") {
      navigation.dispatch(data.action);
      return;
    }
    if (guard.state === "sharing") return;
    showAlert("Discard this post?", "Your caption and location will be lost.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });
  useEffect(() => {
    navigation.setOptions({ headerBackVisible: phase === "editing" });
  }, [navigation, phase]);

  // Home, once the outbox has the post. Done after the render that turned
  // the discard prompt off, so leaving is never mistaken for discarding.
  // dismissTo pops back to the tabs that are already there: their route
  // keeps its key and Home is not mounted again, where replacing the route
  // rebuilt every tab while the feed refetched. Should something have been
  // opened over this screen meanwhile (a tapped notification), the member
  // is not pulled off it: the screen goes once it is back in front.
  useEffect(() => {
    if (phase !== "posted") return;
    const leave = () => {
      if (leftRef.current) return;
      leftRef.current = true;
      leaveTimerRef.current?.({ kind: isVideo ? "video" : "photo" });
      leaveTimerRef.current = null;
      router.dismissTo("/(tabs)");
    };
    if (navigation.isFocused()) {
      leave();
      return;
    }
    return navigation.addListener("focus", leave);
  }, [phase, router, navigation, isVideo]);

  /** The film into the photograph's pixels, at the feed's size, through the renderer on screen. */
  const bakeOnScreen = async () => {
    const done = perfStart("post.bake");
    try {
      const out = await filteredRef.current?.bake({ maxSide: BAKE_MAX_SIDE });
      done({ ok: out != null, width: out?.width ?? null, height: out?.height ?? null });
      return out;
    } catch (err) {
      done({ ok: false, code: (err as { code?: unknown } | null)?.code ?? null });
      throw err;
    }
  };

  const share = async () => {
    const userId = session?.user?.id;
    if (!userId || !guard.begin()) return;
    const toHome = perfStart("post.tap→home");
    Keyboard.dismiss();

    // Everything the post will say, as it stands at the tap. The screen is
    // frozen from here (see the scroll content below), and nothing later
    // reads the live state, so a word typed or a film tapped during the
    // bake can neither go missing nor disagree with the pixels.
    const kind = isVideo ? "video" : "photo";
    const placeInput: PlaceInput =
      place?.kind === "place"
        ? { kind: "place", fields: placeFields(place.place) }
        : place?.kind === "text"
          ? { kind: "text", text: place.text }
          : null;
    const choices: ComposeChoices = {
      postId,
      userId,
      kind,
      duration: params.duration,
      filterId,
      showDateStamp: stampOn,
      caption,
      takenAt,
      place: placeInput,
      tagIds: tags.map((t) => t.id),
      assetId: params.assetId ?? null,
      author: authorFrom(profile, userId),
    };
    const develop: DevelopInput = {
      kind,
      uri,
      width,
      height,
      filterId,
      renderFailed,
      canBakeVideo: canBakeVideo(),
      demo: isDemoMode(),
    };

    setPhase("developing");
    if (bakesOnScreen(develop)) setStage("Developing…");
    try {
      const developed = await developForPost(develop, bakeOnScreen);
      setStage(null);
      // A file copy and a small record on this phone; the outbox takes it
      // from there, and its own copy outlives this screen and the
      // Darkroom's developed file.
      await enqueuePost(buildPostDraft(choices, developed));
    } catch {
      // Only keeping the post on this phone can fail here: the network is
      // the outbox's business. The member is still on the screen, so
      // nothing chosen is lost; Share is offered again.
      guard.fail();
      setStage(null);
      setPhase("editing");
      showAlert(
        "Not shared yet",
        "VINTAGE couldn’t keep a copy on this phone to send. It may be short of space. Everything you chose is still here; try again in a moment.",
      );
      return;
    }
    guard.succeed();
    leaveTimerRef.current = toHome;
    setPhase("posted");
  };

  const stampLabel = dateStampText(stampIso);
  // A clip plays over its still when asked to, and in place of it until the
  // still exists or where the build cannot put the film into a clip.
  const moving = isVideo && (!bakes || !still || motion);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.root}
        // Frozen while the film is developed and the post handed over. This
        // is a prop change on an ancestor of every renderer, which is safe
        // only because ScrollView marks its content view collapsable={false}:
        // it is always a native view, so Fabric never flattens it and the GL
        // views under it never move.
        contentContainerStyle={[styles.scroll, busy && styles.frozen]}
        keyboardShouldPersistTaps="handled"
        // Pulling the page down puts the keyboard away with the same
        // gesture, and the caption field is kept above it while it is up.
        keyboardDismissMode="interactive"
      >
        {/* The frame, full bleed, with the film stock struck across the
            bottom-left the way a lab writes it on the sleeve.

            Each renderer is a direct child of this view, never wrapped in
            a view of its own. A wrapper whose style comes and goes (an
            opacity while the film loads) is flattened away and restored by
            Fabric, which re-parents the GL view, and expo-gl destroys its
            context when it is taken off its parent: filters stopped
            changing and the bake failed. The plain picture stays mounted
            under the renderer for good, so the frame is never bare while it
            warms up; the GL frame is opaque and covers it once drawn. Held
            in memory only: the file may be a developed copy that is deleted
            if it is not posted, and must leave no copy in the image cache
            on disk. */}
        <View style={[styles.preview, { aspectRatio: previewRatio }]}>
          {isVideo ? (
            <>
              {bakes && still ? (
                <>
                  <Image source={still.uri} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory" />
                  {/* One frame through the same renderer that bakes
                      photographs: the look the clip will be posted with. */}
                  <FilteredImage
                    uri={still.uri}
                    width={still.width}
                    height={still.height}
                    filter={filter}
                    style={StyleSheet.absoluteFill}
                  />
                </>
              ) : null}
              {/* Laid over the still rather than swapped for it, so playing
                  and stopping never makes the still's renderer again. */}
              {moving ? <VideoPreview uri={uri} filter={filter} muted={previewMuted} /> : null}
            </>
          ) : (
            <>
              <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory" />
              {!renderFailed ? (
                <FilteredImage
                  ref={filteredRef}
                  uri={uri}
                  width={width}
                  height={height}
                  filter={filter}
                  style={StyleSheet.absoluteFill}
                  onError={() => setRenderFailed(true)}
                />
              ) : null}
            </>
          )}
          {stampOn ? <DateStamp iso={stampIso} /> : null}
          {/* The stock, written on the sleeve — nothing written when there is none. */}
          {!isNoFilter(filterId) ? (
            <View pointerEvents="none" style={styles.previewFilm}>
              <Text style={styles.previewFilmText}>{filter.name}</Text>
            </View>
          ) : null}
          {isVideo ? (
            <View style={styles.previewControls}>
              {bakes && still ? (
                <Pressable
                  style={styles.previewControl}
                  onPress={() => setMotion((m) => !m)}
                  accessibilityLabel={motion ? "Show the still" : "Play the clip"}
                >
                  <Feather name={motion ? "pause" : "play"} size={14} color={colors.onShutter} />
                </Pressable>
              ) : null}
              {moving ? (
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
                {/* The swatch is its own sunken well until the tray's copy
                    exists, then the film drawn on that copy, at its own
                    size so the crop is not stretched. */}
                <View style={[styles.swatch, selected && styles.swatchSelected]}>
                  {tray ? (
                    <FilteredImage
                      uri={tray.uri}
                      width={tray.width}
                      height={tray.height}
                      filter={f}
                      style={styles.swatchImage}
                    />
                  ) : null}
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
            {bakes
              ? "The film goes onto the whole clip when you post. The still shows it exactly; play shows the clip with a close approximation."
              : "On video the filter is applied as it plays rather than burned into the file, so your original footage is kept intact."}
          </Text>
        ) : renderFailed ? (
          <Text style={styles.videoNote}>
            The filter renderer couldn’t read this photograph, so the preview shows it plain. You can still
            post it — the film is applied on screen — or go back and choose it again.
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

        <SectionLabel>Who was there</SectionLabel>
        <Pressable style={styles.tagRow} onPress={() => setPicking(true)} accessibilityLabel="Tag members">
          <View style={styles.grow}>
            {tags.length > 0 ? (
              <View style={styles.tagFaces}>
                {tags.slice(0, 6).map((t) => (
                  <Avatar key={t.id} path={t.avatar_url} username={t.username} size={24} />
                ))}
                <Text style={styles.tagNames} numberOfLines={1}>
                  {tags.map((t) => t.username).join(", ")}
                </Text>
              </View>
            ) : (
              <Text style={styles.stampHint}>
                Tag the members in the picture. Each decides whether it shows on their profile.
              </Text>
            )}
          </View>
          <Feather name="chevron-right" size={16} color={colors.inkFaint} />
        </Pressable>
        <TagPicker
          visible={picking}
          myId={session?.user?.id ?? ""}
          selected={tags}
          onChange={setTags}
          onClose={() => setPicking(false)}
        />

        <SectionLabel>Where</SectionLabel>
        <Pressable style={styles.tagRow} onPress={() => setPlacing(true)} accessibilityLabel="Choose a place">
          <View style={styles.grow}>
            {place ? (
              <>
                <Text style={styles.placeName} numberOfLines={1}>
                  {location}
                </Text>
                <Text style={styles.stampHint} numberOfLines={1}>
                  {place.kind === "place"
                    ? place.place.subtitle || "On the map"
                    : "Just the words — no point on the map"}
                </Text>
              </>
            ) : (
              <Text style={styles.stampHint}>Optional — a restaurant, a beach, a town. It pins the photograph on your map.</Text>
            )}
          </View>
          {place ? (
            <Pressable hitSlop={10} onPress={() => setPlace(null)} accessibilityLabel="Remove the place">
              <Feather name="x" size={16} color={colors.inkFaint} />
            </Pressable>
          ) : (
            <Feather name="chevron-right" size={16} color={colors.inkFaint} />
          )}
        </Pressable>
        <PlacePicker visible={placing} value={place} onChange={setPlace} onClose={() => setPlacing(false)} />

        <SectionLabel>The note</SectionLabel>
        <View style={styles.fields}>
          <TextField
            label="Caption"
            value={caption}
            onChangeText={(t) => setCaption(t.slice(0, MAX_CAPTION_LENGTH))}
            editable={!busy}
            multiline
            placeholder="Optional — keep it quiet."
          />
        </View>
      </ScrollView>

      {/* The publish bar stays put, so the one thing this screen is for is
          never scrolled off the bottom. */}
      <View style={styles.footer}>
        <Button title="Share to VINTAGE" onPress={share} loading={busy} />
        {stage ? <Text style={styles.stage}>{stage}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Just the picture's file and size, from a prepared image that may carry more. */
function sized(file: Frame): Frame {
  return { uri: file.uri, width: file.width, height: file.height };
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingBottom: spacing.xl },
  frozen: { pointerEvents: "none" },
  grow: { flex: 1 },

  preview: {
    width: "100%",
    backgroundColor: colors.shutter,
    overflow: "hidden",
  },
  previewFilm: { position: "absolute", left: spacing.lg, bottom: spacing.md },
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
    borderRadius: radii.round,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 25, 21, 0.6)",
  },
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
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  tagFaces: { flexDirection: "row", alignItems: "center", gap: 6 },
  tagNames: { flex: 1, fontSize: 13, color: colors.ink, marginLeft: 4 },
  placeName: { fontSize: 15, color: colors.ink },
  stage: { ...type.caption, fontSize: 12, color: colors.inkFaint, textAlign: "center", marginTop: spacing.sm },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paper,
  },
});
