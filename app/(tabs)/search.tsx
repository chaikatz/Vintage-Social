import React, { useState } from "react";
import { FlatList, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { UserRow } from "@/components/UserRow";
import { EmptyState } from "@/components/EmptyState";
import { colors, radii, spacing } from "@/theme";
import { searchProfiles } from "@/api/profiles";

/**
 * Search is deliberately plain: find people by name or username.
 * No trending, no suggestions, no explore grid.
 */
export default function Search() {
  const router = useRouter();
  const [q, setQ] = useState("");

  const results = useQuery({
    queryKey: ["search", q],
    queryFn: () => searchProfiles(q),
    enabled: q.trim().length >= 2,
  });

  return (
    <Screen padded={false}>
      <View style={styles.searchWrap}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search members"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
      </View>
      <FlatList
        data={results.data ?? []}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          q.trim().length >= 2 && results.isFetched ? (
            <EmptyState title="Nobody by that name" body="Try a different spelling." />
          ) : (
            <EmptyState title="Find people" body="Search by name or username." />
          )
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

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  input: {
    backgroundColor: colors.paperRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.ink,
  },
});
