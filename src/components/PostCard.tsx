import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { colors, spacing, type } from "@/theme";
import { postAge } from "@/utils/time";
import { getFilter } from "@/filters";
import { Avatar } from "./Avatar";
import { PostMedia } from "./PostMedia";
import type { CommentWithAuthor, PostWithAuthor } from "@/types/db";

/** How many comments read under the photograph before "View all". */
export const INLINE_COMMENTS = 2;

interface Props {
  post: PostWithAuthor;
  likedByMe: boolean;
  onToggleLike: (post: PostWithAuthor, nextLiked: boolean) => void;
  onOpenComments: (post: PostWithAuthor) => void;
  onOpenProfile: (username: string) => void;
  /** "…" affordance — report / delete, decided by the parent. */
  onMore: (post: PostWithAuthor) => void;
  /** Send this photograph to a member. Omitted where sharing makes no sense. */
  onShare?: (post: PostWithAuthor) => void;
  /** The newest comments, shown under the caption. */
  comments?: CommentWithAuthor[];
}

export function PostCard({
  post,
  likedByMe,
  onToggleLike,
  onOpenComments,
  onOpenProfile,
  onMore,
  onShare,
  comments,
}: Props) {
  const like = (next: boolean) => {
    if (next && !likedByMe) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (next !== likedByMe) onToggleLike(post, next);
  };

  const preview = (comments ?? []).slice(-INLINE_COMMENTS);
  const hidden = post.comment_count - preview.length;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Pressable style={styles.author} onPress={() => onOpenProfile(post.author.username)}>
          <Avatar path={post.author.avatar_url} username={post.author.username} size={34} />
          <View style={styles.authorText}>
            <Text style={styles.username}>{post.author.username}</Text>
            {post.location ? (
              <Text style={styles.location} numberOfLines={1}>
                {post.location}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable hitSlop={10} onPress={() => onMore(post)} accessibilityLabel="Post options">
          <Feather name="more-horizontal" size={20} color={colors.inkSoft} />
        </Pressable>
      </View>

      {/* The film stock, set flush right on its own line above the frame —
          the way a stock is marked on a contact sheet. */}
      <Text style={styles.filterName}>{getFilter(post.filter_id).name}</Text>

      <PostMedia post={post} onDoubleTap={() => like(true)} />

      <View style={styles.actions}>
        <Pressable
          hitSlop={8}
          onPress={() => like(!likedByMe)}
          accessibilityLabel={likedByMe ? "Unlike" : "Like"}
        >
          {/* Feather has no solid heart, so the filled state borrows one. */}
          {likedByMe ? (
            <MaterialCommunityIcons name="heart" size={23} color={colors.like} />
          ) : (
            <Feather name="heart" size={23} color={colors.ink} />
          )}
        </Pressable>
        <Pressable hitSlop={8} onPress={() => onOpenComments(post)} accessibilityLabel="Comments">
          <Feather name="message-circle" size={23} color={colors.ink} />
        </Pressable>
        {onShare ? (
          <Pressable hitSlop={8} onPress={() => onShare(post)} accessibilityLabel="Send to">
            <Feather name="send" size={21} color={colors.ink} />
          </Pressable>
        ) : null}
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
  authorText: { marginLeft: spacing.sm + 2, flex: 1 },
  username: { fontSize: 14, fontWeight: "600", color: colors.ink },
  location: { fontSize: 11, color: colors.inkFaint, marginTop: 1 },
  filterName: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
    textAlign: "right",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs + 2,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 2,
    gap: spacing.lg,
  },
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
  comment: {
    ...type.body,
    fontSize: 14,
    color: colors.inkSoft,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs + 2,
  },
  commentsLink: {
    ...type.caption,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs + 2,
  },
});
