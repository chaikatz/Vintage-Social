import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, PixelRatio } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { countLabel, MONTH_INITIALS, shortDay } from "@/darkroom/labels";
import { printSource } from "@/darkroom/printSource";
import type { YearCount } from "@/darkroom/discovery";
import type { DarkroomMode } from "@/darkroom/types";
import type { SetAsidePrint } from "@/darkroom/setAside";
import { room, roomType, untrack } from "./room";
import { Word } from "./Word";

/**
 * The Darkroom's contents page, set like the front of a photography book:
 * the chapters with dot leaders running to their folios, then the years
 * the library holds, oldest first, in the serif — the way an archive reads
 * forward — and, under the year that is open, its months. A gold rule
 * hangs in the margin beside where you are, like a ribbon.
 *
 * It is the one place the way in changes. Everything on it is read on
 * this phone.
 */
export function Contents({
  visible,
  now,
  mode,
  year,
  years,
  months,
  dayHasPhotographs,
  setAside,
  limited,
  onChoose,
  onMonth,
  onLibrary,
  onChooseMore,
  onSettings,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  now: number;
  mode: DarkroomMode;
  year: number | null;
  years: readonly YearCount[];
  /** The open year's twelve month counts, once known. */
  months: number[] | null;
  /** Null while unknown. */
  dayHasPhotographs: boolean | null;
  setAside: readonly SetAsidePrint[];
  limited: boolean;
  onChoose: (mode: DarkroomMode, year?: number | null) => void;
  onMonth: (month: number) => void;
  onLibrary: () => void;
  onChooseMore: () => void;
  onSettings: () => void;
  onClose: () => void;
  /** After the sheet has gone — where a choice that pushes a screen is acted on. */
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const large = PixelRatio.getFontScale() >= 1.6;
  const decades = new Set(years.map((y) => Math.floor(y.year / 10)));
  const span = years.length > 0 ? `${years[0].year} TO ${years[years.length - 1].year}` : "ANY YEAR";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onDismiss}>
      <View style={styles.root}>
        <View style={styles.head}>
          <Text style={roomType.eyebrow} accessibilityRole="header">
            Contents
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close the contents" style={styles.doneHit}>
            <Text style={[roomType.eyebrow, styles.done]}>Done</Text>
          </Pressable>
        </View>
        <View style={styles.headRule} />

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
          <Line
            title="On this day"
            folio={dayHasPhotographs === false ? "NOTHING TODAY" : shortDay(now)}
            current={mode === "on-this-day"}
            disabled={dayHasPhotographs === false}
            large={large}
            onPress={() => onChoose("on-this-day")}
          />
          <Line title="Surprise me" folio={span} current={mode === "surprise"} large={large} onPress={() => onChoose("surprise")} />
          {setAside.length > 0 ? (
            <>
              <Line
                title="Set aside"
                folio={countLabel(setAside.length)}
                current={mode === "set-aside"}
                large={large}
                onPress={() => onChoose("set-aside")}
              />
              <View style={styles.shelf} accessible={false}>
                {setAside.slice(0, 5).map((p) => (
                  <Image
                    key={p.id}
                    source={printSource(p.uri)}
                    style={styles.shelfPrint}
                    contentFit="cover"
                    cachePolicy="memory"
                    recyclingKey={p.id}
                    accessibilityIgnoresInvertColors
                  />
                ))}
              </View>
            </>
          ) : null}

          {years.length > 0 ? (
            <>
              <View style={styles.section}>
                <Text style={roomType.eyebrow}>By year</Text>
                <View style={styles.sectionRule} />
              </View>
              {years.map((y, i) => {
                const decadeStarts = decades.size > 1 && (i === 0 || Math.floor(years[i - 1].year / 10) !== Math.floor(y.year / 10));
                const open = mode === "year" && year === y.year;
                return (
                  <View key={y.year}>
                    {decadeStarts ? <Text style={styles.decade}>The {Math.floor(y.year / 10) * 10}s</Text> : null}
                    <Line
                      title={String(y.year)}
                      folio={countLabel(y.count)}
                      current={open}
                      large={large}
                      year
                      accessibilityLabel={`${y.year}, ${countLabel(y.count)} photographs`}
                      onPress={() => onChoose("year", y.year)}
                    />
                    {open && months ? (
                      <View style={styles.months}>
                        {MONTH_INITIALS.map((m, mi) => {
                          const empty = (months[mi] ?? 0) === 0;
                          return (
                            <Pressable
                              key={m}
                              disabled={empty}
                              onPress={() => onMonth(mi)}
                              style={({ pressed }) => [styles.month, pressed && styles.pressed]}
                              accessibilityRole="button"
                              accessibilityLabel={`${m} ${y.year}`}
                              accessibilityState={{ disabled: empty }}
                            >
                              <Text style={[styles.monthText, untrack(1.6), empty && styles.monthEmpty]}>{m}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : null}

          <View style={styles.foot}>
            <Word label="Choose from your whole library" dim onPress={onLibrary} accessibilityHint="The ordinary photo picker." />
            {limited ? (
              <>
                <Text style={styles.footNote}>VINTAGE can see only the photographs you’ve shared with it.</Text>
                <View style={styles.footRow}>
                  <Word label="Share more" dim onPress={onChooseMore} />
                  <Word label="Allow all in Settings" dim onPress={onSettings} />
                </View>
              </>
            ) : null}
            <Text style={styles.footNote}>Everything here is read on this iPhone. Nothing is sent.</Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A line of the contents: the title, a dot leader, the folio; a gold ribbon beside where you are. */
function Line({
  title,
  folio,
  current,
  disabled = false,
  large,
  year = false,
  accessibilityLabel,
  onPress,
}: {
  title: string;
  folio: string;
  current: boolean;
  disabled?: boolean;
  large: boolean;
  year?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${title}, ${folio}`}
      accessibilityState={{ selected: current, disabled }}
    >
      <View style={[styles.ribbon, { backgroundColor: current ? room.gold : "transparent" }]} />
      <View style={large ? styles.lineStacked : styles.lineRow}>
        <Text style={[year ? styles.yearTitle : styles.title, disabled && styles.titleDisabled]} maxFontSizeMultiplier={2.4}>
          {title}
        </Text>
        {large ? null : (
          <Text style={styles.leader} numberOfLines={1} ellipsizeMode="clip" accessible={false}>
            {" . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . ."}
          </Text>
        )}
        <Text style={styles.folio} maxFontSizeMultiplier={1.6}>
          {folio}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: room.page },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingTop: 18, paddingBottom: 12 },
  doneHit: { minHeight: 44, justifyContent: "center" },
  done: { color: room.soft },
  headRule: { height: 1, backgroundColor: room.lineStrong, marginHorizontal: 24 },
  scroll: { paddingHorizontal: 24, paddingTop: 14 },
  line: { flexDirection: "row", alignItems: "center", minHeight: 52, marginLeft: -20, paddingLeft: 0 },
  ribbon: { width: 12, height: 1, marginRight: 8 },
  lineRow: { flex: 1, flexDirection: "row", alignItems: "baseline" },
  lineStacked: { flex: 1, paddingVertical: 8 },
  title: { fontFamily: roomType.serif, fontSize: 21, lineHeight: 28, color: room.ink },
  yearTitle: { fontFamily: roomType.serif, fontSize: 21, lineHeight: 28, color: room.ink, fontVariant: ["oldstyle-nums"] },
  titleDisabled: { color: room.faint },
  leader: { flex: 1, fontFamily: roomType.mono, fontSize: 11, color: room.lineStrong, marginHorizontal: 6, overflow: "hidden" },
  folio: { fontFamily: roomType.mono, fontSize: 10, letterSpacing: 1.6, color: room.faint, textTransform: "uppercase" },
  shelf: { flexDirection: "row", gap: 2, marginBottom: 10 },
  shelfPrint: { width: 56, height: 56, backgroundColor: room.sunken },
  section: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 32, marginBottom: 6 },
  sectionRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: room.lineStrong },
  decade: { fontFamily: roomType.serif, fontStyle: "italic", fontSize: 14, lineHeight: 20, color: room.faint, marginTop: 14 },
  months: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  month: { width: "16.66%", minHeight: 44, alignItems: "center", justifyContent: "center" },
  monthText: { fontFamily: roomType.mono, fontSize: 10, color: room.soft },
  monthEmpty: { color: room.faint, opacity: 0.4 },
  pressed: { opacity: 0.6 },
  foot: { marginTop: 36, alignItems: "center", gap: 10 },
  footRow: { flexDirection: "row", gap: 16 },
  footNote: { fontFamily: roomType.serif, fontStyle: "italic", fontSize: 13, lineHeight: 19, color: room.faint, textAlign: "center" },
});
