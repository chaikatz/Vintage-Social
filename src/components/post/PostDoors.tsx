import React, { useState } from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { Image } from "expo-image";
import Feather from "@expo/vector-icons/Feather";
import { DISSOLVE } from "@/components/darkroom/plateImage";
import { printSource } from "@/darkroom/printSource";
import { countLabel } from "@/darkroom/labels";
import type { Print } from "@/darkroom/types";
import type { DayDoorFace } from "@/post/dayDoor";
import { colors, spacing, type } from "@/theme";

/**
 * The two doors at the top of the Post tab, side by side, and the shelf
 * under them.
 *
 * The Memory Room's is the invitation card's stock, ruled and lettered in
 * its ink — brown and gold on paper; on black a card a step up, lettered
 * in white — and carries the print the member left off on, with the one
 * beside it, and where that was: "You left off in July 2021." On this
 * day's is the page's paper, ruled in the strong line, and carries this
 * date in earlier years: the photographs of it fanned out with how many
 * and which years, or the member's own post from it, or the leaf of a
 * desk calendar. Each is one tap, named by its eyebrow and marked with a
 * chevron, so neither reads as a heading over nothing.
 *
 * Narrower than 360 points they keep their words and let their pictures
 * and chevrons go. At the larger text sizes they stack, one to a row.
 */

/** The page's type stops growing here, as the Memory Room's own word pages do. */
const TYPE_CAP = 2.4;
/** Capitals in the typewriter's face stop growing sooner. */
const BAR_TYPE_CAP = 1.8;
/** Each door's share of the band: two fit side by side on a 320 pt phone (140 each), and grow to fill it. */
const DOOR_BASIS = 120;

export function PostDoors({
  room,
  day,
  shelf,
  narrow,
  short,
  large,
  pictures,
  reduceMotion,
  held,
  onRoom,
  onDay,
  onShelf,
}: {
  room: { line: string; front: Print | null; back: Print | null } | null;
  day: DayDoorFace;
  shelf: number;
  narrow: boolean;
  /** A phone under 700 points tall. */
  short: boolean;
  large: boolean;
  /** The library's photographs may be drawn. */
  pictures: boolean;
  reduceMotion: boolean;
  held: boolean;
  onRoom: () => void;
  onDay: () => void;
  onShelf: () => void;
}) {
  const pad = short ? spacing.sm : spacing.md;
  const showShelf = room != null && shelf > 0;
  return (
    <View>
      <View style={[styles.band, { paddingTop: pad, paddingBottom: showShelf ? 0 : pad }]}>
        {room ? (
          <MemoryRoomDoor
            line={room.line}
            front={pictures ? room.front : null}
            back={pictures ? room.back : null}
            narrow={narrow}
            short={short}
            large={large}
            reduceMotion={reduceMotion}
            held={held}
            onPress={onRoom}
          />
        ) : null}
        <OnThisDayDoor face={day} narrow={narrow} short={short} large={large} pictures={pictures} reduceMotion={reduceMotion} held={held} onPress={onDay} />
      </View>
      {showShelf ? <SetAsideLine n={shelf} held={held} onPress={onShelf} /> : null}
    </View>
  );
}

function doorBox(narrow: boolean, short: boolean, large: boolean) {
  return {
    flexBasis: large ? ("100%" as const) : DOOR_BASIS,
    minHeight: narrow || short ? 70 : 78,
  };
}

export function MemoryRoomDoor({
  line,
  front,
  back,
  narrow,
  short,
  large,
  reduceMotion,
  held,
  onPress,
}: {
  line: string;
  front: Print | null;
  back: Print | null;
  narrow: boolean;
  short: boolean;
  large: boolean;
  reduceMotion: boolean;
  held: boolean;
  onPress: () => void;
}) {
  const picture = !narrow && front != null;
  return (
    <Pressable
      testID="post-door-room"
      onPress={onPress}
      disabled={held}
      style={({ pressed }) => [styles.door, styles.room, doorBox(narrow, short, large), pressed && styles.roomPressed]}
      accessibilityRole="button"
      accessibilityLabel={`The Memory Room. ${line}`}
      accessibilityHint="Opens your photographs, one at a time, from further back."
      accessibilityState={{ disabled: held }}
    >
      <Text style={[styles.eyebrow, styles.roomEyebrow, !narrow && styles.eyebrowBeside]} maxFontSizeMultiplier={BAR_TYPE_CAP}>
        The Memory Room
      </Text>
      {narrow ? null : <Feather name="chevron-right" size={13} color={colors.gold} style={styles.chevron} />}
      <View style={[styles.row, !narrow && styles.rowPictured]}>
        {picture ? <Stack front={front} back={back} reduceMotion={reduceMotion} /> : null}
        <Text style={[styles.line, styles.roomLine, narrow && styles.lineNarrow]} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
          {line}
        </Text>
      </View>
    </Pressable>
  );
}

/** Two prints, the front one tipped left over the back one tipped right, each with a paper edge. */
function Stack({ front, back, reduceMotion }: { front: Print; back: Print | null; reduceMotion: boolean }) {
  const lifted = useColorScheme() !== "dark";
  return (
    <View style={styles.stack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      {back ? (
        <View style={[styles.stackPrint, styles.stackBack, lifted && styles.stackShadow]}>
          <Cover print={back} reduceMotion={reduceMotion} />
        </View>
      ) : null}
      <View style={[styles.stackPrint, styles.stackFront, lifted && styles.stackShadow]}>
        <Cover print={front} reduceMotion={reduceMotion} />
      </View>
    </View>
  );
}

/** A door's print: the library's photograph at its little size, kept by this view alone. */
function Cover({ print, reduceMotion }: { print: Print; reduceMotion: boolean }) {
  const [transition] = useState(() => (reduceMotion ? 0 : DISSOLVE));
  return (
    <Image
      source={printSource(print.uri)}
      style={styles.fill}
      contentFit="cover"
      cachePolicy="none"
      allowDownscaling={false}
      priority="normal"
      recyclingKey={print.id}
      transition={transition}
      accessibilityIgnoresInvertColors
    />
  );
}

export function OnThisDayDoor({
  face,
  narrow,
  short,
  large,
  pictures,
  reduceMotion,
  held,
  onPress,
}: {
  face: DayDoorFace;
  narrow: boolean;
  short: boolean;
  large: boolean;
  pictures: boolean;
  reduceMotion: boolean;
  held: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID="post-door-day"
      onPress={onPress}
      disabled={held}
      style={({ pressed }) => [styles.door, styles.day, doorBox(narrow, short, large), pressed && styles.dayPressed]}
      accessibilityRole="button"
      accessibilityLabel={face.spoken}
      accessibilityHint="Opens what you posted and photographed on this date in other years."
      accessibilityState={{ disabled: held }}
    >
      <Text style={[styles.eyebrow, styles.dayEyebrow, !narrow && styles.eyebrowBeside]} maxFontSizeMultiplier={BAR_TYPE_CAP}>
        On this day
      </Text>
      {narrow ? null : <Feather name="chevron-right" size={13} color={colors.inkFaint} style={styles.chevron} />}
      <View style={[styles.row, !narrow && styles.rowPictured]}>
        {narrow ? null : <DayPicture face={face} pictures={pictures} reduceMotion={reduceMotion} />}
        <View style={styles.words}>
          <Text style={[styles.line, styles.dayLine, narrow && styles.lineNarrow]} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
            {face.line}
          </Text>
          {face.sub ? (
            <Text style={styles.sub} maxFontSizeMultiplier={BAR_TYPE_CAP}>
              {face.sub}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/** The fan of this date's photographs, the member's own post from it, or the leaf of a calendar. */
function DayPicture({ face, pictures, reduceMotion }: { face: DayDoorFace; pictures: boolean; reduceMotion: boolean }) {
  const lifted = useColorScheme() !== "dark";
  if (face.kind === "fan" && pictures && face.covers.length > 0) {
    return (
      <View style={styles.fan} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
        {face.covers.map((print, i) => (
          <View key={print.id} style={[styles.fanPrint, FAN[i] ?? FAN[FAN.length - 1], lifted && styles.fanShadow]}>
            <Cover print={print} reduceMotion={reduceMotion} />
          </View>
        ))}
      </View>
    );
  }
  if (face.kind === "post" && face.memory?.source != null) {
    return (
      <View style={styles.postPrint} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
        <Image
          source={face.memory.source}
          style={[styles.fill, face.memory.filter ? ({ filter: face.memory.filter } as object) : null]}
          contentFit="cover"
          transition={200}
          recyclingKey={face.memory.id}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }
  return (
    <View style={styles.leaf} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <Text style={styles.leafMonth} maxFontSizeMultiplier={1}>
        {face.leafMonth}
      </Text>
      <Text style={styles.leafDay} maxFontSizeMultiplier={1}>
        {face.leafDay}
      </Text>
    </View>
  );
}

/** Where each of the fan's three prints lies, oldest first. */
const FAN = [
  { left: 0, top: 4, transform: [{ rotate: "-8deg" }] },
  { left: 10, top: 2, transform: [{ rotate: "-1deg" }] },
  { left: 20, top: 3, transform: [{ rotate: "7deg" }] },
];

/** SET ASIDE · 3, under the doors, when anything is set aside: one tap to the shelf. */
export function SetAsideLine({ n, held, onPress }: { n: number; held: boolean; onPress: () => void }) {
  return (
    <View style={styles.shelfRow}>
      <Pressable
        testID="post-shelf"
        onPress={onPress}
        disabled={held}
        hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
        style={({ pressed }) => [styles.shelf, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Set aside, ${n} ${n === 1 ? "photograph" : "photographs"}`}
        accessibilityHint="Opens the photographs you set aside."
        accessibilityState={{ disabled: held }}
      >
        <Text style={styles.shelfWord} maxFontSizeMultiplier={BAR_TYPE_CAP}>
          Set aside · {countLabel(n)}
        </Text>
        <Feather name="arrow-right" size={12} color={colors.inkSoft} />
      </Pressable>
    </View>
  );
}

const caps = { textTransform: "uppercase" as const };

const styles = StyleSheet.create({
  band: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.lg },
  door: {
    flexGrow: 1,
    paddingTop: 9,
    paddingHorizontal: 10,
    paddingBottom: 10,
    justifyContent: "space-between",
    borderWidth: 1,
  },
  room: { backgroundColor: colors.card, borderColor: colors.goldSoft },
  roomPressed: { backgroundColor: colors.cardDeep },
  day: { backgroundColor: colors.paper, borderColor: colors.borderStrong },
  dayPressed: { backgroundColor: colors.paperSunken },
  eyebrow: { fontFamily: type.mono, fontSize: 9.5, lineHeight: 12, letterSpacing: 1.5, ...caps },
  // Clear of the chevron in the corner.
  eyebrowBeside: { paddingRight: 16 },
  roomEyebrow: { color: colors.gold },
  dayEyebrow: { color: colors.inkSoft },
  chevron: { position: "absolute", top: 8, right: 9 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: spacing.sm },
  // As tall as the tallest picture, so a door is the same height with one or without, and nothing under it moves when one comes.
  rowPictured: { minHeight: 42 },
  words: { flex: 1, minWidth: 0 },
  line: { fontFamily: type.serif, fontSize: 13.5, lineHeight: 17 },
  lineNarrow: { fontSize: 13, lineHeight: 16 },
  roomLine: { flex: 1, minWidth: 0, color: colors.gold },
  dayLine: { color: colors.ink },
  sub: { fontFamily: type.mono, fontSize: 9.5, letterSpacing: 1.2, ...caps, color: colors.inkSoft, marginTop: 3 },
  fill: { ...StyleSheet.absoluteFillObject },

  stack: { width: 38, height: 42 },
  stackPrint: {
    position: "absolute",
    width: 31,
    height: 39,
    borderWidth: 2,
    borderColor: colors.onCamera,
    backgroundColor: colors.paperSunken,
  },
  stackFront: { left: 0, top: 2, transform: [{ rotate: "-4deg" }] },
  stackBack: { left: 6, top: 1, opacity: 0.9, transform: [{ rotate: "7deg" }] },
  stackShadow: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, shadowOpacity: 0.35 },

  fan: { width: 50, height: 42 },
  fanPrint: {
    position: "absolute",
    width: 29,
    height: 36,
    borderWidth: 2,
    borderColor: colors.paperRaised,
    backgroundColor: colors.paperSunken,
  },
  fanShadow: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, shadowOpacity: 0.28 },
  postPrint: { width: 29, height: 36, backgroundColor: colors.paperSunken },
  leaf: {
    width: 34,
    height: 40,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  leafMonth: { fontFamily: type.mono, fontSize: 7.5, letterSpacing: 1, color: colors.accent },
  leafDay: { fontFamily: type.serif, fontSize: 17, lineHeight: 18, color: colors.ink, marginTop: 1 },

  shelfRow: { height: 32, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center" },
  shelf: { flexDirection: "row", alignItems: "center", gap: 6 },
  shelfWord: { fontFamily: type.mono, fontSize: 10.5, letterSpacing: 2.2, ...caps, color: colors.inkSoft },
  pressed: { opacity: 0.6 },
});
