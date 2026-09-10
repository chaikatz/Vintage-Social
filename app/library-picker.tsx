import React, { useMemo, useState } from "react";
import { ActivityIndicator, Dimensions, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { showAlert } from "@/utils/alert";
import { Screen } from "@/components/Screen";
import { EmptyState } from "@/components/EmptyState";
import { colors, spacing, type } from "@/theme";
import { signatureDate } from "@/utils/time";
import {
  composeParamsFor,
  libraryGranted,
  photosFromSameNight,
  photosOnThisDay,
  type LibraryPhoto,
} from "@/utils/library";

/**
 * A handful of the member's own photographs, picked out of the library for
 * a reason — the rest of one night's roll, or this day in earlier years —
 * laid out to choose one from. Choosing opens the darkroom on it exactly as
 * if it had come from the ordinary picker. Nothing here is uploaded; the
 * thumbnails are read straight off the phone.
 */
export default function LibraryPicker() {
  const router = useRouter();
  const { mode, iso, title } = useLocalSearchParams<{
    mode: "night" | "day";
    iso?: string;
    title?: string;
  }>();
  const [opening, setOpening] = useState<string | null>(null);

  const photos = useQuery({
    queryKey: ["library-picker", mode, iso ?? new Date().toDateString()],
    queryFn: async (): Promise<Section[]> => {
      if (!(await libraryGranted(true))) return [];
      if (mode === "night" && iso) {
        return [{ key: "night", label: signatureDate(iso), photos: await photosFromSameNight(iso, 120) }];
      }
      const days = await photosOnThisDay();
      return days.map((d) => ({
        key: String(d.yearsAgo),
        label: d.yearsAgo === 1 ? "1 year ago" : `${d.yearsAgo} years ago`,
        photos: d.photos,
      }));
    },
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const s of photos.data ?? []) {
      if (s.photos.length === 0) continue;
      out.push({ kind: "label", key: `label-${s.key}`, label: s.label });
      for (let i = 0; i < s.photos.length; i += 3) {
        out.push({ kind: "photos", key: `${s.key}-${i}`, photos: s.photos.slice(i, i + 3) });
      }
    }
    return out;
  }, [photos.data]);

  const choose = async (photo: LibraryPhoto) => {
    setOpening(photo.id);
    try {
      const params = await composeParamsFor(photo);
      if (!params) {
        showAlert("Couldn’t open that one", "It may still be in iCloud. Try again in a moment.");
        return;
      }
      router.push({ pathname: "/compose", params });
    } finally {
      setOpening(null);
    }
  };

  const size = (Dimensions.get("window").width - GAP * 2) / 3;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: title ?? (mode === "night" ? "That night" : "On this day") }} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ gap: GAP, paddingBottom: spacing.xxl }}
        ListEmptyComponent={
          photos.isFetched ? (
            <EmptyState
              title="Nothing from then"
              body="VINTAGE can only look at the photographs it has been allowed to see."
            />
          ) : (
            <ActivityIndicator style={{ marginTop: spacing.xxl }} color={colors.inkFaint} />
          )
        }
        renderItem={({ item }) =>
          item.kind === "label" ? (
            <Text style={styles.label}>{item.label}</Text>
          ) : (
            <View style={{ flexDirection: "row", gap: GAP }}>
              {item.photos.map((p) => (
                <Pressable key={p.id} onPress={() => choose(p)} style={{ width: size, height: size }}>
                  <Image source={p.uri} style={styles.cell} contentFit="cover" transition={60} />
                  {opening === p.id ? (
                    <View style={styles.opening}>
                      <ActivityIndicator color={colors.onShutter} />
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )
        }
      />
    </Screen>
  );
}

const GAP = 2;

interface Section {
  key: string;
  label: string;
  photos: LibraryPhoto[];
}
type Row =
  | { kind: "label"; key: string; label: string }
  | { kind: "photos"; key: string; photos: LibraryPhoto[] };

const styles = StyleSheet.create({
  label: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.inkFaint,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  cell: { flex: 1, backgroundColor: colors.paperSunken },
  opening: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 25, 21, 0.45)",
  },
});
