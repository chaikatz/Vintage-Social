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
import { PlaceGroups } from "@/components/PlaceGroups";
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
import { blockMember, fetchBlockedIds, unblockMember } from "@/api/blocks";
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

  // Have I blocked this member? Their photographs are hidden by the
  // database either way; this decides what the page says about it.
  const blockedQ = useQuery({
    queryKey: ["blocked-ids", myId],
    queryFn: () => fetchBlockedIds(myId),
    enabled: Boolean(myId),
  });
  const blocked = Boolean(profile && blockedQ.data?.has(profile.id));

  // A private member's photographs are theirs until they let you in.
  const locked = (Boolean(profile?.is_private) && !isMe && status !== "accepted") || blocked;

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
    try {
      const conversationId = await openConversation(myId, profile.id);
      router.push(`/messages/${conversationId}`);
    } catch (err) {
      showAlert("Couldn’t open the conversation", err instanceof Error ? err.message : String(err));
    }
  };

  const afterBlockChange = () => {
    queryClient.invalidateQueries({ queryKey: ["blocked-ids", myId] });
    queryClient.invalidateQueries({ queryKey: ["blocked", myId] });
    queryClient.invalidateQueries({ queryKey: ["follow-state", myId, profile?.id] });
    queryClient.invalidateQueries({ queryKey: ["profile", username] });
    queryClient.invalidateQueries({ queryKey: ["user-posts", profile?.id] });
    queryClient.invalidateQueries({ queryKey: ["feed"] });
    queryClient.invalidateQueries({ queryKey: ["explore"] });
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
  };
  const toggleBlock = useMutation({
    mutationFn: async () => {
      if (!profile) return;
      if (blocked) await unblockMember(profile.id);
      else await blockMember(profile.id);
    },
    onSuccess: afterBlockChange,
    onError: (err) => showAlert("That didn’t work", err instanceof Error ? err.message : String(err)),
  });

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

  // Report and block live behind the "…" beside the buttons — and on a
  // long press of the follow button, as before.
  const memberMenu = () => {
    showAlert(profile.username, undefined, [
      {
        text: "Report member",
        style: "destructive",
        onPress: () =>
          router.push({ pathname: "/report", params: { targetType: "profile", profileId: profile.id } }),
      },
      blocked
        ? { text: "Unblock", onPress: () => toggleBlock.mutate() }
        : {
            text: "Block member",
            style: "destructive",
            onPress: () =>
              showAlert(
                `Block ${profile.username}?`,
                "They won't see your photographs or profile, and you won't see theirs. Neither of you is told. You can unblock from Settings.",
                [
                  { text: "Block", style: "destructive", onPress: () => toggleBlock.mutate() },
                  { text: "Cancel", style: "cancel" },
                ],
              ),
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
          isMe ? undefined : blocked ? (
            <View style={styles.actions}>
              <View style={styles.followButton}>
                <Button title="Unblock" variant="secondary" small loading={toggleBlock.isPending} onPress={() => toggleBlock.mutate()} />
              </View>
              <Pressable style={styles.messageButton} onPress={memberMenu} accessibilityLabel="More">
                <Feather name="more-horizontal" size={16} color={colors.ink} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.actions}>
              <View style={styles.followButton}>
                <Button
                  title={followLabel}
                  variant={status ? "secondary" : "primary"}
                  small
                  loading={toggleFollow.isPending}
                  onPress={() => toggleFollow.mutate(status === null)}
                  onLongPress={memberMenu}
                />
              </View>
              <Pressable style={styles.messageButton} onPress={message} accessibilityLabel="Message">
                <Feather name="send" size={16} color={colors.ink} />
              </Pressable>
              <Pressable style={styles.messageButton} onPress={memberMenu} accessibilityLabel="More">
                <Feather name="more-horizontal" size={16} color={colors.ink} />
              </Pressable>
            </View>
          )
        }
      />
      {blocked ? (
        <View style={styles.locked}>
          <Feather name="slash" size={18} color={colors.inkFaint} />
          <Text style={styles.lockedTitle}>You blocked {profile.username}</Text>
          <Text style={styles.lockedBody}>Neither of you sees the other’s photographs. Unblock to change that.</Text>
        </View>
      ) : locked ? (
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
    view === "timeline" || view === "map" || view === "places" || p.tagged_in
      ? router.push(`/post/${p.id}`)
      : router.push({ pathname: "/gallery", params: { authorId: p.author_id, postId: p.id, sort } });
  const shown = locked ? [] : rows;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: profile.username }} />
      {view === "map" && !locked ? (
        <PostMap posts={shown} onOpenPost={openPost} header={header} />
      ) : view === "places" && !locked ? (
        <PlaceGroups posts={shown} onOpenPost={openPost} header={header} refreshing={postsQ.isRefetching} onRefresh={() => postsQ.refetch()} />
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
