import React, { useMemo } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { PostMedia } from "@/components/PostMedia";
import { Signature } from "@/components/Signature";
import { EmptyState } from "@/components/EmptyState";
import { PostSkeleton } from "@/components/Skeleton";
import { INLINE_COMMENTS } from "@/components/PostCard";
import { colors, spacing, type } from "@/theme";
import { fetchPost } from "@/api/posts";
import { getFilter } from "@/filters";
import { postAge } from "@/utils/time";
import { libraryGranted, photosFromSameNight } from "@/utils/library";
import { usePostActions } from "@/hooks/usePostActions";
import { useSession } from "@/providers/SessionProvider";

/**
 * One photograph on its own.
 *
 * Where a link lands — a notification, a message, a memory — and the one
 * screen on VINTAGE that belongs entirely to a single picture. So the
 * picture comes first, full bleed and without a rule, and everything
 * written about it sits underneath in the order a print is read: who,
 * when and where, then what people said.
 */
export default function PostDetail() {
  const router = useRouter();
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = session?.user?.id ?? "";

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

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: post.author.username }} />

      <PostMedia post={post} onDoubleTap={() => like(true)} bare priority="high" />

      <View style={styles.byline}>
        <Pressable onPress={openProfile} style={styles.author}>
          <Avatar path={post.author.avatar_url} username={post.author.username} size={30} />
          <View style={styles.authorText}>
            <Text style={styles.username} numberOfLines={1}>
              {post.author.username}
            </Text>
            {post.author.full_name ? (
              <Text style={styles.fullName} numberOfLines={1}>
                {post.author.full_name}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          hitSlop={10}
          onPress={() => onMore(post, () => router.back())}
          accessibilityLabel="Post options"
        >
          <Feather name="more-horizontal" size={20} color={colors.inkSoft} />
        </Pressable>
      </View>

      {/* The signature: when the shutter fired, where, and on what film.
          Set apart with a short rule, the way a lab writes on the sleeve. */}
      <View style={styles.signature}>
        <View style={styles.rule} />
        <Signature post={post} size="large" numberOfLines={2} style={styles.signatureText} />
        <Text style={styles.film}>{getFilter(post.filter_id).name}</Text>
      </View>

      <View style={styles.actions}>
        <Pressable hitSlop={8} onPress={() => like(!liked)} accessibilityLabel={liked ? "Unlike" : "Like"}>
          {liked ? (
            <MaterialCommunityIcons name="heart" size={24} color={colors.like} />
          ) : (
            <Feather name="heart" size={24} color={colors.ink} />
          )}
        </Pressable>
        <Pressable hitSlop={8} onPress={() => onOpenComments(post)} accessibilityLabel="Comments">
          <Feather name="message-circle" size={24} color={colors.ink} />
        </Pressable>
        <Pressable hitSlop={8} onPress={() => onShare(post)} accessibilityLabel="Send to">
          <Feather name="send" size={22} color={colors.ink} />
        </Pressable>
        <View style={styles.spacer} />
        <Text style={styles.age}>{postAge(post.created_at)}</Text>
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
  byline: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  author: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm + 2 },
  authorText: { flex: 1 },
  username: { fontSize: 14, fontWeight: "600", color: colors.ink },
  fullName: { fontSize: 12, color: colors.inkFaint, marginTop: 1 },
  signature: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  rule: { width: 28, height: 1, backgroundColor: colors.borderStrong, marginBottom: spacing.sm + 2 },
  signatureText: { color: colors.ink },
  film: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.inkFaint,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  spacer: { flex: 1 },
  age: { ...type.caption, color: colors.inkFaint },
  likes: { fontSize: 13, fontWeight: "600", color: colors.ink, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  caption: { ...type.body, fontSize: 14, paddingHorizontal: spacing.lg, paddingTop: spacing.xs + 2 },
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
