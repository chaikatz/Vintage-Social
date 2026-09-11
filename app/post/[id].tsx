import React, { useMemo } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { PostMedia } from "@/components/PostMedia";
import { EmptyState } from "@/components/EmptyState";
import { PostSkeleton } from "@/components/Skeleton";
import { Byline, INLINE_COMMENTS } from "@/components/PostCard";
import { colors, spacing, type } from "@/theme";
import { fetchPost } from "@/api/posts";
import { fetchPostTags, removeTag } from "@/api/tags";
import { libraryGranted, photosFromSameNight } from "@/utils/library";
import { usePostActions } from "@/hooks/usePostActions";
import { useSession } from "@/providers/SessionProvider";

/**
 * One photograph on its own.
 *
 * Where a link lands — a notification, a message, a memory — and the one
 * screen on VINTAGE that belongs entirely to a single picture. It is laid
 * out exactly like a card in the feed, because that is what it is: the
 * picture first and full-bleed, the name and place on the left with the
 * capture date across from them, and the quiet row of actions under it.
 * Nothing boxed, nothing ruled off, no chrome a feed card doesn't have.
 */
export default function PostDetail() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = session?.user?.id ?? "";
  // Comments or a profile pushed on top of this screen pause its video.
  const focused = useIsFocused();

  // Who was there, as far as the viewer is allowed to know: accepted tags,
  // plus your own pending one if it is you in the picture.
  const tagsQ = useQuery({
    queryKey: ["post-tags", id],
    queryFn: () => fetchPostTags(id ?? ""),
    enabled: Boolean(id),
  });
  const untag = useMutation({
    mutationFn: () => removeTag(id ?? "", userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-tags", id] });
      queryClient.invalidateQueries({ queryKey: ["tagged-posts", userId] });
    },
  });

  const postQ = useQuery({
    queryKey: ["post", id],
    queryFn: () => fetchPost(id ?? ""),
    enabled: Boolean(id),
  });

  const postIds = useMemo(() => (id ? [id] : []), [id]);
  const { isLiked, likeCountFor, toggleLike, onMore, onShare, onOpenComments, commentsFor } =
    usePostActions(userId, postIds);

  const post = postQ.data;
  const own = Boolean(post) && post!.author_id === userId;

  // The rest of that night's roll, if this is yours and the phone has it.
  // Only asked when the library has already been allowed — a detail page
  // is not the place for a permission dialog.
  const night = useQuery({
    queryKey: ["same-night", post?.id, post?.taken_at],
    queryFn: async () => {
      if (!(await libraryGranted(false))) return [];
      return photosFromSameNight(post!.taken_at!);
    },
    enabled: own && Boolean(post?.taken_at) && Platform.OS !== "web",
    staleTime: 10 * 60_000,
  });

  if (!post) {
    return (
      <Screen padded={false}>
        <Stack.Screen options={{ title: "" }} />
        {postQ.isFetched ? <EmptyState title="This photograph is gone" /> : <PostSkeleton />}
      </Screen>
    );
  }

  const liked = isLiked(post);
  const likes = likeCountFor(post);
  const like = (next: boolean) => {
    if (next && !liked) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (next !== liked) toggleLike(post, next);
  };
  const preview = commentsFor(post).slice(-INLINE_COMMENTS);
  const hidden = post.comment_count - preview.length;
  const sameNight = night.data?.length ?? 0;
  const openProfile = () => router.push(`/user/${post.author.username}`);
  const shownTags = (tagsQ.data ?? []).filter((t) => t.status === "accepted" || t.user_id === userId);
  const myTag = shownTags.find((t) => t.user_id === userId);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: "" }} />

      {/* Laid out as a feed card, because that is what it is: who, then the
          picture, then the quiet row of actions and the words. */}
      <View style={styles.header}>
        <Pressable onPress={openProfile}>
          <Avatar path={post.author.avatar_url} username={post.author.username} size={34} />
        </Pressable>
        <Pressable style={styles.headerText} onPress={openProfile}>
          <Text style={styles.username} numberOfLines={1}>
            {post.author.username}
          </Text>
          <Byline post={post} />
        </Pressable>
      </View>

      <PostMedia post={post} onDoubleTap={() => like(true)} active={focused} priority="high" />

      {shownTags.length > 0 ? (
        <View style={styles.with}>
          <Feather name="user" size={12} color={colors.inkFaint} />
          <Text style={styles.withText} numberOfLines={2}>
            <Text style={styles.withLabel}>with </Text>
            {shownTags.map((t, i) => (
              <Text
                key={t.user_id}
                style={[styles.withName, t.status === "pending" && styles.withPending]}
                onPress={() => router.push(`/user/${t.member.username}`)}
              >
                {t.member.username}
                {t.status === "pending" ? " (pending)" : ""}
                {i < shownTags.length - 1 ? ", " : ""}
              </Text>
            ))}
          </Text>
          {myTag ? (
            <Pressable hitSlop={8} onPress={() => untag.mutate()} disabled={untag.isPending} accessibilityLabel="Remove me from this photograph">
              <Text style={styles.untag}>Remove me</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable hitSlop={8} onPress={() => like(!liked)} accessibilityLabel={liked ? "Unlike" : "Like"}>
          {liked ? (
            <MaterialCommunityIcons name="heart" size={23} color={colors.like} />
          ) : (
            <Feather name="heart" size={23} color={colors.ink} />
          )}
        </Pressable>
        <Pressable hitSlop={8} onPress={() => onOpenComments(post)} accessibilityLabel="Comments">
          <Feather name="message-circle" size={23} color={colors.ink} />
        </Pressable>
        <Pressable hitSlop={8} onPress={() => onShare(post)} accessibilityLabel="Send to">
          <Feather name="send" size={21} color={colors.ink} />
        </Pressable>
        <View style={styles.spacer} />
        <Pressable
          hitSlop={10}
          onPress={() => onMore(post, () => router.back())}
          accessibilityLabel="Post options"
        >
          <Feather name="more-horizontal" size={20} color={colors.inkSoft} />
        </Pressable>
      </View>

      {likes > 0 ? (
        <Text style={styles.likes}>
          {likes} {likes === 1 ? "like" : "likes"}
        </Text>
      ) : null}

      {post.caption ? (
        <Text style={styles.caption}>
          <Text style={styles.captionAuthor}>{post.author.username}</Text> {post.caption}
        </Text>
      ) : null}

      {(hidden > 0 || preview.length > 0) ? <View style={styles.commentsRule} /> : null}

      {hidden > 0 ? (
        <Pressable onPress={() => onOpenComments(post)}>
          <Text style={styles.commentsLink}>
            View {hidden === 1 && preview.length === 0 ? "1 comment" : `all ${post.comment_count} comments`}
          </Text>
        </Pressable>
      ) : null}
      {preview.map((c) => (
        <Pressable key={c.id} onPress={() => onOpenComments(post)}>
          <Text style={styles.comment} numberOfLines={2}>
            <Text style={styles.captionAuthor}>{c.author.username}</Text> {c.body}
          </Text>
        </Pressable>
      ))}

      {/* Your own photograph, and the phone has the rest of the roll. */}
      {sameNight > 0 ? (
        <Pressable
          style={({ pressed }) => [styles.night, pressed && styles.nightPressed]}
          onPress={() =>
            router.push({
              pathname: "/library-picker",
              params: { mode: "night", iso: post.taken_at ?? "", title: "That night" },
            })
          }
        >
          <Feather name="film" size={15} color={colors.accent} />
          <Text style={styles.nightText}>
            You have {sameNight} {sameNight === 1 ? "photograph" : "photographs"} from this night.
          </Text>
          <Feather name="chevron-right" size={15} color={colors.inkFaint} />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: spacing.xxl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  with: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 2,
  },
  withText: { flex: 1, fontSize: 12, color: colors.inkSoft },
  withLabel: { color: colors.inkFaint },
  withName: { fontWeight: "600", color: colors.ink },
  withPending: { fontWeight: "400", color: colors.inkFaint },
  untag: { fontSize: 12, color: colors.inkSoft },
  commentsRule: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg, marginTop: spacing.md },
  headerText: { flex: 1 },
  username: { fontSize: 14, fontWeight: "600", color: colors.ink },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  spacer: { flex: 1 },
  likes: { fontSize: 13, fontWeight: "600", color: colors.ink, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  caption: { ...type.body, fontFamily: type.serif, fontSize: 15, lineHeight: 22, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  captionAuthor: { fontWeight: "600" },
  comment: { ...type.body, fontSize: 14, color: colors.ink, paddingHorizontal: spacing.lg, paddingTop: spacing.xs + 2 },
  commentsLink: { ...type.caption, paddingHorizontal: spacing.lg, paddingTop: spacing.xs + 2 },
  night: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  nightPressed: { opacity: 0.6 },
  nightText: { flex: 1, fontFamily: type.serif, fontSize: 14, color: colors.ink },
});
