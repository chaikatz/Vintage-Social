import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { showAlert } from "@/utils/alert";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { ProfileHeader } from "@/components/ProfileHeader";
import { PhotoGrid, type GridPost } from "@/components/PhotoGrid";
import { PostMap } from "@/components/PostMap";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { GridSkeleton, ProfileSkeleton } from "@/components/Skeleton";
import { GridSortToggle, type ProfileView } from "@/components/GridSortToggle";
import { Timeline } from "@/components/Timeline";
import { colors, spacing, type } from "@/theme";
import { fetchProfileByUsername, follow, followState, unfollow } from "@/api/profiles";
import { fetchUserPosts } from "@/api/posts";
import { fetchTaggedPosts } from "@/api/tags";
import { openConversation } from "@/api/messages";
import { sortByTaken } from "@/utils/memories";
import { useSession } from "@/providers/SessionProvider";

export default function UserProfile() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const { username } = useLocalSearchParams<{ username: string }>();
  const myId = session?.user?.id ?? "";
  const [view, setView] = useState<ProfileView>("posted");
  const sort = view === "taken" ? "taken" : "posted";

  const profileQ = useQuery({
    queryKey: ["profile", username],
    queryFn: () => fetchProfileByUsername(username ?? ""),
    enabled: Boolean(username),
  });
  const profile = profileQ.data;

  const followQ = useQuery({
    queryKey: ["follow-state", myId, profile?.id],
    queryFn: () => followState(myId, profile!.id),
    enabled: Boolean(profile?.id) && profile?.id !== myId,
  });

  const status = followQ.data ?? null;
  const isMe = profile?.id === myId;
  // A private member's photographs are theirs until they let you in.
  const locked = Boolean(profile?.is_private) && !isMe && status !== "accepted";

  const postsQ = useQuery({
    queryKey: ["user-posts", profile?.id],
    queryFn: () => fetchUserPosts(profile!.id),
    enabled: Boolean(profile?.id) && !locked,
  });
  const taggedQ = useQuery({
    queryKey: ["tagged-posts", profile?.id],
    queryFn: () => fetchTaggedPosts(profile!.id),
    enabled: Boolean(profile?.id) && !locked,
  });
  const rows: GridPost[] = useMemo(() => {
    const theirs = postsQ.data ?? [];
    const taggedIn = (taggedQ.data ?? []).map((p) => ({ ...p, tagged_in: true }));
    const all = [...theirs, ...taggedIn].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return sort === "taken" ? sortByTaken(all) : all;
  }, [postsQ.data, taggedQ.data, sort]);

  const toggleFollow = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) await follow(myId, profile!.id);
      else await unfollow(myId, profile!.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-state", myId, profile?.id] });
      queryClient.invalidateQueries({ queryKey: ["profile", username] });
      queryClient.invalidateQueries({ queryKey: ["following", myId] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
      queryClient.invalidateQueries({ queryKey: ["explore"] });
    },
  });

  const message = async () => {
    if (!profile) return;
    const conversationId = await openConversation(myId, profile.id);
    router.push(`/messages/${conversationId}`);
  };

  if (!profile) {
    return (
      <Screen padded={false}>
        <Stack.Screen options={{ title: username ?? "" }} />
        {profileQ.isFetched ? (
          <EmptyState title="Member not found" />
        ) : (
          <>
            <ProfileSkeleton />
            <GridSkeleton />
          </>
        )}
      </Screen>
    );
  }

  const reportMember = () => {
    showAlert(profile.username, undefined, [
      {
        text: "Report member",
        style: "destructive",
        onPress: () =>
          router.push({ pathname: "/report", params: { targetType: "profile", profileId: profile.id } }),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const followLabel =
    status === "accepted" ? "Following" : status === "pending" ? "Requested" : "Follow";

  const header = (
    <>
      <ProfileHeader
        profile={profile}
        // A private member's lists are theirs too, until they let you in.
        onPressStat={
          locked
            ? undefined
            : (kind) =>
                router.push({
                  pathname: "/follows",
                  params: { userId: profile.id, kind, username: profile.username },
                })
        }
        action={
          isMe ? undefined : (
            <View style={styles.actions}>
              <View style={styles.followButton}>
                <Button
                  title={followLabel}
                  variant={status ? "secondary" : "primary"}
                  small
                  loading={toggleFollow.isPending}
                  onPress={() => toggleFollow.mutate(status === null)}
                  onLongPress={reportMember}
                />
              </View>
              <Pressable style={styles.messageButton} onPress={message} accessibilityLabel="Message">
                <Feather name="send" size={16} color={colors.ink} />
              </Pressable>
            </View>
          )
        }
      />
      {locked ? (
        <View style={styles.locked}>
          <Feather name="lock" size={18} color={colors.inkFaint} />
          <Text style={styles.lockedTitle}>This account is private</Text>
          <Text style={styles.lockedBody}>
            {status === "pending"
              ? `${profile.username} has your request. You'll see their photographs once they accept.`
              : `Ask to follow ${profile.username} to see their photographs.`}
          </Text>
        </View>
      ) : (postsQ.data ?? []).length > 1 ? (
        <GridSortToggle value={view} onChange={setView} />
      ) : null}
    </>
  );

  // A tagged photograph belongs to its author's gallery, not this one.
  const openPost = (p: GridPost) =>
    view === "timeline" || view === "map" || p.tagged_in
      ? router.push(`/post/${p.id}`)
      : router.push({ pathname: "/gallery", params: { authorId: p.author_id, postId: p.id, sort } });
  const shown = locked ? [] : rows;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: profile.username }} />
      {view === "map" && !locked ? (
        <PostMap posts={shown} onOpenPost={openPost} header={header} />
      ) : view === "timeline" && !locked ? (
        <Timeline posts={shown} onOpenPost={openPost} header={header} refreshing={postsQ.isRefetching} onRefresh={() => postsQ.refetch()} />
      ) : (
        <PhotoGrid
          posts={shown}
          onOpenPost={openPost}
          refreshing={postsQ.isRefetching}
          onRefresh={() => postsQ.refetch()}
          header={header}
          empty={
            locked ? null : postsQ.isFetched ? (
              <EmptyState title="No photographs yet" />
            ) : (
              <GridSkeleton />
            )
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  followButton: { flex: 1 },
  messageButton: {
    width: 40,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 3,
  },
  locked: {
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  lockedTitle: { fontFamily: type.serif, fontSize: 16, color: colors.ink },
  lockedBody: { ...type.caption, textAlign: "center", lineHeight: 19 },
});
