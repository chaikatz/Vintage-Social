import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useLook } from "./look";
import { RoomText } from "./Type";
import { CHAPTER_HINT, CONTENTS_HINT, CONTENTS_INVITE } from "./words";

/**
 * The running head, as a book has one: back at the left, the chapter's
 * name centred, CONTENTS at the right. It sits outside the pager, so it
 * never slides with the prints, and it is always there: a tap on the
 * photograph turns the page and leaves the words alone. The chapter's
 * name is itself a way into Contents. There is no hairline under it.
 *
 * CONTENTS is plainly a control: an open book and the word, in the full
 * ink, in a tab ruled round in the print's firm line, its press 44 pt
 * tall. Until Contents has first been opened on this phone (`invite`) the
 * tab is ruled in the accent, and a line in the italic hangs under it at
 * the right saying what is inside; a tap on that line opens Contents too.
 * The first opening puts the line away for good, and the stage takes
 * back its room. The line is for the eye: VoiceOver hears the same from
 * CONTENTS itself, as its hint.
 */
export function RunningHead({
  top,
  name,
  contents,
  invite = false,
  held = false,
  onBack,
  onContents,
}: {
  /** The safe-area inset it sits under. */
  top: number;
  /** The chapter's name, or nothing on the pages before there is one. */
  name: string | null;
  /** CONTENTS is offered (there is a library to choose from). */
  contents: boolean;
  /** Contents has not yet been opened on this phone: the tab says so, and what is in it. */
  invite?: boolean;
  /** A develop is under way: CONTENTS and the chapter name wait, and say so. */
  held?: boolean;
  onBack: () => void;
  onContents: () => void;
}) {
  const { room, contrast } = useLook();
  const edge = invite ? room.accent : contrast ? room.soft : room.lineFirm;
  return (
    <View style={[styles.head, { paddingTop: top }]} pointerEvents="box-none">
      <View style={styles.row} pointerEvents="box-none">
        <View style={styles.side}>
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="darkroom-back"
          >
            <Feather name="chevron-left" size={24} color={room.ink} />
          </Pressable>
        </View>
        {name ? (
          <Pressable
            onPress={contents && !held ? onContents : undefined}
            disabled={!contents || held}
            style={({ pressed }) => [styles.chapter, held && styles.held, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Chapter, ${name}`}
            accessibilityHint={contents && !held ? CHAPTER_HINT : undefined}
            accessibilityState={{ disabled: !contents || held }}
            testID="darkroom-chapter"
          >
            <RoomText kind="head" numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {name}
            </RoomText>
          </Pressable>
        ) : null}
        <View style={[styles.side, styles.right]}>
          {contents ? (
            <Pressable
              onPress={onContents}
              disabled={held}
              hitSlop={{ left: 6, right: 4 }}
              style={({ pressed }) => [styles.contents, held && styles.held, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Contents"
              accessibilityHint={held ? undefined : CONTENTS_HINT}
              accessibilityState={{ disabled: held }}
              testID="darkroom-contents"
            >
              <View style={[styles.tab, { borderColor: edge }]} testID="darkroom-contents-tab">
                <Feather name="book-open" size={14} color={room.ink} accessible={false} />
                <RoomText kind="tab" numberOfLines={1} maxFontSizeMultiplier={1.15}>
                  Contents
                </RoomText>
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>
      {contents && invite ? (
        <Pressable
          onPress={onContents}
          disabled={held}
          style={({ pressed }) => [styles.invite, held && styles.held, pressed && styles.pressed]}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="darkroom-contents-invite"
        >
          <RoomText kind="foot" maxFontSizeMultiplier={1.3} style={styles.inviteLine}>
            {CONTENTS_INVITE}
          </RoomText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 4, zIndex: 2 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  side: { flex: 1, flexDirection: "row", alignItems: "center" },
  right: { justifyContent: "flex-end" },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  chapter: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center", maxWidth: 220 },
  // The press is 44 tall; the tab inside it is drawn at 30, its right
  // edge on the page's 16 pt gutter (4 of padding, 12 here).
  contents: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingRight: 12 },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 8,
    borderWidth: 1,
  },
  // Under the tab, its right edge on the same gutter.
  invite: { alignSelf: "flex-end", paddingRight: 12, paddingLeft: 24, paddingBottom: 4, marginTop: -4 },
  inviteLine: { textAlign: "right" },
  pressed: { opacity: 0.6 },
  held: { opacity: 0.4 },
});
