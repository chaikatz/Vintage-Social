import React, { useEffect, useRef } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { YearCount } from "@/darkroom/discovery";
import { countLabel, monthDay, monthName } from "@/darkroom/labels";
import { spanKey, type OccasionsView } from "@/darkroom/occasions";
import { printSource } from "@/darkroom/printSource";
import type { DarkroomMode, Print, Span } from "@/darkroom/types";
import type { Where } from "./chapter";
import { useLook } from "./look";
import { RoomText, Rule } from "./Type";
import { Word } from "./Word";
import {
  CONTENTS_BY_YEAR,
  CONTENTS_LATELY,
  CONTENTS_NEWEST,
  CONTENTS_OCCASIONS,
  CONTENTS_ORDER,
  CONTENTS_WAYS_IN,
  dayFolio,
  dayYearLabel,
  EARLIER_OCCASIONS,
  LOOKING,
  monthsOf,
  NO_OCCASIONS,
  photographs,
  spanLabel,
  yearsOfDay,
  type DayState,
} from "./words";

/** At this type size a folio goes under its title rather than beside it. Rows only ever grow. */
const STACK_AT = 1.6;
/** The current line opens this far below the top of the sheet. */
const OPEN_OFFSET = 96;
/** The years under On this day, to a row. */
const DAY_YEARS_ACROSS = 4;
/** An occasion's cover, square, beside its line. */
const COVER = 40;

/**
 * The Contents sheet, set like the front of a photobook and read as an
 * index, each part under its own heading: WAYS IN, the three ways in,
 * each with its folio set right on the same baseline, and under On this
 * day the years it holds today, newest first, each with its count;
 * LATELY, this week, last weekend and this month, each with its count;
 * OCCASIONS, newest first, days on end with many photographs, each with
 * a small cover, its dates (or its place) and its count, and EARLIER
 * OCCASIONS at their foot to read further back; BY YEAR, the years the
 * library holds, oldest first, the way an archive reads forward; and
 * under the year that is open, THE MONTHS OF that year. Where you are is
 * marked three ways: a ribbon in the accent hangs in the margin beside
 * its line, its title is set in the accent, and its folio in the soft
 * ink; the month, or the year of the day, of the photograph in front of
 * you is underlined in the accent. VoiceOver hears each heading as a
 * heading, and where you are as selected. No dot leaders and no decades;
 * the only pictures are the occasions' covers, small, each kept by its
 * own view and never in the image memory the app shares. It lies on the
 * raised paper of the print the app is showing.
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
  dayYears,
  yearInView,
  occasions,
  occasionsReading,
  shelfCount,
  prunedNote,
  limited,
  toMonths,
  onChoose,
  onEarlier,
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
  /** The years On this day holds today, newest first, each with its count. */
  dayYears: readonly { year: number; count: number }[] | null;
  /** The year of the print in front of the member, in On this day. */
  yearInView: number | null;
  /** Lately and the occasions, as far as they have been read; null while the first read is under way. */
  occasions: OccasionsView | null;
  /** Earlier occasions are being read. */
  occasionsReading: boolean;
  shelfCount: number;
  prunedNote: string | null;
  limited: boolean;
  /** Opened from the caption thread in a year: open at the month strip. */
  toMonths: boolean;
  onChoose: (mode: DarkroomMode, year?: number | null, month?: number | null, span?: Span | null) => void;
  /** EARLIER OCCASIONS: read on, further back. */
  onEarlier: () => void;
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

  const { room } = useLook();
  const openYear = where?.mode === "year" ? where.year : null;
  const nothingToday = day === "none";
  const cell = Math.floor((width - 48) / 6);
  const yearCell = Math.floor((width - 48) / DAY_YEARS_ACROSS);
  const rule = { backgroundColor: room.lineStrong };
  const hereSpan = where?.mode === "span" && where.span ? spanKey(where.span) : null;
  const lately = occasions?.lately ?? null;
  const found = occasions?.occasions ?? null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <View style={[styles.root, { backgroundColor: room.sheet }]} onAccessibilityEscape={onClose} testID="darkroom-contents-sheet">
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
        <View style={[styles.headRule, rule]} />

        <ScrollView ref={scroll} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
          <Section title={CONTENTS_WAYS_IN} first stacked={stacked} testID="darkroom-contents-ways-in" />
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
          {dayYears && dayYears.length > 0 && !nothingToday ? (
            <View style={styles.monthsBlock} testID="darkroom-day-years">
              <RoomText kind="eyebrow" accessibilityRole="header" maxFontSizeMultiplier={2.4} style={styles.monthsHead}>
                {yearsOfDay(now)}
              </RoomText>
              <View style={styles.months}>
                {dayYears.map((y) => (
                  <DayYear
                    key={y.year}
                    year={y.year}
                    count={y.count}
                    inView={where?.mode === "on-this-day" && yearInView === y.year}
                    width={yearCell}
                    onPress={() => onChoose("on-this-day", y.year)}
                  />
                ))}
              </View>
            </View>
          ) : null}
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

          {lately == null || lately.length > 0 ? (
            <Section title={CONTENTS_LATELY} stacked={stacked} testID="darkroom-contents-lately" />
          ) : null}
          {lately == null ? (
            <RoomText kind="foot" maxFontSizeMultiplier={2.4} style={styles.looking}>
              {LOOKING}
            </RoomText>
          ) : (
            lately.map((span) => (
              <Line
                key={span.kind}
                title={span.title}
                folio={countLabel(span.count)}
                current={hereSpan === spanKey(span)}
                stacked={stacked}
                label={spanLabel(span)}
                onPress={() => onChoose("span", null, null, span)}
                onPlaced={hereSpan === spanKey(span) ? here : undefined}
                testID={`darkroom-contents-${span.kind}`}
              />
            ))
          )}

          <Section title={CONTENTS_OCCASIONS} aside={CONTENTS_NEWEST} stacked={stacked} testID="darkroom-contents-occasions" />
          {found == null ? (
            <RoomText kind="foot" maxFontSizeMultiplier={2.4} style={styles.looking}>
              {LOOKING}
            </RoomText>
          ) : (
            <>
              {found.map((span) => (
                <Line
                  key={spanKey(span)}
                  title={span.title}
                  folio={countLabel(span.count)}
                  cover={span.cover}
                  current={hereSpan === spanKey(span)}
                  stacked={stacked}
                  label={spanLabel(span)}
                  onPress={() => onChoose("span", null, null, span)}
                  onPlaced={hereSpan === spanKey(span) ? here : undefined}
                  testID="darkroom-contents-occasion"
                />
              ))}
              {found.length === 0 && !occasions?.more ? (
                <RoomText kind="foot" maxFontSizeMultiplier={2.4} style={styles.looking}>
                  {NO_OCCASIONS}
                </RoomText>
              ) : null}
              {occasions?.more ? (
                <View style={styles.earlier}>
                  {occasionsReading ? (
                    <RoomText kind="foot" maxFontSizeMultiplier={2.4} accessibilityLiveRegion="polite">
                      {LOOKING}
                    </RoomText>
                  ) : (
                    <Word label={EARLIER_OCCASIONS} onPress={onEarlier} testID="darkroom-contents-earlier" />
                  )}
                </View>
              ) : null}
            </>
          )}

          <Section title={CONTENTS_BY_YEAR} aside={CONTENTS_ORDER} stacked={stacked} testID="darkroom-contents-by-year" />
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
                    <View style={styles.monthsBlock} onLayout={toMonths ? here : undefined}>
                      <RoomText
                        kind="eyebrow"
                        accessibilityRole="header"
                        maxFontSizeMultiplier={2.4}
                        style={styles.monthsHead}
                        testID="darkroom-months-head"
                      >
                        {monthsOf(y.year)}
                      </RoomText>
                      <View style={styles.months}>
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

/**
 * A heading over one part of the contents, as an index sets one: its name
 * in tracked capitals, a rule out to the margin, and, where it says one,
 * the order the part reads in. At the largest type the order goes under
 * the name.
 */
function Section({
  title,
  aside,
  first = false,
  stacked,
  testID,
}: {
  title: string;
  aside?: string;
  first?: boolean;
  stacked: boolean;
  testID?: string;
}) {
  const { room } = useLook();
  return (
    <View
      style={[styles.section, first && styles.sectionFirst]}
      accessible
      accessibilityRole="header"
      accessibilityLabel={aside ? `${title}, ${aside.toLowerCase()}` : title}
      testID={testID}
    >
      <View style={styles.sectionRow}>
        <RoomText kind="eyebrow" maxFontSizeMultiplier={2.4}>
          {title}
        </RoomText>
        <View style={[styles.sectionRule, { backgroundColor: room.lineStrong }]} />
        {aside && !stacked ? (
          <RoomText kind="eyebrow" maxFontSizeMultiplier={2.4}>
            {aside}
          </RoomText>
        ) : null}
      </View>
      {aside && stacked ? (
        <RoomText kind="eyebrow" maxFontSizeMultiplier={2.4} style={styles.asideUnder}>
          {aside}
        </RoomText>
      ) : null}
    </View>
  );
}

/**
 * A line of the contents: the title, the folio on its baseline, and, where
 * you are, the ribbon in the margin, the title in the accent and the folio
 * in the soft ink.
 */
function Line({
  title,
  folio,
  current,
  disabled = false,
  stacked,
  year = false,
  cover,
  label,
  onPress,
  onPlaced,
  testID,
}: {
  title: string;
  folio: string;
  current: boolean;
  disabled?: boolean;
  stacked: boolean;
  year?: boolean;
  /** An occasion's cover, set small before its title. */
  cover?: Print | null;
  label: string;
  onPress: () => void;
  onPlaced?: (e: LayoutChangeEvent) => void;
  testID?: string;
}) {
  const { room } = useLook();
  const coverSource = cover ? printSource(cover.uri) : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onLayout={onPlaced}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: current, disabled }}
      testID={testID ?? `darkroom-contents-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <View
        style={[styles.ribbon, { backgroundColor: current ? room.accent : "transparent" }]}
        accessible={false}
        testID={current ? "darkroom-contents-here" : undefined}
      />
      {cover !== undefined ? (
        <View style={[styles.cover, { backgroundColor: room.well, borderColor: room.line }]} accessible={false}>
          {coverSource != null ? (
            <Image
              source={coverSource}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              // Kept by its view alone, as the library's other small pictures are: never in the memory all images share, never on disk.
              cachePolicy="none"
              recyclingKey={cover?.id}
              transition={0}
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </View>
      ) : null}
      <View style={stacked ? styles.lineStacked : styles.lineRow}>
        <RoomText
          kind={year ? "contentsYear" : "contentsLine"}
          tone={disabled ? "faint" : current ? "accent" : "ink"}
          maxFontSizeMultiplier={2.4}
          style={styles.title}
        >
          {title}
        </RoomText>
        <RoomText
          kind={year ? "count" : "folio"}
          tone={current ? "soft" : undefined}
          maxFontSizeMultiplier={2.4}
          style={stacked ? styles.folioUnder : null}
        >
          {folio}
        </RoomText>
      </View>
    </Pressable>
  );
}

/**
 * One year under On this day: the year, and how many photographs it holds
 * today beneath it; the year in front of you in the accent, underlined.
 */
function DayYear({
  year,
  count,
  inView,
  width,
  onPress,
}: {
  year: number;
  count: number;
  inView: boolean;
  width: number;
  onPress: () => void;
}) {
  const look = useLook();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.dayYear, { width }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={dayYearLabel(year, count)}
      accessibilityState={{ selected: inView }}
      testID={`darkroom-day-year-${year}`}
    >
      <RoomText kind="month" tone={inView ? "accent" : "soft"} maxFontSizeMultiplier={2.4}>
        {String(year)}
      </RoomText>
      <RoomText kind="count" maxFontSizeMultiplier={2.4} style={styles.dayYearCount}>
        {countLabel(count)}
      </RoomText>
      <Rule width={22} color={look.room.accent} style={[styles.monthRule, { opacity: inView ? (look.contrast ? 1 : 0.8) : 0 }]} />
    </Pressable>
  );
}

/**
 * One month of the open year: its initials, dimmed and closed when the
 * month has no photographs; the month in front of you in the accent,
 * underlined.
 */
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
      <RoomText kind="month" tone={empty ? "faint" : inView ? "accent" : "soft"} maxFontSizeMultiplier={2.4}>
        {monthName(month).slice(0, 3)}
      </RoomText>
      <Rule width={18} color={look.room.accent} style={[styles.monthRule, { opacity: inView ? (look.contrast ? 1 : 0.8) : 0 }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 18, paddingHorizontal: 24, minHeight: 62 },
  done: { minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" },
  headRule: { height: 1, marginHorizontal: 24 },
  scroll: { paddingHorizontal: 24, paddingTop: 14 },
  line: { flexDirection: "row", alignItems: "center", minHeight: 52, marginLeft: -20 },
  // A ribbon marker, hanging in the margin 8 pt from the title.
  ribbon: { width: 3, height: 22, marginLeft: 9, marginRight: 8 },
  lineRow: { flex: 1, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  lineStacked: { flex: 1, paddingVertical: 8 },
  title: { flexShrink: 1, marginRight: 12 },
  folioUnder: { marginTop: 4 },
  pruned: { marginTop: -6, marginBottom: 6 },
  section: { marginTop: 32, marginBottom: 6 },
  sectionFirst: { marginTop: 6 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sectionRule: { flex: 1, height: StyleSheet.hairlineWidth },
  asideUnder: { marginTop: 6 },
  looking: { marginTop: 10 },
  monthsBlock: { marginTop: 2, marginBottom: 8 },
  monthsHead: { marginBottom: 2 },
  months: { flexDirection: "row", flexWrap: "wrap" },
  month: { height: 44, alignItems: "center", justifyContent: "center" },
  monthEmpty: { opacity: 0.4 },
  monthRule: { marginTop: 4, height: 2 },
  dayYear: { minHeight: 52, alignItems: "center", justifyContent: "center", paddingVertical: 4 },
  dayYearCount: { marginTop: 2 },
  cover: { width: COVER, height: COVER, marginRight: 12, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  earlier: { marginTop: 10, alignItems: "flex-start", minHeight: 44, justifyContent: "center" },
  pressed: { opacity: 0.6 },
  foot: { marginTop: 36, alignItems: "center", gap: 10 },
  footRow: { flexDirection: "row", gap: 16 },
  center: { textAlign: "center" },
});
