import React, { useEffect, useRef } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { YearCount } from "@/darkroom/discovery";
import { countLabel, monthDay, monthName } from "@/darkroom/labels";
import type { DarkroomMode } from "@/darkroom/types";
import type { Where } from "./chapter";
import { useLook } from "./look";
import { room } from "./room";
import { RoomText, Rule } from "./Type";
import { Word } from "./Word";
import { dayFolio, LOOKING, photographs, type DayState } from "./words";

/** At this type size a folio goes under its title rather than beside it. Rows only ever grow. */
const STACK_AT = 1.6;
/** The current line opens this far below the top of the sheet. */
const OPEN_OFFSET = 96;

/**
 * The Contents sheet, set like the front of a photobook: the three ways
 * in, each with its folio set right on the same baseline, then the years
 * the library holds, oldest first, the way an archive reads forward —
 * and under the year that is open, its twelve months. A short gold
 * ribbon hangs in the margin beside where you are. No dot leaders, no
 * decades, no thumbnails.
 *
 * It is the one place the chapter changes. Every choice closes the sheet
 * first; whatever pushes a screen or opens a picker waits for the sheet
 * to have gone (`onDismiss`), since a screen pushed under an open sheet
 * would be hidden behind it. The footer says, every time, that all of it
 * is read on this iPhone.
 */
export function Contents({
  visible,
  now,
  where,
  years,
  months,
  monthInView,
  day,
  shelfCount,
  prunedNote,
  limited,
  toMonths,
  onChoose,
  onLibrary,
  onShareMore,
  onSettings,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  now: number;
  where: Where | null;
  /** Oldest first; null until the year index has been read. */
  years: readonly YearCount[] | null;
  /** The open year's month counts. */
  months: { year: number; counts: number[] } | null;
  /** The month of the print in front of the member, in a year chapter. */
  monthInView: number | null;
  day: DayState;
  shelfCount: number;
  prunedNote: string | null;
  limited: boolean;
  /** Opened from the caption thread in a year: open at the month strip. */
  toMonths: boolean;
  onChoose: (mode: DarkroomMode, year?: number | null, month?: number | null) => void;
  onLibrary: () => void;
  onShareMore: () => void;
  onSettings: () => void;
  onClose: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACK_AT;
  const scroll = useRef<ScrollView>(null);
  const placed = useRef(false);
  useEffect(() => {
    if (!visible) placed.current = false;
  }, [visible]);

  /** The sheet opens scrolled so where you are is in view. */
  const here = (e: LayoutChangeEvent) => {
    if (placed.current) return;
    placed.current = true;
    scroll.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - OPEN_OFFSET), animated: false });
  };

  const openYear = where?.mode === "year" ? where.year : null;
  const nothingToday = day === "none";
  const cell = Math.floor((width - 48) / 6);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <View style={styles.root} onAccessibilityEscape={onClose} testID="darkroom-contents-sheet">
        <View style={styles.head}>
          <RoomText kind="eyebrow" accessibilityRole="header" maxFontSizeMultiplier={2.4}>
            Contents
          </RoomText>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.done, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Close the contents"
            testID="darkroom-contents-done"
          >
            <RoomText kind="eyebrow" tone="soft" maxFontSizeMultiplier={2.4}>
              Done
            </RoomText>
          </Pressable>
        </View>
        <View style={styles.headRule} />

        <ScrollView ref={scroll} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
          <Line
            title="On this day"
            folio={dayFolio(day, now)}
            current={where?.mode === "on-this-day"}
            disabled={nothingToday}
            stacked={stacked}
            label={nothingToday ? "On this day, nothing today" : `On this day, ${monthDay(now)}`}
            onPress={() => onChoose("on-this-day")}
            onPlaced={where?.mode === "on-this-day" ? here : undefined}
          />
          <Line
            title="Surprise me"
            folio="Any year"
            current={where?.mode === "surprise"}
            stacked={stacked}
            label="Surprise me, any year"
            onPress={() => onChoose("surprise")}
            onPlaced={where?.mode === "surprise" ? here : undefined}
          />
          {shelfCount > 0 ? (
            <Line
              title="Set aside"
              folio={countLabel(shelfCount)}
              current={where?.mode === "set-aside"}
              stacked={stacked}
              label={`Set aside, ${photographs(shelfCount)}`}
              onPress={() => onChoose("set-aside")}
              onPlaced={where?.mode === "set-aside" ? here : undefined}
            />
          ) : null}
          {prunedNote ? (
            <RoomText kind="foot" maxFontSizeMultiplier={2.4} style={styles.pruned}>
              {prunedNote}
            </RoomText>
          ) : null}

          <View style={styles.section}>
            <RoomText kind="eyebrow" maxFontSizeMultiplier={2.4}>
              By year
            </RoomText>
            <View style={styles.sectionRule} />
          </View>
          {years == null ? (
            <RoomText kind="foot" maxFontSizeMultiplier={2.4} style={styles.looking}>
              {LOOKING}
            </RoomText>
          ) : (
            years.map((y) => {
              const isOpen = openYear === y.year;
              const strip = isOpen && months?.year === y.year ? months.counts : null;
              return (
                <React.Fragment key={y.year}>
                  <Line
                    title={String(y.year)}
                    folio={countLabel(y.count)}
                    year
                    current={isOpen}
                    stacked={stacked}
                    label={`${y.year}, ${photographs(y.count)}`}
                    onPress={() => onChoose("year", y.year)}
                    onPlaced={isOpen && !toMonths ? here : undefined}
                  />
                  {strip ? (
                    <View style={styles.months} onLayout={toMonths ? here : undefined}>
                      {strip.map((count, m) => (
                        <Month
                          key={m}
                          month={m}
                          year={y.year}
                          count={count}
                          inView={monthInView === m}
                          width={cell}
                          onPress={() => onChoose("year", y.year, m)}
                        />
                      ))}
                    </View>
                  ) : null}
                </React.Fragment>
              );
            })
          )}

          <View style={styles.foot}>
            <Word label="Choose from your whole library" onPress={onLibrary} testID="darkroom-contents-library" />
            {limited ? (
              <>
                <RoomText kind="foot" maxFontSizeMultiplier={2.4} style={styles.center}>
                  VINTAGE can see only the photographs you’ve shared with it.
                </RoomText>
                <View style={styles.footRow}>
                  <Word label="Share more" onPress={onShareMore} />
                  <Word label="Allow all in Settings" onPress={onSettings} />
                </View>
              </>
            ) : null}
            <RoomText kind="foot" maxFontSizeMultiplier={2.4} style={styles.center}>
              Everything here is read on this iPhone. Nothing is sent.
            </RoomText>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A line of the contents: the title, the folio on its baseline, and the ribbon beside where you are. */
function Line({
  title,
  folio,
  current,
  disabled = false,
  stacked,
  year = false,
  label,
  onPress,
  onPlaced,
}: {
  title: string;
  folio: string;
  current: boolean;
  disabled?: boolean;
  stacked: boolean;
  year?: boolean;
  label: string;
  onPress: () => void;
  onPlaced?: (e: LayoutChangeEvent) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onLayout={onPlaced}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: current, disabled }}
      testID={`darkroom-contents-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <View style={[styles.ribbon, { backgroundColor: current ? room.gold : "transparent" }]} accessible={false} />
      <View style={stacked ? styles.lineStacked : styles.lineRow}>
        <RoomText kind={year ? "contentsYear" : "contentsLine"} tone={disabled ? "faint" : "ink"} maxFontSizeMultiplier={2.4} style={styles.title}>
          {title}
        </RoomText>
        <RoomText kind={year ? "count" : "folio"} maxFontSizeMultiplier={2.4} style={stacked ? styles.folioUnder : null}>
          {folio}
        </RoomText>
      </View>
    </Pressable>
  );
}

/** One month of the open year: its initials, dimmed and closed when the month has no photographs. */
function Month({
  month,
  year,
  count,
  inView,
  width,
  onPress,
}: {
  month: number;
  year: number;
  count: number;
  inView: boolean;
  width: number;
  onPress: () => void;
}) {
  const look = useLook();
  const empty = count === 0;
  const name = `${monthName(month)} ${year}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={empty}
      style={({ pressed }) => [styles.month, { width }, empty && styles.monthEmpty, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={empty ? `${name}, no photographs` : name}
      accessibilityState={{ disabled: empty, selected: inView }}
      testID={`darkroom-month-${month}`}
    >
      <RoomText kind="month" tone={empty ? "faint" : "soft"} maxFontSizeMultiplier={2.4}>
        {monthName(month).slice(0, 3)}
      </RoomText>
      <Rule width={14} color={room.gold} style={[styles.monthRule, { opacity: inView ? (look.contrast ? 1 : 0.8) : 0 }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: room.well },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 18, paddingHorizontal: 24, minHeight: 62 },
  done: { minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" },
  headRule: { height: 1, backgroundColor: room.lineStrong, marginHorizontal: 24 },
  scroll: { paddingHorizontal: 24, paddingTop: 14 },
  line: { flexDirection: "row", alignItems: "center", minHeight: 52, marginLeft: -20 },
  ribbon: { width: 12, height: 1, marginRight: 8 },
  lineRow: { flex: 1, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  lineStacked: { flex: 1, paddingVertical: 8 },
  title: { flexShrink: 1, marginRight: 12 },
  folioUnder: { marginTop: 4 },
  pruned: { marginTop: -6, marginBottom: 6 },
  section: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 32, marginBottom: 6 },
  sectionRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: room.lineStrong },
  looking: { marginTop: 10 },
  months: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  month: { height: 44, alignItems: "center", justifyContent: "center" },
  monthEmpty: { opacity: 0.4 },
  monthRule: { marginTop: 4 },
  pressed: { opacity: 0.6 },
  foot: { marginTop: 36, alignItems: "center", gap: 10 },
  footRow: { flexDirection: "row", gap: 16 },
  center: { textAlign: "center" },
});
