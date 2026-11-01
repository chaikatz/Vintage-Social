import React from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import * as Haptics from "expo-haptics";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { colors, spacing, type } from "@/theme";
import { PRINT_WIDTH, exportLabelText, exportLayout, type TextBox } from "@/utils/exportLayout";
import { INLINE_COMMENTS, PostCard } from "../PostCard";
import { PostMedia } from "../PostMedia";

/** Exactly PostCard's props: Home hands either card the same ones. */
type Props = React.ComponentProps<typeof PostCard>;

/**
 * Editorial (Preview): each post set out as a print, the way a photograph
 * leaves VINTAGE (see src/components/ExportCard.tsx). Home draws it in
 * place of PostCard when the member chooses it in Settings (see
 * src/utils/feedLayout.ts); nothing else does.
 *
 * The picture sits on the paper inside the print's margins, with the
 * print's hairline under it and the print's label under that. The label
 * keeps its right-hand side as it is struck: where, when, and whose, in
 * the typewriter face. The wordmark's place on the left goes to the three
 * buttons, with the counts beneath them where "Members only" was, and the
 * "…" follows the member's name where their number was; the feed shows
 * neither. Then the member's own words, set like the comments, and the
 * newest comments, inside the same margins. One print follows another
 * with a strip of the darker paper between them.
 *
 * Nothing here decides anything. A like goes through the very same steps
 * as PostCard's, the double tap is PostMedia's, and the "…", the counts,
 * the name and the comments call what Home passes in.
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
  // The print's own words, given no membership number: the place, the date in full, and `@name`.
  const label = exportLabelText(post, null);
  // Larger Text grows the label, up to its cap. The right-hand lines then
  // ask for more room beside the buttons, and the name's line, whose
  // targets reach above and below it, is taller.
  const scale = Math.min(Math.max(useWindowDimensions().fontScale, 1), LABEL_CAP);
  const dateline = { flexBasis: DATELINE * scale };
  const reach = { marginVertical: -Math.max(0, TARGET - CREDIT_LINE * scale) / 2 };

  return (
    <View style={styles.card} testID="editorial-post-card">
      {/* A print has no frame: the picture lies on the paper, without the hairlines PostMedia draws across a full-width feed. */}
      <PostMedia
        post={post}
        onDoubleTap={() => like(true)}
        active={active}
        recyclingKey={post.id}
        warm={warm}
        surface={surface}
        bare
      />

      <View style={styles.rule} />

      {/* The label: the buttons and their counts where the wordmark was, `MILAN / OCTOBER 28, 2026 / @elena …` on the right. */}
      <View style={styles.label}>
        <View style={styles.buttons}>
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
                <Feather name="heart" size={ICON} color={colors.ink} />
              )}
            </Pressable>
            <Pressable style={styles.button} onPress={() => onOpenComments(post)} accessibilityLabel="Comments">
              <Feather name="message-circle" size={ICON} color={colors.ink} />
            </Pressable>
            {onShare ? (
              <Pressable style={styles.button} onPress={() => onShare(post)} accessibilityLabel="Send to">
                <Feather name="send" size={ICON - 2} color={colors.ink} />
              </Pressable>
            ) : null}
          </View>

          {/* The counts, each opening its list, as the line under the buttons. */}
          {post.like_count > 0 || post.comment_count > 0 ? (
            <View style={styles.counts}>
              {post.like_count > 0 ? (
                <Pressable style={styles.count} onPress={() => onOpenLikes?.(post)} disabled={!onOpenLikes}>
                  <Text maxFontSizeMultiplier={LABEL_CAP} style={styles.countText}>{likes}</Text>
                </Pressable>
              ) : null}
              {post.like_count > 0 && post.comment_count > 0 ? <Text maxFontSizeMultiplier={LABEL_CAP} style={[styles.countText, styles.dot]}>·</Text> : null}
              {post.comment_count > 0 ? (
                <Pressable style={styles.count} onPress={() => onOpenComments(post)} accessibilityRole="button">
                  <Text maxFontSizeMultiplier={LABEL_CAP} style={styles.countText}>{replies}</Text>
                </Pressable>
              ) : null}
            </View>
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
          <View style={styles.credit}>
            <Pressable
              style={[styles.name, reach]}
              onPress={() => onOpenProfile(post.author.username)}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={LABEL_CAP} style={styles.creditText} numberOfLines={1}>
                {label.credit}
              </Text>
            </Pressable>
            <Pressable style={[styles.button, styles.more, reach]} onPress={() => onMore(post)} accessibilityLabel="Post options">
              <Feather name="more-horizontal" size={DOTS} color={colors.inkSoft} />
            </Pressable>
          </View>
        </View>
      </View>

      {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}

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

/**
 * The print as it is struck, at its own width. The feed takes its margins
 * as fractions of the width, and its label as it is set there: the same
 * sizes, in points, the same tracking and the same leading.
 */
const PRINT = exportLayout(1, "print", PRINT_WIDTH);

/** A length on the print as a share of its width, for a card of any width. */
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

/** Where the label's first line starts under the rule; the buttons' outlines start there too. */
const LABEL_TOP = PRINT.place.y - PRINT.rule.y;
const INSET = (TARGET - ICON) / 2;

/** The height of the name's line at the standard text size. */
const CREDIT_LINE = line(PRINT.credit).lineHeight;

const styles = StyleSheet.create({
  // A sheet of the paper: a little of it above the picture, the print's
  // margins at the sides, and the darker paper underneath, where the next
  // print begins.
  card: {
    paddingHorizontal: share(PRINT.margin),
    paddingTop: share(GAP),
    paddingBottom: share(PRINT.margin),
    backgroundColor: colors.paper,
    borderBottomWidth: spacing.sm,
    borderBottomColor: colors.paperSunken,
  },
  rule: {
    height: PRINT.rule.height,
    marginTop: share(GAP),
    backgroundColor: colors.borderStrong,
  },
  // On a narrow screen, or with large text, the right-hand lines go under
  // the buttons and their counts, still set against the right margin.
  label: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    columnGap: spacing.md,
    marginTop: LABEL_TOP,
  },
  // The outlines start level with the first line; their targets reach up into the paper under the rule.
  buttons: { marginTop: -INSET },
  actions: {
    flexDirection: "row",
    // The heart's outline, not its target, starts at the margin.
    marginLeft: -INSET,
    // Over the counts' targets where the two meet, so a button is always a whole target.
    zIndex: 1,
  },
  button: {
    minWidth: TARGET,
    minHeight: TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  // The counts' targets begin in the empty foot of the buttons' and their
  // words where the buttons' end: the line sits as close under the outlines
  // as the right-hand lines do under one another, and the label stays one
  // block rather than a block with a gap under it.
  counts: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    columnGap: 6,
    marginTop: -INSET,
  },
  count: {
    minWidth: TARGET,
    minHeight: TARGET,
    paddingTop: INSET,
  },
  countText: {
    ...line(PRINT.byline),
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  // Level with the words, which start below the head of their targets.
  dot: { color: colors.inkFaint, paddingTop: INSET },
  // As much paper under the last line as the counts' targets leave under
  // theirs, so the caption starts the same distance below either.
  dateline: {
    flexGrow: 1,
    flexShrink: 1,
    alignItems: "flex-end",
    paddingBottom: TARGET - INSET - line(PRINT.byline).lineHeight,
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
  credit: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: BETWEEN,
  },
  // Full targets that keep the line's own height: the name and the "…"
  // reach above and below it, by as much as `reach` says.
  name: {
    flexShrink: 1,
    minHeight: TARGET,
    justifyContent: "center",
  },
  creditText: { ...line(PRINT.credit), textAlign: "right", color: colors.inkFaint },
  more: {
    // The dots, not their target, end at the margin.
    marginRight: -(TARGET - DOTS * 0.75) / 2,
  },
  // The member's words in the comments' own type, so the text under a picture reads as one.
  caption: {
    ...type.body,
    fontSize: 14,
    color: colors.ink,
  },
  comment: {
    ...type.body,
    fontSize: 14,
    color: colors.ink,
    paddingTop: spacing.xs + 2,
  },
  commenter: { fontWeight: "600" },
});
