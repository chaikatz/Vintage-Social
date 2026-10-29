import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { colors, spacing, type } from "@/theme";
import { Avatar } from "../Avatar";
import { Byline, INLINE_COMMENTS, PostCard } from "../PostCard";
import { PostMedia } from "../PostMedia";

/** Exactly PostCard's props: Home hands either card the same ones. */
type Props = React.ComponentProps<typeof PostCard>;

/**
 * Editorial (Preview): a post set out as an entry in a photographic
 * journal. Home draws it in place of PostCard when the member chooses it
 * in Settings (see src/utils/feedLayout.ts); nothing else does.
 *
 * The same photograph in the same frame, and the same handlers, in a
 * different order. The member and the "…" share one line above the
 * picture. Under it, the way a plate is captioned in a book: where and
 * when in the typewriter face, then the member's own words in the serif,
 * without their name again, since it is just above. Then the three
 * buttons, with the counts set on the right of the same line, and the
 * newest comments, which are other people's, last. The comment count
 * opens the conversation, so there is no "View all" line under it.
 *
 * Nothing here decides anything. A like goes through the very same steps
 * as PostCard's, the double tap is PostMedia's, and the "…", the counts
 * and the comments call what Home passes in.
 */
export function EditorialPostCard({
  post,
  likedByMe,
  onToggleLike,
  onOpenComments,
  onOpenProfile,
  onMore,
  onShare,
  onOpenLikes,
  comments,
  active = true,
  warm = true,
  surface = "feed",
}: Props) {
  const like = (next: boolean) => {
    if (next && !likedByMe) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (next !== likedByMe) onToggleLike(post, next);
  };

  const preview = (comments ?? []).slice(-INLINE_COMMENTS);
  const likes = `${post.like_count} ${post.like_count === 1 ? "like" : "likes"}`;
  const replies = `${post.comment_count} ${post.comment_count === 1 ? "comment" : "comments"}`;

  return (
    <View style={styles.card} testID="editorial-post-card">
      <View style={styles.header}>
        <Pressable
          style={styles.member}
          onPress={() => onOpenProfile(post.author.username)}
          accessibilityRole="button"
        >
          <Avatar path={post.author.avatar_url} username={post.author.username} size={30} />
          <Text style={styles.username} numberOfLines={1}>
            {post.author.username}
          </Text>
        </Pressable>
        <Pressable style={styles.button} onPress={() => onMore(post)} accessibilityLabel="Post options">
          <Feather name="more-horizontal" size={20} color={colors.inkSoft} />
        </Pressable>
      </View>

      <PostMedia
        post={post}
        onDoubleTap={() => like(true)}
        active={active}
        recyclingKey={post.id}
        warm={warm}
        surface={surface}
      />

      {/* The plate's caption: `MILAN · OCT 28, 2026`, then the words. */}
      <View style={styles.plate}>
        <Byline post={post} />
        {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          onPress={() => like(!likedByMe)}
          accessibilityLabel={likedByMe ? "Unlike" : "Like"}
        >
          {/* Feather has no solid heart, so the filled state borrows one. */}
          {likedByMe ? (
            <MaterialCommunityIcons name="heart" size={22} color={colors.like} />
          ) : (
            <Feather name="heart" size={21} color={colors.ink} />
          )}
        </Pressable>
        <Pressable style={styles.button} onPress={() => onOpenComments(post)} accessibilityLabel="Comments">
          <Feather name="message-circle" size={21} color={colors.ink} />
        </Pressable>
        {onShare ? (
          <Pressable style={styles.button} onPress={() => onShare(post)} accessibilityLabel="Send to">
            <Feather name="send" size={19} color={colors.ink} />
          </Pressable>
        ) : null}

        {/* The counts as a line of type, not a row of their own. Each opens its list. */}
        <View style={styles.counts}>
          {post.like_count > 0 ? (
            <Pressable style={styles.count} onPress={() => onOpenLikes?.(post)} disabled={!onOpenLikes}>
              <Text style={styles.countText}>{likes}</Text>
            </Pressable>
          ) : null}
          {post.like_count > 0 && post.comment_count > 0 ? <Text style={[styles.countText, styles.dot]}>·</Text> : null}
          {post.comment_count > 0 ? (
            <Pressable style={styles.count} onPress={() => onOpenComments(post)} accessibilityRole="button">
              <Text style={styles.countText}>{replies}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {preview.map((c) => (
        <Pressable key={c.id} onPress={() => onOpenComments(post)}>
          <Text style={styles.comment} numberOfLines={2}>
            <Text style={styles.commenter}>{c.author.username}</Text> {c.body}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The side of a button: Apple's smallest comfortable target. */
const TARGET = 44;

const styles = StyleSheet.create({
  // Posts are separated by air, not rules, as on the original card.
  card: {
    paddingBottom: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.paper,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: spacing.lg,
    // The "…" sits in a full target; its dots line up with the margin.
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  member: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md - 2,
    minHeight: TARGET,
  },
  username: { flexShrink: 1, fontSize: 14, fontWeight: "600", color: colors.ink },
  button: {
    minWidth: TARGET,
    minHeight: TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  plate: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  caption: {
    fontFamily: type.serif,
    fontSize: 16,
    lineHeight: 23,
    color: colors.ink,
    marginTop: spacing.xs + 2,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    // The heart's outline, not its target, starts at the margin.
    paddingLeft: spacing.xs,
    paddingRight: spacing.lg,
    marginTop: spacing.xs,
  },
  counts: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  count: {
    minWidth: TARGET,
    minHeight: TARGET,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  countText: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  dot: { color: colors.inkFaint },
  comment: {
    ...type.body,
    fontSize: 14,
    color: colors.ink,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs + 2,
  },
  commenter: { fontWeight: "600" },
});
