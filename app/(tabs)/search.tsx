import React, { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { UserRow } from "@/components/UserRow";
import { PhotoGrid } from "@/components/PhotoGrid";
import { EmptyState } from "@/components/EmptyState";
import { colors, radii, spacing, type } from "@/theme";
import { searchProfiles } from "@/api/profiles";
import { fetchExplore } from "@/api/posts";
import { useSession } from "@/providers/SessionProvider";

/**
 * Find people, or look at what the rest of VINTAGE has been shooting.
 *
 * Explore is deliberately dumb: every photograph the viewer is allowed to
 * see, newest first. No ranking, no "for you", no engagement signal of any
 * kind — the only reason a picture is near the top is that it was taken
 * recently. Private members appear only to the people they've let in.
 */
export default function Search() {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";
  const [q, setQ] = useState("");
  const searching = q.trim().length >= 2;

  const results = useQuery({
    queryKey: ["search", q],
    queryFn: () => searchProfiles(q),
    enabled: searching,
  });

  const explore = useQuery({
    queryKey: ["explore", userId],
    queryFn: () => fetchExplore(userId),
    enabled: Boolean(userId) && !searching,
  });

  const field = useMemo(
    () => (
      <View style={styles.searchWrap}>
        <Feather name="search" size={15} color={colors.inkFaint} style={styles.searchIcon} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search members"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        {q ? (
          <Pressable hitSlop={10} onPress={() => setQ("")}>
            <Feather name="x" size={15} color={colors.inkFaint} />
          </Pressable>
        ) : null}
      </View>
    ),
    [q],
  );

  if (searching) {
    return (
      <Screen padded={false}>
        {field}
        <FlatList
          data={results.data ?? []}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            results.isFetched ? (
              <EmptyState title="Nobody by that name" body="Try a different spelling." />
            ) : null
          }
          renderItem={({ item }) => (
            <UserRow
              username={item.username}
              avatarPath={item.avatar_url}
              title={item.full_name}
              subtitle={item.city}
              onPress={() => router.push(`/user/${item.username}`)}
            />
          )}
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      {field}
      <PhotoGrid
        posts={explore.data ?? []}
        onOpenPost={(p) =>
          router.push({ pathname: "/gallery", params: { authorId: p.author_id, postId: p.id } })
        }
        refreshing={explore.isRefetching}
        onRefresh={() => explore.refetch()}
        header={<Text style={styles.sectionLabel}>Recently on VINTAGE</Text>}
        empty={
          explore.isFetched ? (
            <EmptyState
              title="Nothing to explore yet"
              body="As members post, their photographs collect here."
            />
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    backgroundColor: colors.paperRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
  },
  searchIcon: { marginTop: 1 },
  input: { flex: 1, paddingVertical: 9, fontSize: 15, color: colors.ink },
  sectionLabel: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.inkFaint,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
});
