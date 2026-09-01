import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { showAlert } from "@/utils/alert";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { colors, spacing, type } from "@/theme";
import { captureDateFrom } from "@/utils/exif";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";

/**
 * One photograph per post. Short videos are allowed but live in the same
 * feed and grid as everything else — there is no separate video surface.
 *
 * Laid out like the back of a camera: a wide shutter for the thing you do
 * most, two quieter plates beside it, and a line of type explaining what
 * happens next. Nothing here is a card in a rounded box.
 */
export default function Create() {
  const router = useRouter();

  const openCompose = (asset: ImagePicker.ImagePickerAsset, mediaType: "photo" | "video") => {
    router.push({
      pathname: "/compose",
      params: {
        uri: asset.uri,
        mediaType,
        width: String(asset.width ?? 0),
        height: String(asset.height ?? 0),
        duration: String(asset.duration != null ? Math.round(asset.duration / 1000) : 0),
        // When the shutter actually fired, for the date stamp. Empty when the
        // file carried no capture date.
        takenAt: captureDateFrom(asset.exif) ?? "",
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
      exif: !isVideo,
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
    openCompose(asset, mediaType);
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
    if (!result.canceled && result.assets[0]) openCompose(result.assets[0], "photo");
  };

  return (
    <Screen padded={false}>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>New post</Text>
        <Text style={styles.heading}>Share a photograph</Text>
        <Text style={styles.sub}>
          One image per post. You'll choose the film and the date stamp before it goes out.
        </Text>

        <Pressable style={styles.shutter} onPress={() => pick("photo")}>
          <View style={styles.shutterRing}>
            <Feather name="image" size={26} color={colors.onShutter} />
          </View>
          <View style={styles.shutterText}>
            <Text style={styles.shutterTitle}>From your library</Text>
            <Text style={styles.shutterSub}>Pick a photograph you've already taken</Text>
          </View>
          <Feather name="chevron-right" size={18} color="rgba(242, 235, 221, 0.5)" />
        </Pressable>

        <View style={styles.plates}>
          {/* The camera is a native affordance; browser review uses the library picker. */}
          {Platform.OS !== "web" ? (
            <Pressable style={styles.plate} onPress={takePhoto}>
              <Feather name="camera" size={20} color={colors.ink} />
              <Text style={styles.plateTitle}>Camera</Text>
              <Text style={styles.plateSub}>Take one now</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.plate} onPress={() => pick("video")}>
            <Feather name="film" size={20} color={colors.ink} />
            <Text style={styles.plateTitle}>Short video</Text>
            <Text style={styles.plateSub}>Up to {MAX_VIDEO_SECONDS}s</Text>
          </Pressable>
        </View>

        <View style={styles.spacer} />

        <View style={styles.note}>
          <View style={styles.noteRule} />
          <Text style={styles.noteText}>
            Videos sit in the same feed and the same grid as photographs. There is no separate
            place for them, and nothing here is ranked.
          </Text>
        </View>
      </View>
    </Screen>
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
  heading: { ...type.title, marginTop: spacing.sm },
  sub: { ...type.caption, marginTop: spacing.xs, lineHeight: 19, marginBottom: spacing.xl },

  shutter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    backgroundColor: colors.shutter,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  shutterRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(242, 235, 221, 0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterText: { flex: 1 },
  shutterTitle: { fontSize: 15, fontWeight: "600", color: colors.onShutter },
  shutterSub: { fontSize: 12, color: "rgba(242, 235, 221, 0.6)", marginTop: 3 },

  plates: { flexDirection: "row", gap: 1, marginTop: 1 },
  plate: {
    flex: 1,
    backgroundColor: colors.paperRaised,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  plateTitle: { fontSize: 14, fontWeight: "600", color: colors.ink, marginTop: spacing.xs },
  plateSub: { fontSize: 11, color: colors.inkFaint },

  spacer: { flex: 1 },

  note: { paddingBottom: spacing.xl },
  noteRule: { height: 1, width: 28, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  noteText: { ...type.caption, fontSize: 12, lineHeight: 19, color: colors.inkFaint },
});
