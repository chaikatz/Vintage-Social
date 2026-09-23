import React, { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { ProfileHeader } from "@/components/ProfileHeader";
import { PhotoGrid, type GridPost } from "@/components/PhotoGrid";
import { Timeline } from "@/components/Timeline";
import { PostMap } from "@/components/PostMap";
import { PlaceGroups } from "@/components/PlaceGroups";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { GridSkeleton, ProfileSkeleton } from "@/components/Skeleton";
import { GridSortToggle, type ProfileView } from "@/components/GridSortToggle";
import { colors, spacing } from "@/theme";
import { fetchUserPosts } from "@/api/posts";
import { fetchTaggedPosts } from "@/api/tags";
import { sortByTaken } from "@/utils/memories";
import { useSession } from "@/providers/SessionProvider";

/**
 * Your own page: the grid, the same photographs by the day they were
 * taken, hung on a timeline, pinned on the world, or filed by the places
 * they were taken — and among them the
 * photographs other members tagged you in and you chose to show.
 */
export default function OwnProfile() {
  const router = useRouter();
  const { session, profile, isAdmin } = useSession();
  const userId = session?.user?.id ?? "";
  const [view, setView] = useState<ProfileView>("posted");
  // The two grids share a sort; the timeline and map read by date and place.
  const sort = view === "taken" ? "taken" : "posted";

  const posts = useQuery({
    queryKey: ["user-posts", userId],
    queryFn: () => fetchUserPosts(userId),
    enabled: Boolean(userId),
  });
  const tagged = useQuery({
    queryKey: ["tagged-posts", userId],
    queryFn: () => fetchTaggedPosts(userId),
    enabled: Boolean(userId),
  });
  const rows: GridPost[] = useMemo(() => {
    const mine = posts.data ?? [];
    const theirs = (tagged.data ?? []).map((p) => ({ ...p, tagged_in: true }));
    const all = [...mine, ...theirs].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return sort === "taken" ? sortByTaken(all) : all;
  }, [posts.data, tagged.data, sort]);

  if (!profile) {
    return (
      <Screen padded={false}>
        <ProfileSkeleton />
        <GridSkeleton />
      </Screen>
    );
  }

  const header = (
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
      {rows.length > 0 ? <GridSortToggle value={view} onChange={setView} /> : null}
    </View>
  );

  // A tagged photograph belongs to its author's gallery; yours open in yours.
  const openPost = (p: GridPost) =>
    view === "timeline" || view === "map" || view === "places" || p.tagged_in
      ? router.push(`/post/${p.id}`)
      : router.push({ pathname: "/gallery", params: { authorId: p.author_id, postId: p.id, sort } });

  return (
    <Screen padded={false}>
      {view === "map" ? (
        <PostMap posts={rows} onOpenPost={openPost} header={header} />
      ) : view === "places" ? (
        <PlaceGroups posts={rows} onOpenPost={openPost} header={header} refreshing={posts.isRefetching} onRefresh={() => posts.refetch()} />
      ) : view === "timeline" ? (
        <Timeline posts={rows} onOpenPost={openPost} header={header} refreshing={posts.isRefetching} onRefresh={() => posts.refetch()} />
      ) : (
        <PhotoGrid
          posts={rows}
          onOpenPost={openPost}
          refreshing={posts.isRefetching}
          onRefresh={() => {
            posts.refetch();
            tagged.refetch();
          }}
          empty={
            posts.isFetched ? (
              <EmptyState title="No photographs yet" body="Your grid starts with your first post." />
            ) : (
              <GridSkeleton />
            )
          }
          header={header}
        />
      )}
    </Screen>
  );
}
