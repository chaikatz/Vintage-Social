import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { shortDate } from "@/utils/time";
import type { MoveChoice } from "@/utils/eraEdits";
import { PhotoTile } from "./PhotoGrid";
import { eraMeta, printLabel } from "./eraBook";
import type { PostRow } from "@/types/db";

/** The thumbnails down the sheet: the photograph being moved, and each era's lead. */
const SUBJECT = 64;
const LEAD = 44;

interface Props {
  /** The photograph being moved; the sheet is open while there is one. */
  post: PostRow | null;
  /** Where it can go, as moveChoices lists them for `post`: the eras in the page's order, the one it is in marked. */
  choices: MoveChoice<PostRow>[];
  /** An era was chosen: once at most, each time the sheet opens. */
  onChoose: (key: string) => void;
  onClose: () => void;
}

/** What the sheet shows: a photograph, and the eras it could go to. */
type Shown = { post: PostRow; choices: MoveChoice<PostRow>[] };

/**
 * Where a photograph goes, chosen from the eras like a chapter from a
 * book's contents.
 *
 * A sheet over the Eras page: the photograph at the head, then every era
 * by the name it shows, with its newest photograph, the months it runs
 * and how many it holds, so two eras of one place are told apart at a
 * glance. The one the photograph is in is marked and cannot be chosen.
 * An era emptied by earlier moves is still listed, last, so a photograph
 * can always go back. One choice moves it; the sheet closes, and the page
 * behind already shows it in its new era.
 *
 * iOS goes on drawing a sheet while it slides away, so the photograph and
 * its eras stay on it, as they were when it closed, until it has gone. A
 * second tap on the way down moves nothing.
 *
 * A sheet rather than iOS's action sheet: an action sheet lists words
 * alone, cut to a line, and grows past the screen when a member has many
 * eras. This scrolls, and shows the photographs that tell the eras apart.
 */
export function EraMoveSheet({ post, choices, onChoose, onClose }: Props) {
  const insets = useSafeAreaInsets();
  // Open, it shows the photograph it is given, from the first frame;
  // closing, the last one it was given, which it keeps.
  const [kept, setKept] = useState<Shown | null>(null);
  if (post && (kept?.post !== post || kept.choices !== choices)) setKept({ post, choices });
  const shown: Shown | null = post ? { post, choices } : kept;
  const from = shown?.choices.find((c) => c.here);

  // One choice each time it opens.
  const chosen = useRef(false);
  useEffect(() => {
    if (post) chosen.current = false;
  }, [post]);
  const choose = (key: string) => {
    if (!post || chosen.current) return;
    chosen.current = true;
    onChoose(key);
  };

  return (
    <Modal visible={post != null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root} onAccessibilityEscape={onClose} testID="era-move-sheet">
        <View style={styles.head}>
          <Text style={styles.eyebrow} accessibilityRole="header">
            Move to
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => pressed && styles.pressed}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            accessibilityHint="Leaves the photograph where it is."
          >
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
        <View style={styles.rule} />

        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
          {shown ? (
            <View
              style={styles.subject}
              accessible
              accessibilityLabel={from ? `${printLabel(shown.post)}. Now in ${from.title}.` : printLabel(shown.post)}
            >
              <View pointerEvents="none">
                <PhotoTile post={shown.post} size={SUBJECT} onPress={onClose} />
              </View>
              <View style={styles.subjectText}>
                <Text style={styles.subjectWhen}>{shortDate(shown.post.taken_at ?? shown.post.created_at)}</Text>
                {shown.post.caption?.trim() ? (
                  <Text style={styles.subjectCaption} numberOfLines={2}>
                    {shown.post.caption.trim()}
                  </Text>
                ) : null}
                {from ? (
                  <Text style={styles.subjectFrom} numberOfLines={2}>
                    Now in {from.title}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}
          <View style={styles.listRule} />

          {(shown?.choices ?? []).map((choice) => {
            const lead = choice.era?.posts[0];
            const count = choice.era?.posts.length ?? 0;
            const meta = choice.era ? eraMeta(choice.era) : "No photographs now";
            return (
              <Pressable
                key={choice.key}
                onPress={() => choose(choice.key)}
                disabled={choice.here}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`${choice.title}, ${count} ${count === 1 ? "photograph" : "photographs"}${choice.here ? ", where it is now" : ""}`}
                accessibilityState={{ disabled: choice.here, selected: choice.here }}
                accessibilityHint={choice.here ? undefined : "Moves the photograph into this era."}
              >
                <View pointerEvents="none" style={[styles.lead, choice.here && styles.faded]}>
                  {lead ? <PhotoTile post={lead} size={LEAD} onPress={onClose} /> : <View style={styles.leadEmpty} />}
                </View>
                <View style={[styles.rowText, choice.here && styles.faded]}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {choice.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={2}>
                    {meta}
                  </Text>
                </View>
                {choice.here ? (
                  <Text style={styles.here}>Here</Text>
                ) : (
                  <Feather name="corner-down-right" size={15} color={colors.inkFaint} />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  eyebrow: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  cancel: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.accent,
  },
  rule: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg },
  pressed: { opacity: 0.6 },

  // The photograph being moved, at the head of the sheet.
  subject: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  subjectText: { flex: 1 },
  subjectWhen: { fontFamily: type.serif, fontSize: 17, lineHeight: 23, color: colors.ink },
  subjectCaption: { ...type.caption, fontSize: 12, lineHeight: 17, marginTop: 2 },
  subjectFrom: {
    marginTop: 6,
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    lineHeight: 14,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },

  listRule: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  // An era, as a line of the contents.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  lead: { width: LEAD, height: LEAD },
  leadEmpty: { width: LEAD, height: LEAD, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: type.serif, fontSize: 17, lineHeight: 22, color: colors.ink },
  rowMeta: {
    marginTop: 3,
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    lineHeight: 13,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  faded: { opacity: 0.45 },
  here: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
});
