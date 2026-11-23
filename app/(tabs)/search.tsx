import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounced } from "@/hooks/useDebounced";
import { rankSearch } from "@/utils/searchRank";
import {
  SEARCH_MIN_LENGTH,
  lastEmptyAnswer,
  nobodyFound,
  searchDelay,
  searchKey,
  searchNeedle,
  shownResults,
} from "@/utils/memberSearch";
import { fetchFollowsAmong } from "@/api/profiles";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { UserRow } from "@/components/UserRow";
import { PhotoGrid } from "@/components/PhotoGrid";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { colors, radii, spacing, type } from "@/theme";
import { searchProfiles } from "@/api/profiles";
import type { ProfileRow } from "@/types/db";
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
/** An answer is asked again after this, not on every return to the same letters while typing. */
const SEARCH_STALE_MS = 30_000;

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
  // From the first letter (src/utils/memberSearch.ts).
  const typed = searchNeedle(q);
  const searching = typed.length >= SEARCH_MIN_LENGTH;

  // The first letter is asked about at once; after it, a beat after typing
  // stops. Each answer is filed under the letters it answers (searchKey),
  // and the last one stays up, narrowed to what is typed, while the next
  // comes (shownResults), so the list neither blanks nor shows a late
  // answer to letters typed before.
  const settled = useDebounced(typed, searchDelay(typed));
  const queryClient = useQueryClient();
  const results = useQuery({
    queryKey: searchKey(settled),
    queryFn: async () => {
      const found = await searchProfiles(settled);
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
    enabled: settled.length >= SEARCH_MIN_LENGTH,
    placeholderData: keepPreviousData,
    staleTime: SEARCH_STALE_MS,
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
  const shown = useMemo(
    () => shownResults({ typed, answered: settled, rows: results.data, held: results.isPlaceholderData }),
    [typed, settled, results.data, results.isPlaceholderData],
  );
  const ranked = useMemo(
    () =>
      rankSearch(
        shown,
        {
          recentIds: new Set(recent.map((r) => r.id)),
          followingIds: new Set(circleQ.data?.following ?? []),
          followerIds: new Set(circleQ.data?.followers ?? []),
        },
        typed,
      ),
    [shown, recent, circleQ.data, typed],
  );
  // The answer to what is typed failed: no rows held from an earlier one
  // stand in for it. A refetch that failed keeps the answer it had, which
  // is still the answer to these letters, and stays up.
  const failed = results.isError && settled === typed && results.data === undefined;
  // The last answer that found nobody, kept while the next letters' comes
  // (set during render, as React has a state that follows another: it
  // settles in the same pass and draws nothing in between).
  const [emptyFor, setEmptyFor] = useState<string | null>(null);
  const nextEmptyFor = lastEmptyAnswer(emptyFor, {
    needle: settled,
    rows: results.data,
    current: results.isSuccess && !results.isPlaceholderData,
  });
  if (nextEmptyFor !== emptyFor) setEmptyFor(nextEmptyFor);
  const nobody = nobodyFound({
    typed,
    answered: settled,
    rows: results.data,
    held: results.isPlaceholderData,
    fetched: results.isFetched,
    emptyFor: nextEmptyFor,
  });

  // Kept the same from one render to the next, so a row drawn already is not drawn again as each letter is typed.
  const openMember = useCallback(
    ({ id, username, full_name, avatar_url }: RecentSearch) => {
      setRecent(rememberRecent({ id, username, full_name, avatar_url }));
      router.push(`/user/${username}`);
    },
    [router],
  );
  const renderResult = useCallback(
    ({ item }: { item: ProfileRow }) => <SearchResult member={item} onOpen={openMember} />,
    [openMember],
  );

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
          // Only members who match what is typed: the answer to it, or,
          // until that comes, the last answer narrowed to it.
          data={failed ? NO_ROWS : ranked}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            // A search that failed is no answer: "Nobody by that name" would not be true.
            failed ? (
              <LoadFailed what="the search" onRetry={() => results.refetch()} />
            ) : nobody ? (
              <EmptyState title="Nobody by that name" body="Try a different spelling." />
            ) : null
          }
          renderItem={renderResult}
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

const NO_ROWS: ProfileRow[] = [];

/** One member in the results, drawn again only when they or what opens them change. */
const SearchResult = memo(function SearchResult({
  member,
  onOpen,
}: {
  member: ProfileRow;
  onOpen: (member: RecentSearch) => void;
}) {
  return (
    <UserRow
      username={member.username}
      avatarPath={member.avatar_url}
      title={member.full_name}
      subtitle={member.city}
      onPress={() => onOpen(member)}
    />
  );
});

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
