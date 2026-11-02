import React from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import * as Haptics from "expo-haptics";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { colors, spacing, type } from "@/theme";
import { PRINT_WIDTH, exportLabelText, exportLayout, type TextBox } from "@/utils/exportLayout";
import { paperStyle, useFeedPaper } from "@/utils/feedPaper";
import { postedAgo, postedAgoSpoken } from "@/utils/time";
import { useMinute } from "@/utils/useMinute";
import { Avatar } from "../Avatar";
import { INLINE_COMMENTS, PostCard } from "../PostCard";
import { PostMedia } from "../PostMedia";

/** Exactly PostCard's props: a feed hands either card the same ones. */
type Props = React.ComponentProps<typeof PostCard>;

/**
 * Editorial (Preview): each post set out as a print, the way a photograph
 * leaves VINTAGE (see src/components/ExportCard.tsx). Home and the gallery
 * draw it in place of PostCard when the member chooses it in Settings (see
 * src/utils/feedLayout.ts); nothing else does.
 *
 * Above the picture, where the original card has them, the member's
 * picture and name, and the "…" at the end of that line. Then the picture
 * on the paper inside the print's margins, the print's hairline under it
 * and the print's label under that. The label keeps its right-hand side as
 * it is struck, where and when, in the typewriter face; the wordmark's
 * place on the left goes to the three buttons, just under the hairline.
 * No counts and no number. Then the caption after the member's name, the
 * way a comment is written, the newest comments, and last of all when it
 * went up.
 *
 * Only the print keeps the print's margins. Everything said around it —
 * the member, the buttons, the label, the words — is set where Instagram
 * sets it: from one edge, the same distance in from the screen's side
 * (EDGE), and one post follows another as closely as there. Between them
 * is nothing but the paper chosen in Settings (see src/utils/feedPaper.ts).
 *
 * Nothing here decides anything. A like goes through the very same steps
 * as PostCard's, the double tap is PostMedia's, and the name, the "…" and
 * the comments call what the screen passes in.
 */
export function EditorialPostCard({
  post,
  likedByMe,
  onToggleLike,
  onOpenComments,
  onOpenProfile,
  onMore,
  onShare,
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
  // The print's own words: the place and the date in full. Its `@name` is left off; the name is above the picture.
  const label = exportLabelText(post, null);
  const paper = paperStyle(useFeedPaper());
  // Larger Text grows the label, up to its cap, and the right-hand lines
  // then ask for more room beside the buttons.
  const scale = Math.min(Math.max(useWindowDimensions().fontScale, 1), LABEL_CAP);
  const dateline = { flexBasis: DATELINE * scale };

  return (
    <View style={[styles.card, paper]} testID="editorial-post-card">
      {/* The member, as the original card has them: their picture and name, which open their profile, and the "…". */}
      <View style={styles.header}>
        <Pressable
          style={styles.member}
          onPress={() => onOpenProfile(post.author.username)}
          accessibilityRole="button"
          accessibilityLabel={post.author.username}
          accessibilityHint="Opens their profile"
        >
          <Avatar path={post.author.avatar_url} username={post.author.username} size={AVATAR} />
          <Text style={styles.username} numberOfLines={1}>
            {post.author.username}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.more]}
          onPress={() => onMore(post)}
          accessibilityRole="button"
          accessibilityLabel="Post options"
        >
          <Feather name="more-horizontal" size={DOTS} color={colors.inkSoft} />
        </Pressable>
      </View>

      {/* A print has no frame: the picture lies on the paper inside the print's margins, without the hairlines PostMedia draws across a full-width feed. The hairline under it runs edge to edge with the words. */}
      <View style={styles.print}>
        <PostMedia
          post={post}
          onDoubleTap={() => like(true)}
          active={active}
          recyclingKey={post.id}
          warm={warm}
          surface={surface}
          bare
        />

      </View>

      <View style={styles.rule} />

      {/* The label: the buttons where the wordmark was, `MILAN / OCTOBER 28, 2026` on the right. */}
      <View style={styles.label}>
        <View style={styles.actions}>
          <Pressable
            style={styles.button}
            onPress={() => like(!likedByMe)}
            accessibilityRole="button"
            accessibilityLabel={likedByMe ? "Unlike" : "Like"}
          >
            {/* Feather has no solid heart, so the filled state borrows one. */}
            {likedByMe ? (
              <MaterialCommunityIcons name="heart" size={22} color={colors.like} />
            ) : (
              <Feather name="heart" size={ICON} color={colors.ink} />
            )}
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() => onOpenComments(post)}
            accessibilityRole="button"
            accessibilityLabel="Comments"
          >
            <Feather name="message-circle" size={ICON} color={colors.ink} />
          </Pressable>
          {onShare ? (
            <Pressable
              style={styles.button}
              onPress={() => onShare(post)}
              accessibilityRole="button"
              accessibilityLabel="Send to"
            >
              <Feather name="send" size={ICON - 2} color={colors.ink} />
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.dateline, dateline]}>
          {label.place ? (
            <Text maxFontSizeMultiplier={LABEL_CAP} style={styles.place} numberOfLines={2}>
              {label.place}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={LABEL_CAP} style={styles.date} numberOfLines={1}>
            {label.date}
          </Text>
        </View>
      </View>

      {post.caption ? (
        <Text style={styles.caption}>
          <Text style={styles.author}>{post.author.username}</Text> {post.caption}
        </Text>
      ) : null}

      {preview.map((c) => (
        <Pressable key={c.id} onPress={() => onOpenComments(post)}>
          <Text style={styles.comment} numberOfLines={2}>
            <Text style={styles.author}>{c.author.username}</Text> {c.body}
          </Text>
        </Pressable>
      ))}

      {/* When it went up, last, under everything said about it. */}
      <PostedTime at={post.created_at} />
    </View>
  );
}

/**
 * `29M AGO`: when the post went up, at the foot of the print, in the
 * label's typewriter face a shade fainter. The posting time, not the day
 * it was taken, which the label already gives. It follows the app's one
 * clock, so it moves on by itself, and only this line is drawn again when
 * it does.
 */
function PostedTime({ at }: { at: string }) {
  const now = new Date(useMinute());
  return (
    <Text
      maxFontSizeMultiplier={LABEL_CAP}
      style={styles.posted}
      numberOfLines={1}
      accessibilityLabel={postedAgoSpoken(at, now)}
    >
      {postedAgo(at, now)}
    </Text>
  );
}

/**
 * The print as it is struck, at its own width. The feed takes its margins
 * as fractions of the width, and its label as it is set there: the same
 * sizes, in points, the same tracking and the same leading.
 */
const PRINT = exportLayout(1, "print", PRINT_WIDTH);

/** A length on the print as a share of its width: the card is the print at the screen's width. */
function share(length: number): `${number}%` {
  return `${Math.round((length / PRINT_WIDTH) * 10000) / 100}%`;
}

/** One line of the label, as the print sets it. */
function line(box: TextBox) {
  return {
    fontFamily: type.mono,
    fontSize: box.size,
    letterSpacing: box.spacing,
    lineHeight: Math.round(box.size * 1.35 * 100) / 100,
  };
}

/** The side of a button: Apple's smallest comfortable target. */
const TARGET = 44;

/** The buttons' outline size. */
const ICON = 21;

/** The "…", a little smaller; Feather's three dots span three quarters of its width. */
const DOTS = 18;

/** The member's picture, the size the original card gives it. */
const AVATAR = 34;

/**
 * How far the label's typewriter lines grow with Larger Text. At twice
 * their size the longest date still fits across a 320 pt screen, on a
 * line of its own under the buttons; any larger and it would not.
 */
const LABEL_CAP = 2;

/**
 * The narrowest the right-hand lines are set: the longest date there is,
 * SEPTEMBER 30, 2026, in a face whose every letter is 0.6 of its size
 * wide. With less room beside the buttons they go under them instead.
 */
const DATELINE = "SEPTEMBER 30, 2026".length * (PRINT.byline.size * 0.6 + PRINT.byline.spacing);

/** The space between the picture and the rule, and between the label's lines. */
const GAP = PRINT.rule.y - (PRINT.photo.y + PRINT.photo.height);
const BETWEEN = PRINT.byline.y - (PRINT.place.y + PRINT.place.height);

/**
 * Where Instagram sets what is around a post: the member's picture, the
 * first button and every line of words start this far in from the left of
 * the screen, and the "…" and the label end this far in from the right.
 */
const EDGE = 12;

/** The buttons' outlines start this far under the hairline, as Instagram's start under the picture. */
const UNDER_RULE = 10;

/** The paper under one post's last line, and over the next one's row: together about Instagram's gap. */
const FOOT = 14;
const HEAD = 4;

/** How far a target reaches past its outline on each side. */
const INSET = (TARGET - ICON) / 2;

/** The caption starts this much inside the buttons' lower reach, as close under them as Instagram's words. */
const UNDER_WORDS = 4;

const styles = StyleSheet.create({
  // A sheet of the paper, a little of it above the member's row and a
  // little under the last line, where the next post begins, about as
  // close as Instagram's. The paper itself is the one chosen (see `paper`).
  card: {
    paddingTop: HEAD,
    paddingBottom: FOOT,
  },
  // As near the picture as on the original card: the picture's top edge
  // is as far under the member's picture as there.
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: EDGE,
    marginBottom: spacing.md - (TARGET - AVATAR) / 2,
  },
  // Their picture starts at the edge Instagram's does.
  member: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: TARGET,
  },
  username: { flexShrink: 1, fontSize: 14, fontWeight: "600", color: colors.ink },
  // The print alone keeps the print's margins, a share of the width.
  print: {
    paddingHorizontal: share(PRINT.margin),
  },
  // As far under the picture as on the print, and as wide as the words
  // under it, so the buttons and the label lie just beneath it.
  rule: {
    height: PRINT.rule.height,
    marginHorizontal: EDGE,
    marginTop: share(GAP),
    backgroundColor: colors.borderStrong,
  },
  // Just under the hairline: the buttons' outlines start UNDER_RULE below
  // it, and their targets reach up to it. The place and the date sit level
  // with them, centred on the buttons as Instagram's last one is. On a
  // narrow screen, or with large text, the right-hand lines go under the
  // buttons, still set against the right edge.
  label: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: spacing.md,
    paddingHorizontal: EDGE,
    marginTop: UNDER_RULE - INSET,
    marginBottom: -UNDER_WORDS,
  },
  // The heart's outline, not its target, starts at the edge.
  actions: {
    flexDirection: "row",
    marginLeft: -INSET,
  },
  button: {
    minWidth: TARGET,
    minHeight: TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  dateline: {
    flexGrow: 1,
    flexShrink: 1,
    alignItems: "flex-end",
  },
  // Tracking follows the last letter too; the words, not that space, end at the margin.
  place: {
    ...line(PRINT.place),
    textAlign: "right",
    color: colors.inkSoft,
    marginBottom: BETWEEN,
    marginRight: -PRINT.place.spacing,
  },
  date: { ...line(PRINT.byline), textAlign: "right", color: colors.inkSoft, marginRight: -PRINT.byline.spacing },
  more: {
    // The dots, not their target, end at the edge.
    marginRight: -(TARGET - DOTS * 0.75) / 2,
  },
  // The member's words in the comments' own type, after their name, so the text under a picture reads as one.
  caption: {
    ...type.body,
    fontSize: 14,
    color: colors.ink,
    paddingHorizontal: EDGE,
  },
  comment: {
    ...type.body,
    fontSize: 14,
    color: colors.ink,
    paddingHorizontal: EDGE,
    paddingTop: spacing.xs,
  },
  author: { fontWeight: "600" },
  // The label's typewriter line, a shade fainter than the date.
  posted: {
    ...line(PRINT.byline),
    textTransform: "uppercase",
    color: colors.inkFaint,
    paddingHorizontal: EDGE,
    paddingTop: spacing.sm - 2,
  },
});
