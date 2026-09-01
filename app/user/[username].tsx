import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { showAlert } from "@/utils/alert";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { ProfileHeader } from "@/components/ProfileHeader";
import { PhotoGrid } from "@/components/PhotoGrid";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { colors, spacing, type } from "@/theme";
import { fetchProfileByUsername, follow, followState, unfollow } from "@/api/profiles";
import { fetchUserPosts } from "@/api/posts";
import { openConversation } from "@/api/messages";
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

  const toggleFollow = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) await follow(myId, profile!.id);
      else await unfollow(myId, profile!.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-state", myId, profile?.id] });
      queryClient.invalidateQueries({ queryKey: ["profile", username] });
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
      <Screen>
        <Stack.Screen options={{ title: username ?? "" }} />
        {profileQ.isFetched ? <EmptyState title="Member not found" /> : null}
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
      ) : (postsQ.data ?? []).length === 0 && postsQ.isFetched ? (
        <EmptyState title="No photographs yet" />
      ) : null}
    </>
  );

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: profile.username }} />
      <PhotoGrid
        posts={locked ? [] : postsQ.data ?? []}
        onOpenPost={(p) =>
          router.push({ pathname: "/gallery", params: { authorId: p.author_id, postId: p.id } })
        }
        refreshing={postsQ.isRefetching}
        onRefresh={() => postsQ.refetch()}
        header={header}
      />
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
