import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors } from "@/theme";
import { mediaUrl } from "@/api/media";
import { useImageRetry } from "@/media/imageRetry";

interface Props {
  path: string | null | undefined;
  username: string;
  size?: number;
}

export function Avatar({ path, username, size = 36 }: Props) {
  const url = mediaUrl("avatars", path ?? null);
  // A picture that fails to load is asked for again, as the photographs are (src/media/imageRetry.ts).
  const retry = useImageRetry(url);
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (!url) {
    return (
      <View style={[styles.fallback, round]}>
        <Text style={[styles.initial, { fontSize: size * 0.42 }]}>
          {(username[0] ?? "?").toUpperCase()}
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={url}
      style={[styles.image, round]}
      transition={80}
      recyclingKey={String(url)}
      cachePolicy="memory-disk"
      key={retry.attempt}
      onError={retry.onError}
    />
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.paperSunken, borderWidth: 1, borderColor: colors.border },
  fallback: {
    backgroundColor: colors.paperSunken,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { color: colors.inkSoft, fontWeight: "600" },
});
