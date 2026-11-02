import React, { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { shortDate } from "@/utils/time";
import { PhotoTile } from "./PhotoGrid";
import { EraGather } from "./EraGather";
import { eraMeta, printLabel } from "./eraBook";
import { takeOutMeta, takeOutTitle, type EraSheetView } from "./eraSheet";

/** The thumbnails down the sheet: the photograph being moved, and each era's lead. */
const SUBJECT = 64;
const LEAD = 44;

/** What the sheet can do; each change at most once each time it opens. */
export interface EraSheetActions {
  /** Into the era of `key`. */
  onMove: (key: string) => void;
  /** Out of the era a move put it in, back where it came from. */
  onTakeOut: () => void;
  /** "New era…": the sheet turns to a new era, with this photograph chosen. Not a change in itself. */
  onNewEra: () => void;
  /** These photographs, into the era ADD was for. */
  onAdd: (photoIds: string[]) => void;
  /** A new era of this name, with these photographs. */
  onCreate: (name: string, photoIds: string[]) => void;
  onClose: () => void;
}

/**
 * The sheet a member arranges their eras in, over the Eras page: where a
 * photograph goes (Move to), what is added to an era (ADD), and a new era
 * (NEW ERA, or "New era…" from Move to, which turns the same sheet to it).
 *
 * iOS goes on drawing a sheet while it slides away, so what was on it
 * stays, as it was when it closed, until it has gone, and a tap on the way
 * down changes nothing. Each time it opens it is drawn afresh: nothing
 * chosen, and no name, from the time before.
 *
 * A sheet rather than iOS's action sheet: an action sheet lists words
 * alone, cut to a line, and grows past the screen when a member has many
 * eras. This scrolls, and shows the photographs that tell the eras apart.
 */
export function EraMoveSheet({ view, ...actions }: { view: EraSheetView | null } & EraSheetActions) {
  // Open, it shows what it is given, from the first frame; closing, the
  // last it was given, which it keeps.
  const [kept, setKept] = useState<EraSheetView | null>(null);
  if (view && kept !== view) setKept(view);
  const shown = view ?? kept;
  // Counted each time it opens, so each opening has a body of its own.
  const open = view != null;
  const [round, setRound] = useState({ open, n: 0 });
  if (round.open !== open) setRound({ open, n: open ? round.n + 1 : round.n });

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={actions.onClose}>
      {shown ? <EraSheetBody key={round.n} view={shown} live={open} {...actions} /> : null}
    </Modal>
  );
}

/**
 * What the sheet holds, for the Modal above and for the screen the feed
 * opens (app/era-move.tsx), which is a sheet of its own. `live` is false
 * while it slides away: nothing on it changes anything then.
 */
export function EraSheetBody({
  view,
  live,
  onMove,
  onTakeOut,
  onNewEra,
  onAdd,
  onCreate,
  onClose,
}: { view: EraSheetView; live: boolean } & EraSheetActions) {
  // One change each time it opens, so a second tap on the way down changes nothing.
  const done = useRef(false);
  const once =
    <A extends unknown[]>(act: (...args: A) => void) =>
    (...args: A) => {
      if (!live || done.current) return;
      done.current = true;
      act(...args);
    };

  return (
    <View style={styles.root} onAccessibilityEscape={onClose} testID={view.kind === "move" ? "era-move-sheet" : "era-gather-sheet"}>
      {view.kind === "move" ? (
        <MoveTo
          view={view}
          onChoose={once(onMove)}
          onTakeOut={once(onTakeOut)}
          onNewEra={() => {
            if (live && !done.current) onNewEra();
          }}
          onClose={onClose}
        />
      ) : (
        <EraGather view={view} onAdd={once(onAdd)} onCreate={once(onCreate)} onClose={onClose} />
      )}
    </View>
  );
}

/**
 * Where a photograph goes, chosen from the eras like a chapter from a
 * book's contents.
 *
 * The photograph at the head, then every era by the name it shows, with
 * its newest photograph, the months it runs and how many it holds, so two
 * eras of one place are told apart at a glance. The one the photograph is
 * in is marked and cannot be chosen. An era emptied by earlier moves is
 * still listed, so a photograph can always go back; and one a move put
 * where it is can be taken out again, back where it came from. "New era…"
 * comes last. One choice moves it; the sheet closes, and the page behind
 * already shows it in its new era.
 */
function MoveTo({
  view,
  onChoose,
  onTakeOut,
  onNewEra,
  onClose,
}: {
  view: Extract<EraSheetView, { kind: "move" }>;
  onChoose: (key: string) => void;
  onTakeOut: () => void;
  onNewEra: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const from = view.choices.find((c) => c.here);
  const out = view.out;

  return (
    <>
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
        <View
          style={styles.subject}
          accessible
          accessibilityLabel={from ? `${printLabel(view.post)}. Now in ${from.title}.` : printLabel(view.post)}
        >
          <View pointerEvents="none">
            <PhotoTile post={view.post} size={SUBJECT} onPress={onClose} />
          </View>
          <View style={styles.subjectText}>
            <Text style={styles.subjectWhen}>{shortDate(view.post.taken_at ?? view.post.created_at)}</Text>
            {view.post.caption?.trim() ? (
              <Text style={styles.subjectCaption} numberOfLines={2}>
                {view.post.caption.trim()}
              </Text>
            ) : null}
            {from ? (
              <Text style={styles.subjectFrom} numberOfLines={2}>
                Now in {from.title}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.listRule} />

        {out ? (
          <Pressable
            onPress={onTakeOut}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${takeOutTitle(out)}. ${takeOutMeta(out)}.`}
          >
            <View style={[styles.lead, styles.leadEmpty, styles.mark]}>
              <Feather name="corner-up-left" size={16} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {takeOutTitle(out)}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={2}>
                {takeOutMeta(out)}
              </Text>
            </View>
          </Pressable>
        ) : null}

        {view.choices.map((choice) => {
          if (choice.newEra) {
            return (
              <Pressable
                key={choice.key}
                onPress={onNewEra}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="New era"
                accessibilityHint="Begins a new era with this photograph. You name it next."
              >
                <View style={[styles.lead, styles.leadEmpty, styles.mark]}>
                  <Feather name="plus" size={18} color={colors.accent} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {choice.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={2}>
                    Name it, and choose others to go with it
                  </Text>
                </View>
              </Pressable>
            );
          }
          const lead = choice.era?.posts[0];
          const count = choice.era?.posts.length ?? 0;
          const meta = choice.era ? eraMeta(choice.era) : "No photographs now";
          return (
            <Pressable
              key={choice.key}
              onPress={() => onChoose(choice.key)}
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
    </>
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
  // Where a lead would be, for a line that is not an era: taking it out, or a new one.
  mark: { alignItems: "center", justifyContent: "center", borderColor: colors.borderStrong },
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
