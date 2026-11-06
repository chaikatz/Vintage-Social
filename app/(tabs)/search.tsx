import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounced } from "@/hooks/useDebounced";
import { rankSearch } from "@/utils/searchRank";
import { fetchFollowsAmong } from "@/api/profiles";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { UserRow } from "@/components/UserRow";
import { PhotoGrid } from "@/components/PhotoGrid";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { colors, radii, spacing, type } from "@/theme";
import { searchProfiles } from "@/api/profiles";
import { fetchExplore } from "@/api/posts";
import { dealExplore, newSeed } from "@/utils/shuffle";
import {
  clearRecent,
  forgetRecent,
  loadRecent,
  rememberRecent,
  type RecentSearch,
} from "@/utils/searchHistory";
import { useSession } from "@/providers/SessionProvider";
import { KEYBOARD_DONE } from "@/components/KeyboardDone";

// A row that breaks this screen breaks only this screen (src/navigation/Recover.tsx).
export { RecoverPage as ErrorBoundary } from "@/navigation/Recover";

/** Where the member stands with a search's results, kept under "follows" so a follow reads it again. */
const followsAmongKey = (userId: string, ids: string[]) => ["follows", userId, "among", ids.join(",")] as const;
const FOLLOWS_AMONG_STALE_MS = 60_000;
/**
 * How long the results wait for that read before they are shown anyway,
 * unranked, to take their order when it lands. Enough for it on a good
 * connection; on a slow one, a ranking read that hangs must not hold the
 * results back until the request's own deadline.
 */
const FOLLOWS_AMONG_WAIT_MS = 1200;

/**
 * Find people, or look at what the rest of VINTAGE has been shooting.
 *
 * Explore is deliberately dumb: the newest photographs the viewer is
 * allowed to see, dealt out in a fresh order each time the tab is opened
 * or pulled. No ranking, no "for you", no engagement signal of any kind —
 * the only reason a picture is here is that it was taken recently.
 * Private members appear only to the people they've let in.
 *
 * The search field remembers who you looked for, on this phone only, and
 * offers them back when the field is empty and focused.
 */
export default function Search() {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const searching = q.trim().length >= 2;

  // Asked a beat after typing stops, and the last answer stays up while
  // the next one comes, so the list does not blank on every keystroke.
  const settledQ = useDebounced(q, 250);
  const queryClient = useQueryClient();
  const results = useQuery({
    queryKey: ["search", settledQ],
    queryFn: async () => {
      const found = await searchProfiles(settledQ);
      // Where the member stands with these results comes with them, so
      // they are drawn in their order at once (below). A failure there
      // only leaves them unranked: prefetchQuery does not throw. Waited
      // for a moment at most (FOLLOWS_AMONG_WAIT_MS): a read still going
      // goes on, and circleQ, under the same key, takes its answer.
      const ids = found.map((p) => p.id);
      if (userId && ids.length > 0) {
        const ranking = queryClient.prefetchQuery({
          queryKey: followsAmongKey(userId, ids),
          queryFn: () => fetchFollowsAmong(userId, ids),
          staleTime: FOLLOWS_AMONG_STALE_MS,
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([ranking, new Promise<void>((done) => (timer = setTimeout(done, FOLLOWS_AMONG_WAIT_MS)))]);
        clearTimeout(timer);
      }
      return found;
    },
    enabled: settledQ.trim().length >= 2,
    placeholderData: keepPreviousData,
  });

  // One seed per visit; pull-to-refresh draws another. The set itself is
  // still the newest sixty, so the deal never reaches back into the past.
  const [seed, setSeed] = useState(newSeed);
  const explore = useQuery({
    queryKey: ["explore", userId],
    queryFn: () => fetchExplore(userId),
    enabled: Boolean(userId) && !searching,
  });
  const dealt = useMemo(() => dealExplore(explore.data ?? [], seed), [explore.data, seed]);
  const reshuffle = useCallback(() => {
    setSeed(newSeed());
    explore.refetch();
  }, [explore]);

  const [recent, setRecent] = useState<RecentSearch[]>([]);
  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  // The people closest to you come first in any search: who you were just
  // looking at, who you follow, who follows you. Asked of the results
  // alone (fetchFollowsAmong), not read as your whole lists, which stop
  // at a thousand. Kept under "follows", so following someone reads it
  // again.
  const resultIds = useMemo(() => (results.data ?? []).map((p) => p.id), [results.data]);
  const circleQ = useQuery({
    queryKey: followsAmongKey(userId, resultIds),
    queryFn: () => fetchFollowsAmong(userId, resultIds),
    enabled: Boolean(userId) && resultIds.length > 0,
    staleTime: FOLLOWS_AMONG_STALE_MS,
  });
  const ranked = useMemo(
    () =>
      rankSearch(results.data ?? [], {
        recentIds: new Set(recent.map((r) => r.id)),
        followingIds: new Set(circleQ.data?.following ?? []),
        followerIds: new Set(circleQ.data?.followers ?? []),
      }),
    [results.data, recent, circleQ.data],
  );

  const openMember = (member: RecentSearch) => {
    setRecent(rememberRecent(member));
    router.push(`/user/${member.username}`);
  };

  const field = (
    <View style={styles.searchWrap}>
      <Feather name="search" size={15} color={colors.inkFaint} style={styles.searchIcon} />
      <TextInput
        inputAccessoryViewID={KEYBOARD_DONE}
        value={q}
        onChangeText={setQ}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search members"
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={styles.input}
      />
      {q ? (
        <Pressable hitSlop={10} onPress={() => setQ("")} accessibilityLabel="Clear search">
          <Feather name="x" size={15} color={colors.inkFaint} />
        </Pressable>
      ) : null}
    </View>
  );

  if (searching) {
    return (
      <Screen padded={false}>
        {field}
        <FlatList
          // Nothing from the last term is shown under a new one; the list
          // waits the beat until the query has caught up with what is typed.
          data={settledQ.trim() === q.trim() ? ranked : []}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            // A search that failed is no answer: "Nobody by that name" would not be true.
            results.isError && settledQ.trim() === q.trim() ? (
              <LoadFailed what="the search" onRetry={() => results.refetch()} />
            ) : results.isFetched && settledQ.trim() === q.trim() && !results.isPlaceholderData ? (
              <EmptyState title="Nobody by that name" body="Try a different spelling." />
            ) : null
          }
          renderItem={({ item }) => (
            <UserRow
              username={item.username}
              avatarPath={item.avatar_url}
              title={item.full_name}
              subtitle={item.city}
              onPress={() => openMember(item)}
            />
          )}
        />
      </Screen>
    );
  }

  // The field is where the attention is and there is history to offer.
  if (focused && q.trim().length === 0 && recent.length > 0) {
    return (
      <Screen padded={false}>
        {field}
        <FlatList
          data={recent}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            <View style={styles.recentHeader}>
              <Text style={styles.sectionLabel}>Recent</Text>
              <Pressable hitSlop={8} onPress={() => setRecent(clearRecent())}>
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <UserRow
              username={item.username}
              avatarPath={item.avatar_url}
              title={item.full_name}
              onPress={() => openMember(item)}
              right={
                <Pressable
                  hitSlop={10}
                  onPress={() => setRecent(forgetRecent(item.id))}
                  accessibilityLabel={`Forget ${item.username}`}
                >
                  <Feather name="x" size={15} color={colors.inkFaint} />
                </Pressable>
              }
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
        posts={dealt}
        onOpenPost={(p) =>
          router.push({ pathname: "/gallery", params: { authorId: p.author_id, postId: p.id } })
        }
        refreshing={explore.isRefetching}
        onRefresh={reshuffle}
        header={<Text style={styles.sectionLabel}>Recently on VINTAGE</Text>}
        empty={
          // A read that failed is no answer: "Nothing to explore yet" would not be true.
          explore.isError ? (
            <LoadFailed what="the latest photographs" onRetry={() => explore.refetch()} />
          ) : explore.isFetched ? (
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
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    paddingRight: spacing.lg,
  },
  clear: { ...type.caption, color: colors.accent, paddingBottom: spacing.sm },
});
