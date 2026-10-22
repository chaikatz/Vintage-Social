import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { setStatusBarHidden, setStatusBarStyle } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Feather from "@expo/vector-icons/Feather";
import { pickFromLibrary } from "@/utils/pickForCompose";
import { readDiskCache, writeDiskCache } from "@/utils/diskCache";
import { useDarkroom } from "@/darkroom/useDarkroom";
import { develop, discardDeveloped, type DevelopFailure, type DevelopStage } from "@/darkroom/develop";
import { developedAt } from "@/darkroom/history";
import { toggleSetAside, useSetAside } from "@/darkroom/setAside";
import { chooseMorePhotographs, openPhotoSettings } from "@/darkroom/access";
import { monthIndex } from "@/darkroom/discovery";
import { captionFor, fullDate, monthDay } from "@/darkroom/labels";
import type { DarkroomMode, Print } from "@/darkroom/types";
import { PrintPage } from "@/components/darkroom/PrintPage";
import { Contents } from "@/components/darkroom/Contents";
import { Plate } from "@/components/darkroom/Plate";
import { Word } from "@/components/darkroom/Word";
import { room, roomType, untrack } from "@/components/darkroom/room";

/**
 * THE DARKROOM.
 *
 * The member's own camera roll, one print at a time, from further back
 * than they would ever scroll: this day in earlier years, one at random
 * from the back of the drawer, or a year read as a chapter. Swipe for the
 * next; DEVELOP takes it into the ordinary editor to post; SET ASIDE keeps
 * it on this phone to decide on later. Printed on the dark page whatever
 * the appearance, so the photographs are the only light in the room.
 *
 * Everything is read on the phone. Nothing here uploads or publishes —
 * the editor's "Share to VINTAGE" is still the only way out.
 */

const INTRO_FILE = "darkroom-intro.json";
const INTRO_KEY = "vintage.darkroom-intro";
/** The caption of the print being developed stays lit while the rest of the room's words go out. */
const LIT = new Animated.Value(1);
/** A chapter's title card is held at least this long, so a jump reads as a jump. */
const TITLE_HOLD_MS = 500;

/** What the caption says while a print is being developed: the line in capitals, and the quiet line under it. */
const STAGE_WORDS: Record<DevelopStage, [string, string]> = {
  reading: ["Developing…", " "],
  icloud: ["Developing…", "If it’s kept in iCloud, it’s on its way down."],
};

const FAILURE_WORDS: Record<Exclude<DevelopFailure, "cancelled">, [string, string]> = {
  missing: ["No longer in your library", "It may have been deleted, or it’s outside what VINTAGE can see."],
  icloud: ["iCloud didn’t send it", "Try again on a better connection, or set it aside."],
  offline: ["Not on this iPhone, and it’s offline", "It may be kept in iCloud. Set it aside, and develop it when you’re connected."],
  unreadable: ["This one wouldn’t open", "Try again, or set it aside."],
};

function chapterName(mode: DarkroomMode, year: number | null): string {
  if (mode === "on-this-day") return "On this day";
  if (mode === "surprise") return "Surprise me";
  if (mode === "set-aside") return "Set aside";
  return year != null ? String(year) : "By year";
}

export default function Darkroom() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ mode?: DarkroomMode; year?: string; start?: string }>();
  const initialMode =
    params.mode && ["on-this-day", "surprise", "year", "set-aside"].includes(params.mode) ? params.mode : undefined;
  const { state, checkAccess, ask, open, openDefault, setIndex } = useDarkroom({
    mode: initialMode,
    year: params.year ? Number(params.year) : null,
    startId: params.start ?? null,
  });
  const shelf = useSetAside();
  const now = useMemo(() => Date.now(), []);
  const [roomHeight, setRoomHeight] = useState(0);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [months, setMonths] = useState<number[] | null>(null);
  const [stage, setStage] = useState<DevelopStage | null>(null);
  const [failure, setFailure] = useState<{ id: string; reason: DevelopFailure } | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [introSeen, setIntroSeen] = useState(() => readDiskCache(INTRO_FILE, INTRO_KEY, (raw) => (raw === true ? true : null)) === true);
  const [titleCard, setTitleCard] = useState<{ eyebrow: string; title: string; until: number } | null>(null);
  const list = useRef<FlatList<Print>>(null);
  const chrome = useRef(new Animated.Value(1)).current;
  const [chromeHidden, setChromeHidden] = useState(false);
  const developing = useRef(false);
  const stopDeveloping = useRef(false);
  // The copy handed to the editor; if the member comes back without posting, it is not kept.
  const developed = useRef<string | null>(null);
  // Prints whose image failed to draw because the photograph is gone.
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const afterContents = useRef<(() => void) | null>(null);

  // --- the room's light ----------------------------------------------------
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduceMotion(v)).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  // The status bar is set while the room is in front and given back when it
  // is not: the room stays mounted under the editor, whose page may be light.
  // Back from the editor without posting, the room is as it was.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle("light", true);
      setStage(null);
      developing.current = false;
      discardDeveloped(developed.current);
      developed.current = null;
      Animated.timing(chrome, { toValue: 1, duration: reduceMotion ? 0 : 200, useNativeDriver: true }).start();
      setChromeHidden(false);
      return () => {
        setStatusBarHidden(false, "fade");
        setStatusBarStyle("auto", true);
      };
    }, [chrome, reduceMotion]),
  );

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  const granted = state.access === "full" || state.access === "limited";
  const threshold = state.access === "undetermined" || (granted && !introSeen);

  // With access and past the threshold, open a way in — unless the last visit's place was kept.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !granted || !introSeen) return;
    opened.current = true;
    if (state.restored) return;
    if (initialMode) open(initialMode, params.year ? Number(params.year) : null, { startId: params.start ?? null });
    else openDefault();
  }, [granted, introSeen, state.restored, initialMode, params.year, params.start, open, openDefault]);

  // The open year's months, for the contents page.
  useEffect(() => {
    setMonths(null);
    if (state.mode !== "year" || state.year == null) return;
    let live = true;
    const { darkroomSource } = require("@/darkroom/source") as typeof import("@/darkroom/source");
    const source = darkroomSource();
    if (source) monthIndex(source, state.year).then((m) => live && setMonths(m)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [state.mode, state.year]);

  // A title card while a chapter is being dealt, held a moment so a jump reads as one.
  const showTitle = (mode: DarkroomMode, year: number | null, month = 0) => {
    const title =
      mode === "on-this-day" ? monthDay(now) : mode === "surprise" ? "Any year" : mode === "set-aside" ? "Set aside" : `${year ?? ""}`;
    // The eyebrow names the way in; the title names where it opens.
    const eyebrow =
      mode === "year" ? (month > 0 ? `By year · from ${fullDate(new Date(year ?? 2000, month, 1).getTime()).split(" ")[0]}` : "By year") : chapterName(mode, year);
    setTitleCard({ eyebrow, title, until: Date.now() + (reduceMotion ? 0 : TITLE_HOLD_MS) });
  };
  useEffect(() => {
    if (!titleCard || state.sequence === "loading" || state.sequence === "idle") return;
    const left = titleCard.until - Date.now();
    if (left <= 0) {
      setTitleCard(null);
      return;
    }
    const t = setTimeout(() => setTitleCard(null), left);
    return () => clearTimeout(t);
  }, [titleCard, state.sequence]);

  const current = state.sequence === "ready" ? state.prints[state.index] ?? null : null;

  const enter = async () => {
    let access = state.access;
    if (access === "undetermined") access = await ask();
    if (access === "full" || access === "limited") {
      writeDiskCache(INTRO_FILE, INTRO_KEY, true);
      setIntroSeen(true);
    }
  };

  const choose = (mode: DarkroomMode, year: number | null = null, month = 0) => {
    Haptics.selectionAsync().catch(() => undefined);
    setFailure(null);
    if (mode === state.mode && year === state.year && month === state.month && state.sequence === "ready") return;
    showTitle(mode, year, month);
    open(mode, year, { month });
    AccessibilityInfo.announceForAccessibility(mode === "on-this-day" ? `On this day, ${monthDay(now)}` : chapterName(mode, year));
  };

  // A choice in the contents is acted on once the sheet has gone: a picker
  // or an editor pushed under an open sheet would be hidden behind it.
  const fromContents = (act: () => void) => {
    setContentsOpen(false);
    // iOS says when the sheet has gone; elsewhere it is gone at once.
    if (Platform.OS === "ios") afterContents.current = act;
    else setTimeout(act, 0);
  };

  const fromLibrary = async () => {
    const picked = await pickFromLibrary("photo");
    if (picked) router.push({ pathname: "/compose", params: picked });
  };

  // --- paging ---------------------------------------------------------------
  const onPage = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== state.index && next >= 0 && next < state.prints.length) {
      setIndex(next);
      setFailure(null);
    }
  };

  const go = (to: number) => {
    if (to < 0 || to >= state.prints.length) return;
    list.current?.scrollToIndex({ index: to, animated: false });
    setIndex(to);
    setFailure(null);
  };

  const toggleChrome = () => {
    const hide = !chromeHidden;
    setChromeHidden(hide);
    Animated.timing(chrome, { toValue: hide ? 0 : 1, duration: reduceMotion ? 0 : 180, useNativeDriver: true }).start();
    setStatusBarHidden(hide, "fade");
  };

  // --- set aside --------------------------------------------------------------
  const setAsideNow = (print: Print) => {
    const on = toggleSetAside(print);
    if (on) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    else Haptics.selectionAsync().catch(() => undefined);
    AccessibilityInfo.announceForAccessibility(on ? "Set aside" : "Put back");
  };

  // --- develop ----------------------------------------------------------------
  const developNow = async (print: Print | null = current) => {
    if (!print || developing.current) return;
    developing.current = true;
    stopDeveloping.current = false;
    setFailure(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => undefined);
    AccessibilityInfo.announceForAccessibility("Developing");
    setStage("reading");
    Animated.timing(chrome, { toValue: 0.0, duration: reduceMotion ? 0 : 200, useNativeDriver: true }).start();
    const outcome = await develop(print, {
      known_missing: missing.has(print.id),
      cancelled: () => stopDeveloping.current,
      onStage: (s) => {
        setStage(s);
        if (s === "icloud") AccessibilityInfo.announceForAccessibility("If it’s kept in iCloud, it’s on its way down.");
      },
    });
    const restore = () => {
      developing.current = false;
      setStage(null);
      Animated.timing(chrome, { toValue: 1, duration: reduceMotion ? 0 : 180, useNativeDriver: true }).start();
    };
    if (!outcome.ok) {
      restore();
      if (outcome.reason === "cancelled") return;
      setFailure({ id: print.id, reason: outcome.reason });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      AccessibilityInfo.announceForAccessibility(FAILURE_WORDS[outcome.reason][0]);
      return;
    }
    developed.current = outcome.params.uri;
    router.push({ pathname: "/compose", params: outcome.params });
  };

  // --- what fills the room --------------------------------------------------
  const tail = state.sequence === "ready" ? (state.more ? "more" : "end") : null;

  const endPage = () => {
    const title =
      state.mode === "on-this-day"
        ? "That is everything from this day."
        : state.mode === "year"
          ? `The end of ${state.year ?? "the year"}.`
          : state.mode === "set-aside"
            ? "That is all you set aside."
            : "That is everything the Darkroom can find for now.";
    const body =
      state.mode === "on-this-day"
        ? "There will be another tomorrow."
        : state.mode === "surprise"
          ? "It will have others for you another day."
          : undefined;
    const yearAt = state.years.findIndex((y) => y.year === state.year);
    const before = yearAt > 0 ? state.years[yearAt - 1].year : null;
    const after = yearAt >= 0 && yearAt < state.years.length - 1 ? state.years[yearAt + 1].year : null;
    return (
      <Plate eyebrow={state.mode === "on-this-day" ? monthDay(now) : chapterName(state.mode, state.year)} title={title} body={body}>
        {state.mode !== "surprise" ? <Word label="Surprise me" ruled strong onPress={() => choose("surprise")} /> : null}
        {state.mode === "year" && after != null ? <Word label={`On to ${after}`} dim onPress={() => choose("year", after)} /> : null}
        {state.mode === "year" && after == null && before != null ? <Word label={`Back to ${before}`} dim onPress={() => choose("year", before)} /> : null}
        {state.mode !== "year" ? (
          <Word label="Choose a year" dim={state.mode !== "surprise"} ruled={state.mode === "surprise"} strong={state.mode === "surprise"} onPress={() => setContentsOpen(true)} />
        ) : null}
        <Word label="Choose from your library" dim onPress={fromLibrary} />
      </Plate>
    );
  };

  const words = (() => {
    if (state.access === "checking") return <View style={styles.fill} />;
    if (state.access === "unavailable") {
      return (
        <Plate eyebrow="The Darkroom" title="There’s no photo library here." body="The Darkroom reads the photographs on your iPhone. Open VINTAGE there to use it.">
          <Word label="Back" ruled onPress={() => router.back()} />
        </Plate>
      );
    }
    if (threshold) {
      return (
        <Plate
          eyebrow="The Darkroom"
          title="Your best photos aren’t new."
          titleSize={32}
          body="One photograph at a time, from further back than you’d think to look."
          foot="VINTAGE looks through your library on this iPhone. Nothing leaves it unless you post it."
        >
          <Word label="Enter" ruled strong onPress={enter} accessibilityHint={state.access === "undetermined" ? "Asks to see your photo library." : undefined} />
          <Word label="Not now" dim onPress={() => router.back()} />
        </Plate>
      );
    }
    if (state.access === "denied") {
      return (
        <Plate
          eyebrow="The Darkroom"
          title="The door is shut."
          body="VINTAGE isn’t allowed to see your photo library, so there is nothing here to look through. You can let it in from Settings: tap Photos, then Full Access. It only ever reads on this iPhone."
        >
          <Word label="Open Settings" ruled strong onPress={openPhotoSettings} />
          <Word label="Choose one photograph" dim onPress={fromLibrary} />
        </Plate>
      );
    }
    if (titleCard || state.sequence === "idle" || state.sequence === "loading" || roomHeight === 0) {
      const card = titleCard ?? { eyebrow: chapterName(state.mode, state.year), title: state.mode === "on-this-day" ? monthDay(now) : "" };
      return <TitleCard eyebrow={card.eyebrow} title={card.title} waiting={state.sequence === "loading"} onSkip={() => setTitleCard(null)} />;
    }
    if (state.sequence === "failed") {
      return (
        <Plate eyebrow="The Darkroom" title="The library didn’t answer." body="Something on this iPhone kept VINTAGE from reading your photographs just now.">
          <Word label="Try again" ruled strong onPress={() => open(state.mode, state.year, { refreshYears: true, month: state.month })} />
          <Word label="Choose from your library" dim onPress={fromLibrary} />
        </Plate>
      );
    }
    if (state.sequence === "empty") {
      return (
        <Empty
          mode={state.mode}
          dayWord={monthDay(now)}
          limited={state.access === "limited"}
          hasYears={state.years.length > 0}
          onChoose={choose}
          onContents={() => setContentsOpen(true)}
          onLibrary={fromLibrary}
        />
      );
    }
    return null;
  })();

  const pager = words === null;
  const failed = failure && current && failure.id === current.id && failure.reason !== "cancelled" ? FAILURE_WORDS[failure.reason] : null;

  return (
    <View
      style={styles.root}
      // VoiceOver: a two-finger double tap develops; the escape gesture leaves.
      onMagicTap={() => {
        if (pager && current) developNow();
      }}
      onAccessibilityEscape={() => (contentsOpen ? setContentsOpen(false) : router.back())}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* The running head: back, the chapter, the contents. */}
      <Animated.View style={[styles.head, { paddingTop: insets.top, opacity: chrome }]} pointerEvents={chromeHidden || stage ? "none" : "box-none"}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <Feather name="chevron-left" size={24} color={room.ink} />
        </Pressable>
        <Text style={[styles.chapter, untrack(2.4)]} accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {granted && !threshold ? chapterName(state.mode, state.year) : ""}
        </Text>
        <View style={styles.contentsSlot}>
          {granted && !threshold ? (
            <Pressable onPress={() => setContentsOpen(true)} hitSlop={10} style={styles.contentsHit} accessibilityRole="button" accessibilityLabel="Contents" accessibilityHint="Choose a way in, a year, or a month.">
              <Text style={[styles.contentsWord, untrack(2.4)]} maxFontSizeMultiplier={1.3}>
                Contents
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Animated.View>

      <View style={styles.room} onLayout={(e) => setRoomHeight(e.nativeEvent.layout.height)}>
        {pager ? (
          <FlatList
            ref={list}
            key={`${state.mode}-${state.year ?? ""}-${state.month}-${state.restored ? "r" : "f"}`}
            data={state.prints}
            horizontal
            pagingEnabled
            disableIntervalMomentum
            decelerationRate="fast"
            bounces={false}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(p) => p.id}
            initialScrollIndex={state.index > 0 && state.index < state.prints.length ? state.index : undefined}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={onPage}
            onScrollToIndexFailed={() => undefined}
            initialNumToRender={1}
            maxToRenderPerBatch={1}
            windowSize={3}
            scrollEnabled={!stage}
            renderItem={({ item, index }) => {
              const caption = captionFor(item.takenAt, now, state.mode, state.reach, developedAt(item.id) != null);
              const aside = shelf.some((p) => p.id === item.id);
              const isCurrent = index === state.index;
              const fail = isCurrent && failed;
              return (
                <PrintPage
                  print={item}
                  width={width}
                  height={roomHeight}
                  label={fail ? fail[0].toUpperCase() : caption.label}
                  line={fail ? fail[1] : caption.line}
                  active={isCurrent}
                  isSetAside={aside}
                  onSetAside={() => setAsideNow(item)}
                  onTap={toggleChrome}
                  chrome={isCurrent && stage ? LIT : chrome}
                  reduceMotion={reduceMotion}
                  stage={isCurrent && stage ? STAGE_WORDS[stage] : null}
                  onMissing={() => setMissing((m) => (m.has(item.id) ? m : new Set(m).add(item.id)))}
                  accessibilityLabel={`Photograph, ${fullDate(item.takenAt)}. ${caption.line}.${aside ? " Set aside." : ""}`}
                  accessibilityActions={[
                    { name: "increment", label: "Next photograph" },
                    { name: "decrement", label: "Previous photograph" },
                    { name: "develop", label: "Develop" },
                    { name: "setAside", label: aside ? "Put back" : "Set aside" },
                    { name: "contents", label: "Contents" },
                  ]}
                  onAccessibilityAction={(name) => {
                    if (name === "increment") go(index + 1);
                    else if (name === "decrement") go(index - 1);
                    else if (name === "develop") developNow(item);
                    else if (name === "setAside") setAsideNow(item);
                    else if (name === "contents") setContentsOpen(true);
                  }}
                />
              );
            }}
            ListFooterComponent={
              tail ? (
                <View style={{ width, height: roomHeight }}>
                  {tail === "more" ? <TitleCard eyebrow={chapterName(state.mode, state.year)} title="" waiting onSkip={() => undefined} /> : endPage()}
                </View>
              ) : null
            }
          />
        ) : (
          words
        )}
      </View>

      {/* DEVELOP: the one word on this page that carries the rule. */}
      <Animated.View
        style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 16) + 8, opacity: stage === "icloud" ? 1 : pager && current ? chrome : 0 }]}
        pointerEvents={stage === "icloud" || (pager && current && !chromeHidden && !stage) ? "box-none" : "none"}
      >
        {state.access === "limited" && pager ? (
          <Text style={styles.limited} maxFontSizeMultiplier={1.4}>
            Only the photographs you shared with VINTAGE
          </Text>
        ) : null}
        {stage === "icloud" ? (
          <Word
            label="Cancel"
            ruled
            strong
            onPress={() => {
              stopDeveloping.current = true;
            }}
            accessibilityHint="Stops waiting for the photograph to come down from iCloud."
            style={styles.develop}
          />
        ) : (
          <Word
            label="Develop"
            ruled
            strong
            onPress={() => developNow()}
            disabled={!current || Boolean(stage)}
            accessibilityHint="Opens this photograph in the editor, to post."
            style={styles.develop}
          />
        )}
      </Animated.View>

      <Contents
        visible={contentsOpen}
        now={now}
        mode={state.mode}
        year={state.year}
        years={state.years}
        months={months}
        dayHasPhotographs={state.dayHas}
        setAside={shelf}
        limited={state.access === "limited"}
        onChoose={(mode, year) => fromContents(() => choose(mode, year ?? null))}
        onMonth={(month) => fromContents(() => choose("year", state.year, month))}
        onLibrary={() => fromContents(fromLibrary)}
        onChooseMore={() => fromContents(chooseMorePhotographs)}
        onSettings={() => fromContents(openPhotoSettings)}
        onClose={() => setContentsOpen(false)}
        onDismiss={() => {
          const act = afterContents.current;
          afterContents.current = null;
          act?.();
        }}
      />
      {stage === "reading" ? <View style={StyleSheet.absoluteFill} accessibilityViewIsModal /> : null}
    </View>
  );
}

/** A chapter's opening page: its name, large, and a rule — while it is dealt, and a moment after. */
function TitleCard({ eyebrow, title, waiting, onSkip }: { eyebrow: string; title: string; waiting: boolean; onSkip: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setSlow(true), 1200);
    return () => clearTimeout(t);
  }, [waiting]);
  const isYear = /^\d{4}$/.test(title);
  return (
    <Pressable style={styles.card} onPress={onSkip} accessible={false}>
      <Text style={[roomType.eyebrow, styles.cardEyebrow, untrack(2.4)]}>{eyebrow}</Text>
      {title ? (
        <Text style={[styles.cardTitle, isYear && styles.cardYear]} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={styles.cardRule} />
      <Text style={[styles.cardSlow, { opacity: slow && waiting ? 1 : 0 }]} accessibilityLiveRegion="polite">
        Looking through your library…
      </Text>
    </Pressable>
  );
}

function Empty({
  mode,
  dayWord,
  limited,
  hasYears,
  onChoose,
  onContents,
  onLibrary,
}: {
  mode: DarkroomMode;
  dayWord: string;
  limited: boolean;
  hasYears: boolean;
  onChoose: (mode: DarkroomMode, year?: number | null) => void;
  onContents: () => void;
  onLibrary: () => void;
}) {
  if (!hasYears) {
    return limited ? (
      <Plate
        eyebrow="The Darkroom"
        title="Only a few photographs to look through."
        body="You’ve shared part of your library with VINTAGE, and none of it is here yet. The Darkroom is at its best when it can look through all of it — it still reads only on this iPhone."
      >
        <Word label="Share more photographs" ruled strong onPress={chooseMorePhotographs} />
        <Word label="Allow full access in Settings" dim onPress={openPhotoSettings} />
        <Word label="Choose from your library" dim onPress={onLibrary} />
      </Plate>
    ) : (
      <Plate eyebrow="The Darkroom" title="Nothing to look through yet." body="There are no photographs in your library on this iPhone. If they live in iCloud, they may still be arriving.">
        <Word label="Choose from your library" ruled strong onPress={onLibrary} />
      </Plate>
    );
  }
  if (mode === "on-this-day") {
    return (
      <Plate eyebrow="On this day" title={`Nothing from ${dayWord}.`} body="Not in any other year, or in the weeks around it.">
        <Word label="Surprise me" ruled strong onPress={() => onChoose("surprise")} />
        <Word label="Choose a year" dim onPress={onContents} />
        <Word label="Choose from your library" dim onPress={onLibrary} />
      </Plate>
    );
  }
  if (mode === "set-aside") {
    return (
      <Plate eyebrow="Set aside" title="Nothing set aside." body="Set a print aside to come back to it. It stays on this phone and is never posted on its own.">
        <Word label="Surprise me" ruled strong onPress={() => onChoose("surprise")} />
      </Plate>
    );
  }
  return (
    <Plate
      eyebrow="The Darkroom"
      title="Nothing old enough yet."
      body={
        limited
          ? "Everything you’ve shared with VINTAGE is from the last few months. Share more, or choose one yourself."
          : "Everything in your library is from the last few months. The Darkroom keeps to photographs from before then. Give it a season."
      }
    >
      {limited ? <Word label="Share more photographs" ruled strong onPress={chooseMorePhotographs} /> : null}
      <Word label="Choose a year" dim={limited} ruled={!limited} strong={!limited} onPress={onContents} />
      <Word label="Choose from your library" dim onPress={onLibrary} />
    </Plate>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: room.page },
  fill: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", minHeight: 44, paddingHorizontal: 4, zIndex: 2 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  chapter: { flex: 1, textAlign: "center", fontFamily: roomType.mono, fontSize: 10, color: room.soft, textTransform: "uppercase" },
  contentsSlot: { width: 96, alignItems: "flex-end", paddingRight: 12 },
  contentsHit: { minHeight: 44, justifyContent: "center" },
  contentsWord: { fontFamily: roomType.mono, fontSize: 10, color: room.soft, textTransform: "uppercase" },
  room: { flex: 1 },
  foot: { alignItems: "center" },
  develop: { minHeight: 48, paddingHorizontal: 24 },
  limited: { fontFamily: roomType.serif, fontStyle: "italic", fontSize: 12, color: room.faint, marginBottom: 2 },
  card: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  cardEyebrow: { color: room.gold },
  cardTitle: { fontFamily: roomType.serif, fontSize: 40, lineHeight: 48, color: room.ink, marginTop: 12, textAlign: "center" },
  cardYear: { fontSize: 64, lineHeight: 72, fontVariant: ["oldstyle-nums"] },
  cardRule: { width: 26, height: 1, backgroundColor: room.ink, opacity: 0.8, marginTop: 16 },
  cardSlow: { fontFamily: roomType.serif, fontStyle: "italic", fontSize: 14, lineHeight: 20, color: room.faint, marginTop: 18 },
});
