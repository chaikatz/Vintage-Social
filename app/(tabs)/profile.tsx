import React from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { Pressable } from "react-native";
import { Screen } from "@/components/Screen";
import { ProfileHeader } from "@/components/ProfileHeader";
import { PhotoGrid } from "@/components/PhotoGrid";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { colors, spacing } from "@/theme";
import { fetchUserPosts } from "@/api/posts";
import { useSession } from "@/providers/SessionProvider";

export default function OwnProfile() {
  const router = useRouter();
  const { session, profile, isAdmin } = useSession();
  const userId = session?.user?.id ?? "";

  const posts = useQuery({
    queryKey: ["user-posts", userId],
    queryFn: () => fetchUserPosts(userId),
    enabled: Boolean(userId),
  });

  if (!profile) return <Screen />;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: profile.username }} />
      <PhotoGrid
        posts={posts.data ?? []}
        onOpenPost={(p) => router.push(`/post/${p.id}`)}
        refreshing={posts.isRefetching}
        onRefresh={() => posts.refetch()}
        header={
          <View>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
              {isAdmin ? (
                <Pressable hitSlop={8} onPress={() => router.push("/admin")} style={{ marginRight: spacing.lg }}>
                  <Feather name="shield" size={20} color={colors.inkSoft} />
                </Pressable>
              ) : null}
              <Pressable hitSlop={8} onPress={() => router.push("/settings")}>
                <Feather name="settings" size={20} color={colors.inkSoft} />
              </Pressable>
            </View>
            <ProfileHeader
              profile={profile}
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
            {(posts.data ?? []).length === 0 && posts.isFetched ? (
              <EmptyState title="No photographs yet" body="Your grid starts with your first post." />
            ) : null}
          </View>
        }
      />
    </Screen>
  );
}
