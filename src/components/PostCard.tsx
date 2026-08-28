import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, spacing, type } from "@/theme";
import { postAge } from "@/utils/time";
import { getFilter } from "@/filters";
import { Avatar } from "./Avatar";
import { PostMedia } from "./PostMedia";
import type { PostWithAuthor } from "@/types/db";

interface Props {
  post: PostWithAuthor;
  likedByMe: boolean;
  onToggleLike: (post: PostWithAuthor, nextLiked: boolean) => void;
  onOpenComments: (post: PostWithAuthor) => void;
  onOpenProfile: (username: string) => void;
  /** "…" affordance — report / delete, decided by the parent. */
  onMore: (post: PostWithAuthor) => void;
}

export function PostCard({
  post,
  likedByMe,
  onToggleLike,
  onOpenComments,
  onOpenProfile,
  onMore,
}: Props) {
  const like = (next: boolean) => {
    if (next && !likedByMe) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (next !== likedByMe) onToggleLike(post, next);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Pressable style={styles.author} onPress={() => onOpenProfile(post.author.username)}>
          <Avatar path={post.author.avatar_url} username={post.author.username} size={34} />
          <View style={styles.authorText}>
            <Text style={styles.username}>{post.author.username}</Text>
            <Text style={styles.filterName}>{getFilter(post.filter_id).name}</Text>
          </View>
        </Pressable>
        <Pressable hitSlop={10} onPress={() => onMore(post)}>
          <Text style={styles.more}>···</Text>
        </Pressable>
      </View>

      <PostMedia post={post} onDoubleTap={() => like(true)} />

      <View style={styles.actions}>
        <Pressable hitSlop={8} onPress={() => like(!likedByMe)}>
          <Text style={[styles.actionGlyph, likedByMe && styles.liked]}>
            {likedByMe ? "♥" : "♡"}
          </Text>
        </Pressable>
        <Pressable hitSlop={8} onPress={() => onOpenComments(post)}>
          <Text style={styles.actionGlyph}>◌</Text>
        </Pressable>
        <View style={styles.spacer} />
        <Text style={styles.age}>{postAge(post.created_at)}</Text>
      </View>

      {post.like_count > 0 ? (
        <Text style={styles.likes}>
          {post.like_count} {post.like_count === 1 ? "like" : "likes"}
        </Text>
      ) : null}

      {post.caption ? (
        <Text style={styles.caption}>
          <Text style={styles.captionAuthor}>{post.author.username}</Text> {post.caption}
        </Text>
      ) : null}

      {post.comment_count > 0 ? (
        <Pressable onPress={() => onOpenComments(post)}>
          <Text style={styles.commentsLink}>
            View {post.comment_count === 1 ? "1 comment" : `all ${post.comment_count} comments`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.xl, backgroundColor: colors.paper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  author: { flexDirection: "row", alignItems: "center", flex: 1 },
  authorText: { marginLeft: spacing.sm + 2 },
  username: { fontSize: 14, fontWeight: "600", color: colors.ink },
  filterName: { fontSize: 11, color: colors.inkFaint, marginTop: 1 },
  more: { fontSize: 18, color: colors.inkSoft, paddingHorizontal: spacing.xs },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 2,
    gap: spacing.lg,
  },
  actionGlyph: { fontSize: 24, color: colors.ink, lineHeight: 26 },
  liked: { color: colors.like },
  spacer: { flex: 1 },
  age: { ...type.caption, color: colors.inkFaint },
  likes: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  caption: {
    ...type.body,
    fontSize: 14,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs + 2,
  },
  captionAuthor: { fontWeight: "600" },
  commentsLink: {
    ...type.caption,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs + 2,
  },
});
