import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { showAlert } from "@/utils/alert";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { colors, radii, spacing, type } from "@/theme";
import { captureDateFrom } from "@/utils/exif";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";

/**
 * One photograph per post. Short videos are allowed but live in the same
 * feed and grid as everything else — there is no separate video surface.
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
    <Screen>
      <Text style={styles.heading}>Share a photograph</Text>
      <Text style={styles.sub}>One image per post. Choose a filter before you publish.</Text>

      <Pressable style={styles.option} onPress={() => pick("photo")}>
        <Feather name="image" size={22} color={colors.ink} />
        <View style={styles.optionText}>
          <Text style={styles.optionTitle}>From your library</Text>
          <Text style={styles.optionSub}>Pick a photograph</Text>
        </View>
      </Pressable>

      {/* The camera is a native affordance; browser review uses the library picker. */}
      {Platform.OS !== "web" ? (
      <Pressable style={styles.option} onPress={takePhoto}>
        <Feather name="camera" size={22} color={colors.ink} />
        <View style={styles.optionText}>
          <Text style={styles.optionTitle}>Camera</Text>
          <Text style={styles.optionSub}>Take one now</Text>
        </View>
      </Pressable>
      ) : null}

      <Pressable style={styles.option} onPress={() => pick("video")}>
        <Feather name="film" size={22} color={colors.ink} />
        <View style={styles.optionText}>
          <Text style={styles.optionTitle}>Short video</Text>
          <Text style={styles.optionSub}>Up to {MAX_VIDEO_SECONDS} seconds, lives in the same feed</Text>
        </View>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { ...type.title, marginTop: spacing.xl },
  sub: { ...type.caption, marginTop: spacing.xs, marginBottom: spacing.xl },
  option: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.paperRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    marginBottom: spacing.md,
  },
  optionText: { marginLeft: spacing.md },
  optionTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  optionSub: { fontSize: 12, color: colors.inkFaint, marginTop: 2 },
});
