import React, { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { ProfileHeader } from "@/components/ProfileHeader";
import { PhotoGrid } from "@/components/PhotoGrid";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { GridSkeleton, ProfileSkeleton } from "@/components/Skeleton";
import { GridSortToggle, type GridSort } from "@/components/GridSortToggle";
import { colors, spacing } from "@/theme";
import { fetchUserPosts } from "@/api/posts";
import { sortByTaken } from "@/utils/memories";
import { useSession } from "@/providers/SessionProvider";

export default function OwnProfile() {
  const router = useRouter();
  const { session, profile, isAdmin } = useSession();
  const userId = session?.user?.id ?? "";
  const [sort, setSort] = useState<GridSort>("posted");

  const posts = useQuery({
    queryKey: ["user-posts", userId],
    queryFn: () => fetchUserPosts(userId),
    enabled: Boolean(userId),
  });
  const rows = useMemo(
    () => (sort === "taken" ? sortByTaken(posts.data ?? []) : posts.data ?? []),
    [posts.data, sort],
  );

  if (!profile) {
    return (
      <Screen padded={false}>
        <ProfileSkeleton />
        <GridSkeleton />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <PhotoGrid
        posts={rows}
        onOpenPost={(p) =>
          router.push({ pathname: "/gallery", params: { authorId: p.author_id, postId: p.id, sort } })
        }
        refreshing={posts.isRefetching}
        onRefresh={() => posts.refetch()}
        empty={
          posts.isFetched ? (
            <EmptyState title="No photographs yet" body="Your grid starts with your first post." />
          ) : (
            <GridSkeleton />
          )
        }
        header={
          <View>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
              {isAdmin ? (
                <Pressable
                  hitSlop={8}
                  onPress={() => router.push("/admin")}
                  accessibilityLabel="Admin"
                  style={{ marginRight: spacing.lg }}
                >
                  <Feather name="shield" size={20} color={colors.inkSoft} />
                </Pressable>
              ) : null}
              <Pressable hitSlop={8} onPress={() => router.push("/settings")} accessibilityLabel="Settings">
                <Feather name="settings" size={20} color={colors.inkSoft} />
              </Pressable>
            </View>
            <ProfileHeader
              profile={profile}
              onPressStat={(kind) =>
                router.push({ pathname: "/follows", params: { userId, kind, username: profile.username } })
              }
              action={
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Button
                    title="Edit profile"
                    variant="secondary"
                    small
                    onPress={() => router.push("/settings")}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Invitations"
                    variant="secondary"
                    small
                    onPress={() => router.push("/invites")}
                    style={{ flex: 1 }}
                  />
                </View>
              }
            />
            {(posts.data ?? []).length > 1 ? <GridSortToggle value={sort} onChange={setSort} /> : null}
          </View>
        }
      />
    </Screen>
  );
}
