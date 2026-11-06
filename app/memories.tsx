import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { EmptyState } from "@/components/EmptyState";
import { Bone } from "@/components/Skeleton";
import { colors, spacing, type } from "@/theme";
import { fetchUserPosts } from "@/api/posts";
import { mediaUrl } from "@/api/media";
import { memoryHeadline, onThisDay } from "@/utils/memories";
import { editEras } from "@/utils/eraEdits";
import { signatureDate } from "@/utils/time";
import { showAlert } from "@/utils/alert";
import { onReturnFromBackground } from "@/utils/appReturn";
import {
  chooseMorePhotos,
  composeParamsFor,
  dayRows,
  libraryAccess,
  openLibrarySettings,
  photoLabel,
  photosOnThisDay,
  watchLibrary,
  type DayRow,
  type LibraryPhoto,
} from "@/utils/library";
import { darkroomAvailable } from "@/darkroom/source";
import { useSession } from "@/providers/SessionProvider";
import { useEraEdits } from "@/hooks/useEraEdits";
import type { PostRow } from "@/types/db";

// A row that breaks this screen breaks only this screen (src/navigation/Recover.tsx).
export { RecoverPage as ErrorBoundary } from "@/navigation/Recover";

/**
 * On this day.
 *
 * The member's own past, read by the day the shutter fired: what they
 * posted from this date in other years, what the phone still has from it,
 * and further down the eras their grid falls into — a place and a year,
 * or a season when no place was written, under the names the member gave
 * them and as they arranged them on their profile. All of it is computed
 * on the phone from dates already on the photographs; VINTAGE keeps no
 * diary, only the member's own names and moves for their eras.
 *
 * The headline is the sentence a notification will carry once there are
 * notifications, so the two read the same.
 *
 * This screen never asks for the photo library. When access has already
 * been given it shows every photograph from this day in every earlier
 * year, as a contact sheet a year at a time, drawn only as it scrolls
 * into view; one tapped opens in the editor. When access has not been
 * given, it offers the Darkroom's On this day instead, and the Darkroom's
 * own first page is the one place that asks. When only some photographs
 * were shared, it says so, with a way to share more. The library's
 * thumbnails are kept in memory only, so no copy of a photograph from the
 * library is written to the phone's disk by this screen.
 */
export default function Memories() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";

  const posts = useQuery({
    queryKey: ["user-posts", userId],
    queryFn: () => fetchUserPosts(userId),
    enabled: Boolean(userId),
  });
  const memories = useMemo(() => onThisDay(posts.data ?? []), [posts.data]);
  // The eras as the profile shows them: gathered automatically, named and
  // arranged as the member left them. Not drawn until the arrangement has
  // been read, so a name never changes under the reader, as on the
  // profile. A read that fails, or finds no table, has been read too.
  const eraEdits = useEraEdits(userId);
  const eras = useMemo(
    () => (eraEdits.isFetched ? editEras(posts.data ?? [], eraEdits.data?.edits) : []),
    [posts.data, eraEdits.data, eraEdits.isFetched],
  );

  const dayKey = new Date().toDateString();
  const access = useQuery({
    queryKey: ["library-access"],
    queryFn: libraryAccess,
    enabled: Platform.OS !== "web",
  });
  const reach = access.data;
  const granted = reach === "all" || reach === "limited";
  // Every photograph from the day, however many. Asked again when the
  // access changes, with the last answer kept on the page meanwhile.
  const library = useQuery({
    queryKey: ["library-on-this-day", dayKey, reach],
    queryFn: async () => ((await libraryAccess()) !== "none" ? photosOnThisDay() : []),
    enabled: Platform.OS !== "web" && granted,
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
  });

  // Access read again, and under a chosen selection the photographs too,
  // which may have changed while the access stayed the same.
  const reachNow = useRef(reach);
  reachNow.current = reach;
  const lookAgain = useCallback(
    (photographs: boolean) => {
      void queryClient.invalidateQueries({ queryKey: ["library-access"] });
      if (photographs) void queryClient.invalidateQueries({ queryKey: ["library-on-this-day"] });
    },
    [queryClient],
  );

  // Coming back from the Darkroom, where access may just have been given.
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) lookAgain(reachNow.current === "limited");
      focusedBefore.current = true;
    }, [lookAgain]),
  );

  // Coming back from Settings: a return from the background only. Control
  // Center or a system question over the page used to count too, and read
  // the access and, under a chosen selection, the day's photographs again
  // across every year in the library (appReturn.ts).
  useEffect(() => {
    if (Platform.OS === "web") return;
    return onReturnFromBackground(() => lookAgain(reachNow.current === "limited"));
  }, [lookAgain]);

  // iOS's sheet for sharing more says nothing when it closes; the library
  // changing does, as it does for photographs arriving or taken away.
  useEffect(() => (granted ? watchLibrary(() => lookAgain(true)) : undefined), [granted, lookAgain]);

  const chooseMore = async () => {
    if (!(await chooseMorePhotos())) openLibrarySettings();
  };

  // A photograph from the library opens in the editor, as one picked
  // from the library does. One tap, one editor.
  const [opening, setOpening] = useState<string | null>(null);
  const openPhoto = async (photo: LibraryPhoto) => {
    if (opening) return;
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

  // The Darkroom's On this day, opened at the first photograph of `year`
  // when one is given. Where there is no Darkroom, the day's grid.
  const openDay = (year?: number) => {
    if (!darkroomAvailable()) {
      router.push({ pathname: "/library-picker", params: { mode: "day" } });
      return;
    }
    router.push({
      pathname: "/darkroom",
      params: year != null ? { mode: "on-this-day", year: String(year) } : { mode: "on-this-day" },
    });
  };

  const openPost = (post: PostRow) => {
    queryClient.setQueryData(["post", post.id], undefined);
    router.push(`/post/${post.id}`);
  };

  const today = new Date();
  const libraryTotal = (library.data ?? []).reduce((n, d) => n + d.photos.length, 0);
  const nothing =
    posts.isFetched &&
    eraEdits.isFetched &&
    memories.length === 0 &&
    eras.length === 0 &&
    (reach === "none" || libraryTotal === 0);

  const showLibrary = Platform.OS !== "web" && (reach !== "none" || darkroomAvailable());
  // The library's photographs as rows of the list, each drawn only as it scrolls into view.
  const rows = useMemo(
    () => (showLibrary && granted ? dayRows(library.data ?? [], PER_ROW) : []),
    [showLibrary, granted, library.data],
  );

  const renderRow = ({ item }: { item: DayRow }) => {
    const day = item.day;
    if (item.kind === "year") {
      const title = day.yearsAgo === 1 ? "1 year ago" : `${day.yearsAgo} years ago`;
      const count = `${day.photos.length} ${day.photos.length === 1 ? "photograph" : "photographs"}`;
      const words = (
        <View style={styles.dayText}>
          <Text style={styles.dayTitle}>{title}</Text>
          <Text style={styles.dayCount}>{count}</Text>
        </View>
      );
      // Where there is a Memory Room, the year's heading opens it there.
      return darkroomAvailable() ? (
        <Pressable
          style={({ pressed }) => [styles.dayRow, pressed && styles.pressed]}
          onPress={() => openDay(today.getFullYear() - day.yearsAgo)}
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${count}`}
          accessibilityHint="Opens them in the Memory Room, one at a time."
        >
          {words}
          <Text style={styles.dayRoom}>Memory Room</Text>
          <Feather name="chevron-right" size={16} color={colors.inkFaint} />
        </Pressable>
      ) : (
        <View style={styles.dayRow} accessible accessibilityRole="header" accessibilityLabel={`${title}, ${count}`}>
          {words}
        </View>
      );
    }
    return (
      <View style={styles.sheetRow}>
        {item.photos.map((p, i) => (
          <Pressable
            key={p.id}
            style={({ pressed }) => [styles.sheetCell, pressed && styles.pressed]}
            onPress={() => void openPhoto(p)}
            disabled={opening != null}
            accessibilityRole="imagebutton"
            accessibilityLabel={photoLabel(p, item.first + i, day.photos.length, day.yearsAgo)}
            accessibilityHint="Opens it in the editor."
            accessibilityState={{ busy: opening === p.id, disabled: opening != null }}
          >
            <Image
              source={p.uri}
              style={styles.sheetImage}
              contentFit="cover"
              cachePolicy="memory"
              recyclingKey={p.id}
              accessibilityIgnoresInvertColors
            />
            {opening === p.id ? (
              <View style={styles.opening}>
                <ActivityIndicator color={colors.onCamera} />
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
    );
  };

  const head = (
    <>
      <Text style={styles.date}>{signatureDate(today.toISOString()).toUpperCase()}</Text>

      {!posts.isFetched ? (
        <View style={styles.section}>
          <Bone style={styles.memoryBone} />
        </View>
      ) : null}

      {memories.map((m) => {
        // A film's file is a movie, which an <Image> cannot draw; its poster frame can be.
        const thumb =
          m.post.media_type === "video"
            ? mediaUrl("thumbnails", m.post.thumb_path)
            : mediaUrl("thumbnails", m.post.thumb_path) ?? mediaUrl("media", m.post.media_path);
        return (
          <Pressable key={m.post.id} style={styles.memory} onPress={() => openPost(m.post)}>
            {thumb ? <Image source={thumb} style={styles.memoryImage} contentFit="cover" cachePolicy="memory-disk" /> : null}
            <View style={styles.memoryText}>
              <Text style={styles.eyebrow}>
                {m.yearsAgo === 1 ? "One year ago" : `${m.yearsAgo} years ago`}
              </Text>
              <Text style={styles.headline}>{memoryHeadline(m)}</Text>
              {m.post.caption ? (
                <Text style={styles.captionLine} numberOfLines={2}>
                  {m.post.caption}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      {/* The phone's own copies of this day — only ever read, never sent. */}
      {showLibrary ? (
        <View style={styles.section}>
          <SectionLabel>In your library</SectionLabel>
          {reach === "limited" ? (
            <View style={styles.limited}>
              <Text style={styles.limitedLine}>VINTAGE can see only the photographs you’ve chosen.</Text>
              <View style={styles.limitedWays}>
                {Platform.OS === "ios" ? (
                  <Pressable
                    onPress={() => void chooseMore()}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={({ pressed }) => [styles.limitedWay, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Choose more photographs"
                    accessibilityHint="Opens your library, to share more photographs with VINTAGE."
                  >
                    <Text style={styles.limitedWord}>Choose more</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={openLibrarySettings}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={({ pressed }) => [styles.limitedWay, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Open Settings"
                  accessibilityHint="You can let VINTAGE see your whole library there."
                >
                  <Text style={styles.limitedWord}>Open Settings</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {reach === "none" ? (
            <Pressable
              style={({ pressed }) => [styles.ask, pressed && styles.pressed]}
              onPress={() => openDay()}
              accessibilityRole="button"
              accessibilityHint="Opens On this day in the Memory Room."
            >
              <Feather name="image" size={16} color={colors.ink} />
              <View style={styles.askText}>
                <Text style={styles.askTitle}>Look in your photo library</Text>
                <Text style={styles.askBody}>
                  The Memory Room can find photographs from this day in earlier years. It looks through
                  your library on your phone, and nothing leaves it unless you post it.
                </Text>
              </View>
            </Pressable>
          ) : libraryTotal === 0 ? (
            <Text style={styles.quiet}>
              {library.isFetched ? "Nothing from this day in earlier years." : "Looking…"}
            </Text>
          ) : null}
        </View>
      ) : null}
    </>
  );

  const foot = (
    <>
      {eras.length > 0 ? (
        <View style={styles.section}>
          <SectionLabel>Eras</SectionLabel>
          {eras.map((era) => (
            <View key={era.key} style={styles.era}>
              <View style={styles.eraHead}>
                <Text style={styles.eraTitle}>{era.title}</Text>
                <Text style={styles.eraCount}>{era.posts.length}</Text>
              </View>
              <View style={styles.eraGrid}>
                {era.posts.slice(0, 6).map((p) => {
                  const url = mediaUrl("thumbnails", p.thumb_path) ?? mediaUrl("media", p.media_path);
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() =>
                        router.push({ pathname: "/gallery", params: { authorId: p.author_id, postId: p.id, sort: "taken" } })
                      }
                    >
                      {url ? <Image source={url} style={styles.eraCell} contentFit="cover" cachePolicy="memory-disk" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {nothing ? (
        <EmptyState
          title="Nothing from this day yet"
          body="As your grid grows, the photographs you took on this date in other years will gather here."
        />
      ) : null}
    </>
  );

  return (
    <Screen padded={false}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        extraData={opening}
        ListHeaderComponent={head}
        ListFooterComponent={foot}
        contentContainerStyle={styles.scroll}
        initialNumToRender={12}
        windowSize={7}
      />
    </Screen>
  );
}

/** Photographs to a row of the contact sheet. */
const PER_ROW = 4;
const SHEET_GAP = 2;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionLabelText}>{children}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

const ERA_CELL = (Dimensions.get("window").width - spacing.lg * 2 - 2 * 2) / 3;
const SHEET_CELL = (Dimensions.get("window").width - spacing.lg * 2 - SHEET_GAP * (PER_ROW - 1)) / PER_ROW;

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl * 2 },
  date: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    color: colors.inkFaint,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  section: { marginTop: spacing.xl },
  sectionLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
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

  memoryBone: { marginHorizontal: spacing.lg, aspectRatio: 4 / 5, borderRadius: 0 },
  memory: { marginTop: spacing.lg },
  memoryImage: { width: "100%", aspectRatio: 4 / 5, backgroundColor: colors.paperSunken },
  memoryText: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  eyebrow: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    color: colors.accent,
  },
  headline: { fontFamily: type.serif, fontSize: 18, lineHeight: 25, color: colors.ink, marginTop: spacing.xs },
  captionLine: { ...type.caption, marginTop: spacing.xs },

  ask: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paperRaised,
  },
  askText: { flex: 1 },
  pressed: { opacity: 0.6 },
  askTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  askBody: { ...type.caption, fontSize: 12, lineHeight: 17, marginTop: 2 },
  quiet: { ...type.caption, paddingHorizontal: spacing.lg, color: colors.inkFaint },

  limited: { paddingHorizontal: spacing.lg, marginBottom: spacing.xs },
  limitedLine: { ...type.caption, fontSize: 12, lineHeight: 17, color: colors.inkFaint },
  limitedWays: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg },
  limitedWay: { minHeight: 44, justifyContent: "center" },
  limitedWord: { fontFamily: type.mono, fontSize: 10.5, letterSpacing: 2.2, textTransform: "uppercase", color: colors.inkSoft },

  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md + 2,
    paddingBottom: spacing.sm,
  },
  dayText: { flex: 1 },
  dayTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  dayCount: { ...type.caption, fontSize: 12, color: colors.inkFaint },
  dayRoom: { fontFamily: type.mono, fontSize: 9, letterSpacing: 1.8, textTransform: "uppercase", color: colors.inkFaint },

  sheetRow: { flexDirection: "row", gap: SHEET_GAP, paddingHorizontal: spacing.lg, marginBottom: SHEET_GAP },
  sheetCell: { width: SHEET_CELL, height: SHEET_CELL },
  sheetImage: { width: SHEET_CELL, height: SHEET_CELL, backgroundColor: colors.paperSunken },
  opening: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 25, 21, 0.45)",
  },

  era: { marginBottom: spacing.xl },
  eraHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  eraTitle: { fontFamily: type.serif, fontSize: 17, color: colors.ink },
  eraCount: { fontFamily: type.mono, fontSize: 10, letterSpacing: 1.2, color: colors.inkFaint },
  eraGrid: { flexDirection: "row", flexWrap: "wrap", gap: 2, paddingHorizontal: spacing.lg },
  eraCell: { width: ERA_CELL, height: ERA_CELL, backgroundColor: colors.paperSunken },
});
