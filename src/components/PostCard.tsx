import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { colors, spacing, type } from "@/theme";
import { shortDate } from "@/utils/time";
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
  /** Whether this card is the one on screen; gates video playback. */
  active?: boolean;
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
  active = true,
}: Props) {
  const like = (next: boolean) => {
    if (next && !likedByMe) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (next !== likedByMe) onToggleLike(post, next);
  };

  const preview = (comments ?? []).slice(-INLINE_COMMENTS);
  const hidden = post.comment_count - preview.length;

  return (
    <View style={styles.card}>
      {/* The name, and under it where and when: `NYC · Jan 23, 2003`, the
          way a place and a date are written on the back of a print. With no
          place the date simply starts the line. Nothing else — the film
          stock is in the picture. */}
      <View style={styles.header}>
        <Pressable onPress={() => onOpenProfile(post.author.username)}>
          <Avatar path={post.author.avatar_url} username={post.author.username} size={34} />
        </Pressable>
        <Pressable style={styles.headerText} onPress={() => onOpenProfile(post.author.username)}>
          <Text style={styles.username} numberOfLines={1}>
            {post.author.username}
          </Text>
          <Byline post={post} />
        </Pressable>
      </View>

      <PostMedia post={post} onDoubleTap={() => like(true)} active={active} />

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
        <Pressable hitSlop={10} onPress={() => onMore(post)} accessibilityLabel="Post options">
          <Feather name="more-horizontal" size={20} color={colors.inkSoft} />
        </Pressable>
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

/**
 * `NYC · JAN 23, 2003` — the one metadata row under a name: where, then
 * when the shutter fired (the posting date only when the file carried no
 * capture date). One face, one size, one colour for both, so they read as
 * a single line of type rather than two facts. A long place gives way
 * before the date does; with no place the date starts the line.
 */
export function Byline({
  post,
  size = "small",
  style,
}: {
  post: { taken_at: string | null; created_at: string; location: string | null };
  size?: "small" | "large";
  style?: object;
}) {
  const place = post.location?.trim();
  const large = size === "large";
  return (
    <View style={[styles.byline, style]}>
      {place ? (
        <>
          <Text style={[styles.meta, large && styles.metaLarge, styles.place]} numberOfLines={1}>
            {place}
          </Text>
          <Text style={[styles.meta, large && styles.metaLarge, styles.dot]}>·</Text>
        </>
      ) : null}
      <Text style={[styles.meta, large && styles.metaLarge]} numberOfLines={1}>
        {shortDate(post.taken_at ?? post.created_at)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingBottom: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerText: { flex: 1 },
  username: { fontSize: 14, fontWeight: "600", color: colors.ink },
  byline: { flexDirection: "row", alignItems: "center", marginTop: 2, gap: 6 },
  meta: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  metaLarge: { fontSize: 12, letterSpacing: 1.8 },
  place: { flexShrink: 1 },
  dot: { color: colors.inkFaint },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 2,
    gap: spacing.lg,
  },
  spacer: { flex: 1 },
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
    color: colors.ink,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs + 2,
  },
  commentsLink: {
    ...type.caption,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs + 2,
  },
});
