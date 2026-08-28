import React from "react";
import { Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { ProfileHeader } from "@/components/ProfileHeader";
import { PhotoGrid } from "@/components/PhotoGrid";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { fetchProfileByUsername, follow, isFollowing, unfollow } from "@/api/profiles";
import { fetchUserPosts } from "@/api/posts";
import { useSession } from "@/providers/SessionProvider";

export default function UserProfile() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const { username } = useLocalSearchParams<{ username: string }>();
  const myId = session?.user?.id ?? "";

  const profileQ = useQuery({
    queryKey: ["profile", username],
    queryFn: () => fetchProfileByUsername(username ?? ""),
    enabled: Boolean(username),
  });
  const profile = profileQ.data;

  const postsQ = useQuery({
    queryKey: ["user-posts", profile?.id],
    queryFn: () => fetchUserPosts(profile!.id),
    enabled: Boolean(profile?.id),
  });

  const followingQ = useQuery({
    queryKey: ["following", myId, profile?.id],
    queryFn: () => isFollowing(myId, profile!.id),
    enabled: Boolean(profile?.id) && profile?.id !== myId,
  });

  const toggleFollow = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) await follow(myId, profile!.id);
      else await unfollow(myId, profile!.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["following", myId, profile?.id] });
      queryClient.invalidateQueries({ queryKey: ["profile", username] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  if (!profile) {
    return (
      <Screen>
        <Stack.Screen options={{ title: username ?? "" }} />
        {profileQ.isFetched ? <EmptyState title="Member not found" /> : null}
      </Screen>
    );
  }

  const isMe = profile.id === myId;
  const followed = followingQ.data ?? false;

  const reportMember = () => {
    Alert.alert(profile.username, undefined, [
      {
        text: "Report member",
        style: "destructive",
        onPress: () =>
          router.push({ pathname: "/report", params: { targetType: "profile", profileId: profile.id } }),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: profile.username }} />
      <PhotoGrid
        posts={postsQ.data ?? []}
        onOpenPost={(p) => router.push(`/post/${p.id}`)}
        refreshing={postsQ.isRefetching}
        onRefresh={() => postsQ.refetch()}
        header={
          <>
            <ProfileHeader
              profile={profile}
              action={
                isMe ? undefined : (
                  <Button
                    title={followed ? "Following" : "Follow"}
                    variant={followed ? "secondary" : "primary"}
                    small
                    loading={toggleFollow.isPending}
                    onPress={() => toggleFollow.mutate(!followed)}
                    onLongPress={reportMember}
                  />
                )
              }
            />
            {(postsQ.data ?? []).length === 0 && postsQ.isFetched ? (
              <EmptyState title="No photographs yet" />
            ) : null}
          </>
        }
      />
    </Screen>
  );
}
