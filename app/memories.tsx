import React, { useMemo } from "react";
import { Dimensions, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { EmptyState } from "@/components/EmptyState";
import { Bone } from "@/components/Skeleton";
import { colors, spacing, type } from "@/theme";
import { fetchUserPosts } from "@/api/posts";
import { mediaUrl } from "@/api/media";
import { groupEras, memoryHeadline, onThisDay } from "@/utils/memories";
import { signatureDate } from "@/utils/time";
import { libraryGranted, photosOnThisDay } from "@/utils/library";
import { useSession } from "@/providers/SessionProvider";
import type { PostRow } from "@/types/db";

/**
 * On this day.
 *
 * The member's own past, read by the day the shutter fired: what they
 * posted from this date in other years, what the phone still has from it,
 * and further down the eras their grid falls into — a place and a year,
 * or a season when no place was written. All of it is computed on the
 * phone from dates already on the photographs; VINTAGE keeps no diary.
 *
 * The headline is the sentence a notification will carry once there are
 * notifications, so the two read the same.
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
  const eras = useMemo(() => groupEras(posts.data ?? []), [posts.data]);

  const dayKey = new Date().toDateString();
  const granted = useQuery({
    queryKey: ["library-granted"],
    queryFn: () => libraryGranted(false),
    enabled: Platform.OS !== "web",
  });
  const library = useQuery({
    queryKey: ["library-on-this-day", dayKey],
    queryFn: async () => ((await libraryGranted(false)) ? photosOnThisDay() : []),
    enabled: Platform.OS !== "web" && granted.data === true,
    staleTime: 60 * 60_000,
  });

  const askLibrary = async () => {
    if (await libraryGranted(true)) {
      queryClient.invalidateQueries({ queryKey: ["library-granted"] });
      queryClient.invalidateQueries({ queryKey: ["library-on-this-day"] });
    }
  };

  const openPost = (post: PostRow) => {
    queryClient.setQueryData(["post", post.id], undefined);
    router.push(`/post/${post.id}`);
  };

  const today = new Date();
  const libraryTotal = (library.data ?? []).reduce((n, d) => n + d.photos.length, 0);
  const nothing =
    posts.isFetched && memories.length === 0 && eras.length === 0 && (granted.data === false || libraryTotal === 0);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.date}>{signatureDate(today.toISOString()).toUpperCase()}</Text>

        {!posts.isFetched ? (
          <View style={styles.section}>
            <Bone style={styles.memoryBone} />
          </View>
        ) : null}

        {memories.map((m) => {
          const thumb = mediaUrl("media", m.post.media_path);
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
        {Platform.OS !== "web" ? (
          <View style={styles.section}>
            <SectionLabel>In your library</SectionLabel>
            {granted.data === false ? (
              <Pressable style={styles.ask} onPress={askLibrary}>
                <Feather name="image" size={16} color={colors.ink} />
                <View style={styles.askText}>
                  <Text style={styles.askTitle}>Look in your photo library</Text>
                  <Text style={styles.askBody}>
                    VINTAGE can find photographs from this day in earlier years. It reads them on your
                    phone and keeps nothing.
                  </Text>
                </View>
              </Pressable>
            ) : libraryTotal === 0 ? (
              <Text style={styles.quiet}>
                {library.isFetched ? "Nothing from this day in earlier years." : "Looking…"}
              </Text>
            ) : (
              (library.data ?? []).map((day) => (
                <Pressable
                  key={day.yearsAgo}
                  style={styles.dayRow}
                  onPress={() => router.push({ pathname: "/library-picker", params: { mode: "day" } })}
                >
                  <View style={styles.dayThumbs}>
                    {day.photos.slice(0, 3).map((p) => (
                      <Image key={p.id} source={p.uri} style={styles.dayThumb} contentFit="cover" />
                    ))}
                  </View>
                  <View style={styles.dayText}>
                    <Text style={styles.dayTitle}>
                      {day.yearsAgo === 1 ? "1 year ago" : `${day.yearsAgo} years ago`}
                    </Text>
                    <Text style={styles.dayCount}>
                      {day.photos.length} {day.photos.length === 1 ? "photograph" : "photographs"}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.inkFaint} />
                </Pressable>
              ))
            )}
          </View>
        ) : null}

        {eras.length > 0 ? (
          <View style={styles.section}>
            <SectionLabel>Eras</SectionLabel>
            {eras.map((era) => (
              <View key={era.title} style={styles.era}>
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
      </ScrollView>
    </Screen>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionLabelText}>{children}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

const ERA_CELL = (Dimensions.get("window").width - spacing.lg * 2 - 2 * 2) / 3;

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
  askTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  askBody: { ...type.caption, fontSize: 12, lineHeight: 17, marginTop: 2 },
  quiet: { ...type.caption, paddingHorizontal: spacing.lg, color: colors.inkFaint },

  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  dayThumbs: { flexDirection: "row", gap: 2 },
  dayThumb: { width: 40, height: 40, backgroundColor: colors.paperSunken },
  dayText: { flex: 1 },
  dayTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  dayCount: { ...type.caption, fontSize: 12, color: colors.inkFaint },

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
