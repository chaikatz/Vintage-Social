import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { colors, spacing, type } from "@/theme";
import { postedAgo, postedAgoSpoken, shortDate } from "@/utils/time";
import { useMinute } from "@/utils/useMinute";
import { mentionedUsernames } from "@/utils/mentions";
import { nameActions, nameFromAction } from "@/utils/nameActions";
import { LIKES_HINT, likesLine } from "@/utils/ownLikes";
import { Avatar } from "./Avatar";
import { MentionText, NameLink } from "./MemberText";
import { PostMedia } from "./PostMedia";
import { authorShown, withAuthors } from "./hiddenAuthors";
import type { ClipSurface } from "@/utils/videoTiming";
import type { CommentWithAuthor, PostWithAuthor } from "@/types/db";

/** How many comments read under the photograph before "View all". */
export const INLINE_COMMENTS = 2;

interface Props {
  post: PostWithAuthor;
  /**
   * Who is reading: the count under a photograph, and who liked it, are
   * shown to its author only (src/utils/ownLikes.ts).
   */
  viewerId: string;
  likedByMe: boolean;
  onToggleLike: (post: PostWithAuthor, nextLiked: boolean) => void;
  onOpenComments: (post: PostWithAuthor) => void;
  onOpenProfile: (username: string) => void;
  /** "…" affordance — report / delete, decided by the parent. */
  onMore: (post: PostWithAuthor) => void;
  /** Send this photograph to a member. Omitted where sharing makes no sense. */
  onShare?: (post: PostWithAuthor) => void;
  /** The names behind the count, on your own photograph (the only one with a count). */
  onOpenLikes?: (post: PostWithAuthor) => void;
  /** The newest comments, shown under the caption. */
  comments?: CommentWithAuthor[];
  /** Press and hold on one of them: its menu (Report, or Delete for your own), as on the Comments screen. */
  onCommentLongPress?: (comment: CommentWithAuthor) => void;
  /** Whether this card is the one on screen; gates video playback. */
  active?: boolean;
  /** Whether its clip may have a player yet; see PostMedia. Defaults to true. */
  warm?: boolean;
  /**
   * Draw the picture's frame and not the picture yet; see PostMedia. The
   * card is the same height either way. Defaults to false. Like `warm`,
   * it only passes through to the picture, so a card that takes these
   * props hands it straight on.
   */
  frameOnly?: boolean;
  /** With `frameOnly`, the grid's small copy stands in the frame; see PostMedia. Defaults to false. */
  standIn?: boolean;
  /** Load this card's picture ahead of the others'; see PostMedia. Defaults to "normal". */
  priority?: "high" | "normal";
  /** Where the card is, for the development build's start-up timings only. */
  surface?: ClipSurface;
}

/**
 * A post in a list: who, the picture, the quiet row of actions, the words.
 *
 * Drawn again only when something it is given has changed. A list draws
 * every card it holds again whenever it draws, and Home's draws each time
 * a different card comes on screen (only that card plays); without this
 * every card held, each with its picture, avatar and comments, was drawn
 * again each time the reader moved on by one photograph. The screens hand
 * it the same objects while nothing has changed (src/media/stableCards.ts).
 */
export const PostCard = React.memo(function PostCard({
  post,
  viewerId,
  likedByMe,
  onToggleLike,
  onOpenComments,
  onOpenProfile,
  onMore,
  onShare,
  onOpenLikes,
  comments,
  onCommentLongPress,
  active = true,
  warm = true,
  frameOnly = false,
  standIn = false,
  priority = "normal",
  surface = "feed",
}: Props) {
  // A post whose author the reader may not see comes back naming nobody
  // (src/components/hiddenAuthors.ts). The card draws nothing for it: not
  // a photograph with no one's name, and never a read of a name that is
  // not there, which replaced the whole feed with the recover page.
  if (!authorShown(post)) return null;

  const like = (next: boolean) => {
    if (next && !likedByMe) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (next !== likedByMe) onToggleLike(post, next);
  };

  // Your own photograph's count (or "No likes yet", in the same place); nothing on anyone else's.
  const likes = likesLine(post, viewerId, post.like_count);

  // A comment whose author the reader may not see is left out, as on the comments screen.
  const preview = withAuthors(comments ?? []).slice(-INLINE_COMMENTS);
  const hidden = post.comment_count - preview.length;

  return (
    <View style={styles.card}>
      {/* The name, and under it where and when: `NYC · Jan 23, 2003`, the
          way a place and a date are written on the back of a print. With no
          place the date simply starts the line. Nothing else — the film
          stock is in the picture. */}
      <View style={styles.header}>
        <Pressable
          onPress={() => onOpenProfile(post.author.username)}
          accessibilityRole="button"
          accessibilityLabel={`${post.author.username}’s profile`}
        >
          <Avatar path={post.author.avatar_url} username={post.author.username} size={34} />
        </Pressable>
        <Pressable style={styles.headerText} onPress={() => onOpenProfile(post.author.username)} accessibilityRole="button">
          <Text style={styles.username} numberOfLines={1}>
            {post.author.username}
          </Text>
          <Byline post={post} />
        </Pressable>
      </View>

      <PostMedia
        post={post}
        onDoubleTap={() => like(true)}
        active={active}
        recyclingKey={post.id}
        warm={warm}
        frameOnly={frameOnly}
        standIn={standIn}
        priority={priority}
        surface={surface}
      />

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

      {/* The count is the author's alone; on anyone else's photograph there is no line at all. */}
      {likes ? (
        likes.opens ? (
          <Pressable
            onPress={() => onOpenLikes?.(post)}
            disabled={!onOpenLikes}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={likes.label}
            accessibilityHint={LIKES_HINT}
          >
            <Text style={styles.likes}>{likes.text}</Text>
          </Pressable>
        ) : (
          <Text style={[styles.likes, styles.noLikes]} accessibilityLabel={likes.label}>
            {likes.text}
          </Text>
        )
      ) : null}

      {post.caption ? (
        <Text style={styles.caption}>
          {/* The name and every @name in the words open their member's page. */}
          <NameLink username={post.author.username} onOpenProfile={onOpenProfile} style={styles.captionAuthor} />{" "}
          <MentionText text={post.caption} onOpenProfile={onOpenProfile} />
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
        <Pressable
          key={c.id}
          onPress={() => onOpenComments(post)}
          // Held, the comment's own menu, and Comments is not opened on release.
          onLongPress={onCommentLongPress ? () => onCommentLongPress(c) : undefined}
          // To VoiceOver the line is one element: a double tap opens Comments, never a name
          // under the middle of it; its names are its actions (src/utils/nameActions.ts).
          onAccessibilityTap={() => onOpenComments(post)}
          accessibilityActions={nameActions([c.author.username, ...mentionedUsernames(c.body)])}
          onAccessibilityAction={(e) => {
            const username = nameFromAction(e.nativeEvent.actionName);
            if (username) onOpenProfile(username);
          }}
        >
          <Text style={styles.comment} numberOfLines={2}>
            {/* A name, or an @name, opens its member's page; held, the comment's menu, as the rest of the line. */}
            <NameLink
              username={c.author.username}
              onOpenProfile={onOpenProfile}
              onLongPress={onCommentLongPress ? () => onCommentLongPress(c) : undefined}
              style={styles.captionAuthor}
            />{" "}
            <MentionText
              text={c.body}
              onOpenProfile={onOpenProfile}
              onLongPress={onCommentLongPress ? () => onCommentLongPress(c) : undefined}
            />
          </Text>
        </Pressable>
      ))}

      {/* When it went up, last, under everything said about it. */}
      <PostedTime at={post.created_at} />
    </View>
  );
});

/**
 * `29m ago` — when a post went up, at the foot of its card, in the byline's
 * type a shade fainter. The posting time, not the capture date, which the
 * byline already gives. Written as it is said, not in the byline's
 * capitals: `29M AGO` reads as twenty-nine months. It follows the app's
 * one clock, so it moves on by itself, and only this line is drawn again
 * when it does. A post's own page ends with it too.
 */
export function PostedTime({ at }: { at: string }) {
  const now = new Date(useMinute());
  return (
    <Text style={[styles.meta, styles.posted]} numberOfLines={1} accessibilityLabel={postedAgoSpoken(at, now)}>
      {postedAgo(at, now)}
    </Text>
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
  // Posts are separated by air, not rules.
  card: {
    paddingBottom: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.paper,
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
  // One height for the count and for "No likes yet", so the first like
  // changes the words and not the card.
  likes: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: colors.ink,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  noLikes: { fontWeight: "400", color: colors.inkFaint },
  caption: {
    ...type.body,
    fontSize: 14,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs + 2,
  },
  captionAuthor: { fontWeight: "600" },
  comment: {
    ...type.body,
    fontSize: 14,
    color: colors.ink,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs + 2,
  },
  commentsLink: {
    ...type.caption,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs + 2,
  },
  posted: {
    textTransform: "none",
    color: colors.inkFaint,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
});
