import React, { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { showAlert } from "@/utils/alert";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { colors, spacing, type } from "@/theme";
import { prepareForDarkroom } from "@/api/media";
import { captureDateForAsset } from "@/utils/captureDate";
import { composeParamsFor, libraryGranted, randomOldPhoto } from "@/utils/library";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";

/**
 * Where a post begins.
 *
 * One photograph per post. Short videos are allowed but live in the same
 * feed and grid as everything else — there is no separate video surface.
 *
 * Set like the rest of VINTAGE: a serif line, then quiet rows ruled off
 * with hairlines, each a way of finding a picture. The library first,
 * because that is where the photographs are; the camera and a short clip
 * beside it; then the two ways of looking back into the roll. Nothing
 * here is a card, a plate or a dark block.
 */
export default function Create() {
  const router = useRouter();
  const [finding, setFinding] = useState(false);

  // One photograph from further back than you were going to look. It is
  // the same darkroom as any other post; only the choosing is different.
  const findSomething = async () => {
    if (finding) return;
    setFinding(true);
    try {
      if (!(await libraryGranted(true))) {
        showAlert(
          "Nothing to look through",
          "VINTAGE needs to see your photo library to find something in it. You can allow this in Settings.",
        );
        return;
      }
      const photo = await randomOldPhoto();
      const params = photo ? await composeParamsFor(photo) : null;
      if (!params) {
        showAlert("Nothing older to find", "Everything in your library is from the last few months.");
        return;
      }
      router.push({ pathname: "/compose", params });
    } finally {
      setFinding(false);
    }
  };

  const openCompose = async (asset: ImagePicker.ImagePickerAsset, mediaType: "photo" | "video") => {
    // EXIF first, then the photo library — video carries no EXIF at all, so
    // the library is the only place its real date exists.
    const takenAt = await captureDateForAsset(asset);
    // The editor hands over a JPEG. Anything else — a HEIC that skipped the
    // editor, say — is decoded properly first, or the renderer shows black.
    let { uri, width, height } = asset;
    if (mediaType === "photo" && !/\.(jpe?g|png)$/i.test(uri.split("?")[0])) {
      try {
        const ready = await prepareForDarkroom(uri);
        uri = ready.uri;
        width = ready.width;
        height = ready.height;
      } catch {
        // Fall through with the original; the darkroom reports what it can't read.
      }
    }
    router.push({
      pathname: "/compose",
      params: {
        uri,
        mediaType,
        width: String(width ?? 0),
        height: String(height ?? 0),
        duration: String(asset.duration != null ? Math.round(asset.duration / 1000) : 0),
        // When the shutter actually fired, for the date stamp. Empty when
        // neither the file nor the library knew.
        takenAt: takenAt ?? "",
      },
    });
  };

  const pick = async (mediaType: "photo" | "video") => {
    const isVideo = mediaType === "video";
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: isVideo ? ["videos"] : ["images"],
      // Videos open the system trimmer so a long clip can be cut down to
      // length here, instead of being picked and then refused. iOS only —
      // on Android and web the editor handles images alone.
      allowsEditing: !isVideo || Platform.OS === "ios",
      aspect: [4, 5],
      quality: 1,
      // Only honoured alongside allowsEditing; it caps the trimmer.
      videoMaxDuration: MAX_VIDEO_SECONDS,
      exif: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (isVideo && asset.duration != null && asset.duration > (MAX_VIDEO_SECONDS + 1) * 1000) {
      showAlert(
        "Too long",
        `Videos on VINTAGE are at most ${MAX_VIDEO_SECONDS} seconds. Trim this one and try again.`,
      );
      return;
    }
    await openCompose(asset, mediaType);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 5],
      quality: 1,
      exif: true,
    });
    if (!result.canceled && result.assets[0]) await openCompose(result.assets[0], "photo");
  };

  const native = Platform.OS !== "web";

  return (
    <Screen padded={false}>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>New post</Text>
        <Text style={styles.heading}>Share a photograph.</Text>
        <Text style={styles.sub}>One picture at a time. You choose the film and the date stamp next.</Text>

        <View style={styles.rule} />
        <Row
          icon="image"
          title="From your library"
          body="A photograph you've already taken"
          onPress={() => pick("photo")}
          primary
        />
        {native ? (
          <>
            <View style={styles.hairline} />
            <Row icon="camera" title="Camera" body="Take one now" onPress={takePhoto} />
          </>
        ) : null}
        <View style={styles.hairline} />
        <Row icon="film" title="Short video" body={`Up to ${MAX_VIDEO_SECONDS} seconds, same feed, same grid`} onPress={() => pick("video")} />
        <View style={styles.rule} />

        {/* The back of the drawer: the library read for what is already in it. */}
        {native ? (
          <>
            <Text style={[styles.eyebrow, styles.eyebrowSpaced]}>Look back</Text>
            <Row
              icon="sun"
              title="On this day"
              body="What you shot on this date in other years"
              onPress={() => router.push("/memories")}
            />
            <View style={styles.hairline} />
            <Row
              icon="shuffle"
              title="Find me something"
              body="One photograph, at random, from a while ago"
              onPress={findSomething}
              busy={finding}
            />
            <View style={styles.rule} />
          </>
        ) : null}

        <View style={styles.spacer} />
        <Text style={styles.note}>Nothing here is ranked. A photograph is seen by the people who follow you, in the order it was posted.</Text>
      </View>
    </Screen>
  );
}

function Row({
  icon,
  title,
  body,
  onPress,
  primary = false,
  busy = false,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  body: string;
  onPress: () => void;
  primary?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={[styles.ring, primary && styles.ringPrimary]}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.inkSoft} />
        ) : (
          <Feather name={icon} size={18} color={primary ? colors.onShutter : colors.ink} />
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: spacing.lg },

  eyebrow: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
    marginTop: spacing.xl,
  },
  eyebrowSpaced: { marginTop: spacing.lg, marginBottom: spacing.xs },
  heading: { ...type.title, fontSize: 26, marginTop: spacing.sm },
  sub: { ...type.caption, marginTop: spacing.xs, lineHeight: 19 },

  rule: { height: 1, backgroundColor: colors.borderStrong, marginTop: spacing.xl },
  hairline: { height: 1, backgroundColor: colors.border },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md + 2,
  },
  rowPressed: { opacity: 0.6 },
  ring: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  ringPrimary: { backgroundColor: colors.shutter, borderColor: colors.shutter },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  rowBody: { fontSize: 12, color: colors.inkFaint, marginTop: 2 },

  spacer: { flex: 1 },
  note: { ...type.caption, fontSize: 12, lineHeight: 18, color: colors.inkFaint, paddingBottom: spacing.xl },
});
