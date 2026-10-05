import React from "react";
import { FlatList, StyleSheet } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { UserRow } from "@/components/UserRow";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { Bone } from "@/components/Skeleton";
import { spacing } from "@/theme";
import { fetchLikers } from "@/api/posts";
import { useSession } from "@/providers/SessionProvider";

/**
 * Who liked one of your photographs, newest first.
 *
 * Only your own: the count under anyone else's photograph is a number,
 * not a list. The database would answer for any post a member may see,
 * so the door is shut here — the screen refuses a post that is not yours.
 */
export default function Likes() {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";
  const { postId, authorId } = useLocalSearchParams<{ postId: string; authorId: string }>();
  const own = Boolean(postId) && authorId === userId;

  const likers = useQuery({
    queryKey: ["likers", postId],
    queryFn: () => fetchLikers(postId ?? ""),
    enabled: own,
  });

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: "Likes" }} />
      {!own ? (
        <EmptyState title="Only your own" body="Who liked a photograph is shown on your own posts." />
      ) : likers.isError ? (
        <LoadFailed what="the likes" onRetry={() => likers.refetch()} />
      ) : (
        <FlatList
          data={likers.data ?? []}
          keyExtractor={(l) => l.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            likers.isFetched ? (
              <EmptyState title="No likes yet" />
            ) : (
              <>
                <Bone style={styles.bone} />
                <Bone style={styles.bone} />
              </>
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
  bone: { height: 44, marginHorizontal: spacing.lg, marginVertical: spacing.sm, borderRadius: 22 },
});
