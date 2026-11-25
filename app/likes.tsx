import React, { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { UserRow } from "@/components/UserRow";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { readState } from "@/components/readState";
import { Bone } from "@/components/Skeleton";
import { colors, spacing, type } from "@/theme";
import { fetchLikersPage } from "@/api/posts";
import type { Cursor } from "@/api/keyset";
import { useSession } from "@/providers/SessionProvider";
import { LIKERS_NOTE, seesLikes } from "@/utils/ownLikes";

// A row that breaks this screen breaks only this screen, with the way back on its
// page as well as in its header: a screen opened from a link has no back button
// (src/navigation/Recover.tsx).
export { RecoverPageWithBack as ErrorBoundary } from "@/navigation/Recover";

/**
 * Who liked one of your photographs, newest first.
 *
 * Only your own: under anyone else's photograph there is no count to tap
 * (src/utils/ownLikes.ts), and the database answers a photograph's likes
 * to its author alone (0042). The screen refuses a post that is not
 * yours all the same, for a link made by hand.
 *
 * A page at a time, the newest like first, the next asked for as the
 * reader nears the end: a photograph liked by the whole club is never
 * cut short. A member on the other side of a block is not in the list.
 */
export default function Likes() {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";
  const { postId, authorId } = useLocalSearchParams<{ postId: string; authorId: string }>();
  const own = Boolean(postId) && seesLikes({ author_id: authorId ?? "" }, userId);

  const likers = useInfiniteQuery({
    queryKey: ["likers", postId],
    queryFn: ({ pageParam }) => fetchLikersPage(postId ?? "", pageParam),
    initialPageParam: null as Cursor | null,
    getNextPageParam: (last) => last.next,
    enabled: own,
  });
  // A member who liked it twice over two pages (unliked and liked again between them) is one row.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (likers.data?.pages ?? []).flatMap((p) => p.likers).filter((m) => !seen.has(m.id) && Boolean(seen.add(m.id)));
  }, [likers.data]);

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: "Likes" }} />
      {!own ? (
        <EmptyState title="Only your own" body="Who liked a photograph is shown on your own posts." />
      ) : readState(likers) === "failed" ? (
        // Only when there is no list to show: a re-read that fails leaves the likers on screen.
        <LoadFailed what="the likes" onRetry={() => likers.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(l) => l.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={rows.length > 0 ? <Text style={styles.note}>{LIKERS_NOTE}</Text> : null}
          onEndReached={() => {
            if (likers.hasNextPage && !likers.isFetchingNextPage && !likers.isFetchNextPageError) likers.fetchNextPage();
          }}
          onEndReachedThreshold={1}
          ListFooterComponent={
            likers.isFetchNextPageError ? <LoadFailed what="the rest" onRetry={() => likers.fetchNextPage()} /> : null
          }
          ListEmptyComponent={
            likers.isFetched ? (
              <EmptyState title="No likes yet" body={LIKERS_NOTE} />
            ) : (
              <View>
                <Bone style={styles.bone} />
                <Bone style={styles.bone} />
              </View>
            )
          }
          renderItem={({ item }) => (
            <UserRow
              username={item.username}
              avatarPath={item.avatar_url}
              title={item.full_name}
              onPress={() => router.push(`/user/${item.username}`)}
            />
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: spacing.sm },
  note: {
    ...type.caption,
    color: colors.inkFaint,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  bone: { height: 44, marginHorizontal: spacing.lg, marginVertical: spacing.sm, borderRadius: 22 },
});
