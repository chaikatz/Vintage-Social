import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/theme";
import { clampLocation } from "@/utils/validation";
import { paperStyle, useFeedPaper } from "@/utils/feedPaper";
import { PostMedia } from "../PostMedia";
import { PendingStatus, ProgressRule, usePendingCard, type PendingCardProps, type StatusLook } from "../PendingPostCard";
import { clipMayPlay } from "../pendingCardWords";
import {
  EDGE,
  LABEL_CAP,
  LIKES_LINE,
  NoButtonsYet,
  PRINT,
  PrintCaption,
  PrintLabel,
  PrintMember,
  WORDS,
  line,
  printStyles,
} from "./EditorialPostCard";

/** As the original card's, but Home always hands it the way to a member's page. */
type Props = Omit<PendingCardProps, "onOpenProfile"> & { onOpenProfile: (username: string) => void };

/**
 * Editorial (Preview): a post still on its way up, at the top of Home, set
 * out exactly as the editorial card it is about to become
 * (src/components/feed/EditorialPostCard.tsx), from that card's own
 * pieces and on its own sheet: the member over the print, the picture
 * inside the print's margins at its own shape, the hairline, the label
 * with the place and the date in full, the caption after the member's
 * name. So when the post is up and the feed's row takes the card's place,
 * nothing moves: not the card's top, not the picture, not its height.
 *
 * What is not yet so is left as paper, or says so. The "…" and the like,
 * comment and send buttons are not drawn: their room on the label is
 * empty (NoButtonsYet), so the place and the date stand where they will.
 * The hairline under the picture fills with the accent as the post goes
 * up, and stays where it got to, faint, while it waits or has failed. The
 * line under the label, where your own post's count of likes will be,
 * says what is happening, with Retry and Discard (PendingStatus). The last
 * line, where the post will say when it went up, says who was there, or
 * is left as paper. Nothing on it can be liked, commented on or sent, and
 * nothing reads as posted until the server has it.
 *
 * What it says and does is the original pending card's
 * (src/components/PendingPostCard.tsx, usePendingCard): the same words,
 * the same Retry and Discard behind the same question, the same holds,
 * and the same announcements to VoiceOver.
 */
export function EditorialPendingCard({ pending, active = false, focused = true, onOpenProfile }: Props) {
  const { draft, state } = pending;
  const card = usePendingCard(pending, focused);
  const paper = paperStyle(useFeedPaper());

  // The post as it will be saved: its place held to what the database takes, as the row the feed is handed is.
  const post = useMemo(
    () => ({
      author: draft.author,
      caption: draft.caption.trim(),
      location: clampLocation(draft.location),
      taken_at: draft.takenAt,
      created_at: card.createdAt,
    }),
    [draft.author, draft.caption, draft.location, draft.takenAt, card.createdAt],
  );

  const tagged = draft.tagIds.length;
  const withWhom = tagged === 0 ? null : tagged === 1 ? "With one member" : `With ${tagged} members`;

  return (
    <View style={[printStyles.card, paper]} testID="editorial-pending-card">
      {/* The member, as the card has them; no "…" yet, in a row of the same height. */}
      <View style={printStyles.header}>
        <PrintMember post={post} onOpenProfile={onOpenProfile} />
      </View>

      {/* Not posted yet: held in memory, never written to the image cache on disk. */}
      <View style={printStyles.print}>
        <PostMedia post={card.media} active={active && clipMayPlay(state)} cachePolicy="memory" bare />
      </View>

      {/* The print's hairline, filling as the post goes up. */}
      <ProgressRule fraction={card.fraction} look={RULE} />

      <PrintLabel post={post}>
        <NoButtonsYet />
      </PrintLabel>

      <PendingStatus pending={pending} card={card} focused={focused} look={STATUS} />
      {card.failed && pending.error ? <Text style={styles.reason}>{pending.error}</Text> : null}

      <PrintCaption post={post} onOpenProfile={onOpenProfile} />

      {/* Where the card will say when it went up: who was there, or the paper of that line. */}
      <Text
        maxFontSizeMultiplier={LABEL_CAP}
        style={printStyles.posted}
        numberOfLines={1}
        accessible={withWhom != null}
        importantForAccessibility={withWhom == null ? "no-hide-descendants" : "auto"}
      >
        {withWhom ?? NO_WORDS}
      </Text>
    </View>
  );
}

/** A line's height of nothing: a no-break space in the line's own face. */
const NO_WORDS = "\u00a0";

const styles = StyleSheet.create({
  // The status line's words and its actions, in the label's typewriter face, at the height of the line of likes.
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: spacing.sm,
    minHeight: LIKES_LINE,
    paddingHorizontal: EDGE,
  },
  state: { ...line(PRINT.byline), lineHeight: LIKES_LINE, color: colors.inkSoft },
  stateFailed: { color: colors.ink },
  action: {
    ...line(PRINT.byline),
    lineHeight: LIKES_LINE,
    color: colors.accent,
    textDecorationLine: "underline",
  },
  discard: { color: colors.inkSoft },
  dot: { ...line(PRINT.byline), lineHeight: LIKES_LINE, color: colors.inkFaint },
  // Why it failed, under the line, in the words' size.
  reason: {
    fontSize: WORDS,
    lineHeight: LIKES_LINE,
    color: colors.inkSoft,
    paddingHorizontal: EDGE,
  },
  // The hairline as the card draws it, holding the accent as it fills.
  track: { overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.accent },
  paused: { backgroundColor: colors.inkFaint },
});

// Its words grow with Larger Text as far as the label's and the count's that take its place, so the line keeps
// the count's height at every size the label reaches.
const STATUS: StatusLook = {
  row: styles.row,
  state: styles.state,
  stateFailed: styles.stateFailed,
  action: styles.action,
  discard: styles.discard,
  dot: styles.dot,
  cap: LABEL_CAP,
};

const RULE = { track: [printStyles.rule, styles.track], fill: styles.fill, paused: styles.paused };
