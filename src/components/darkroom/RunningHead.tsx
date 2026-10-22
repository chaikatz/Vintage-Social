import React from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { room } from "./room";
import { RoomText } from "./Type";
import { CHAPTER_HINT, CONTENTS_HINT } from "./words";

/**
 * The running head, as a book has one: back at the left, the chapter's
 * name centred, CONTENTS at the right. It sits outside the pager, so it
 * never slides with the prints; it fades with the rest of the room's
 * words when a tap hides them, and cannot be pressed while hidden. The
 * chapter's name is itself a way into Contents. There is no hairline
 * under it. The back chevron is the room's only icon.
 */
export function RunningHead({
  top,
  name,
  contents,
  held = false,
  opacity,
  hidden,
  onBack,
  onContents,
}: {
  /** The safe-area inset it sits under. */
  top: number;
  /** The chapter's name, or nothing on the pages before there is one. */
  name: string | null;
  /** CONTENTS is offered (there is a library to choose from). */
  contents: boolean;
  /** A develop is under way: CONTENTS and the chapter name wait, and say so. */
  held?: boolean;
  opacity: Animated.Value;
  hidden: boolean;
  onBack: () => void;
  onContents: () => void;
}) {
  return (
    <Animated.View style={[styles.head, { paddingTop: top, opacity }]} pointerEvents={hidden ? "none" : "box-none"}>
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
            hitSlop={10}
            style={({ pressed }) => [styles.contents, held && styles.held, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Contents"
            accessibilityHint={held ? undefined : CONTENTS_HINT}
            accessibilityState={{ disabled: held }}
            testID="darkroom-contents"
          >
            <RoomText kind="head" maxFontSizeMultiplier={1.3}>
              Contents
            </RoomText>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", minHeight: 44, paddingHorizontal: 4, zIndex: 2 },
  side: { flex: 1, flexDirection: "row", alignItems: "center" },
  right: { justifyContent: "flex-end" },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  chapter: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center", maxWidth: 220 },
  // Its right edge on the page's 16 pt gutter (4 of padding, 12 here).
  contents: { minHeight: 44, justifyContent: "center", paddingRight: 12 },
  pressed: { opacity: 0.6 },
  held: { opacity: 0.4 },
});
