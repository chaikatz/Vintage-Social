import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PixelRatio,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  type Text,
} from "react-native";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { setStatusBarHidden, setStatusBarStyle } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pickFromLibrary } from "@/utils/pickForCompose";
import { useReducedMotion } from "@/utils/useReducedMotion";
import { useBoldText, useIncreaseContrast, useScreenReader } from "@/utils/useRoomAccessibility";
import { useDarkroom, type RoomParams } from "@/darkroom/useDarkroom";
import { chooseMorePhotographs, openPhotoSettings } from "@/darkroom/access";
import { developedAt, markSeen } from "@/darkroom/history";
import { captionFor } from "@/darkroom/labels";
import { putBack, toggleSetAside, useSetAside } from "@/darkroom/setAside";
import type { DarkroomMode, Print } from "@/darkroom/types";
import { Contents } from "@/components/darkroom/Contents";
import { Develop } from "@/components/darkroom/Develop";
import { haptics } from "@/components/darkroom/haptics";
import { LookContext, motion, type Look } from "@/components/darkroom/look";
import { Plate } from "@/components/darkroom/Plate";
import { PrintPage } from "@/components/darkroom/PrintPage";
import { room } from "@/components/darkroom/room";
import { RunningHead } from "@/components/darkroom/RunningHead";
import { Stage, type StageHandle } from "@/components/darkroom/Stage";
import { TitleCard } from "@/components/darkroom/TitleCard";
import { useChrome } from "@/components/darkroom/useChrome";
import { useContentsSheet } from "@/components/darkroom/useContentsSheet";
import { useDevelop } from "@/components/darkroom/useDevelop";
import { useOnline } from "@/components/darkroom/useOnline";
import { useStageFades } from "@/components/darkroom/useStageFades";
import {
  chapterAnnouncement,
  chapterName,
  deniedPage,
  emptyPage,
  endPage,
  firstVisitPage,
  captionWords,
  LOOKING,
  shelfSaid,
  stageActions,
  stageValue,
  stateWords,
  titleCardWords,
  type BottomAct,
  type DevelopState,
  type PageWord,
  type PageWords,
  type RightAct,
  type StageAction,
} from "@/components/darkroom/words";

/**
 * THE DARKROOM.
 *
 * The member's own camera roll, one print at a time, set as a photobook:
 * a running head, a plate with its caption hung beneath, a Contents
 * sheet, title cards and end pages. This day in other years, a roll of
 * twenty-four from the back of the drawer, or a year read as a chapter.
 * Swipe for the next. DEVELOP takes the print into the ordinary editor
 * to post; SET ASIDE keeps it on this phone to come back to. Printed on
 * the dark page whatever the appearance, so the photographs are the only
 * light in the room.
 *
 * This file puts the room together. The chapters and where the member is
 * are `useDarkroom`; develop is `useDevelop`; the pager is `Stage`, each
 * print `PrintPage`, every word the room says `words.ts`.
 *
 * Everything is read on the phone. Nothing here uploads or publishes —
 * the editor's "Share to VINTAGE" is still the only way out.
 */

const MODES: readonly DarkroomMode[] = ["on-this-day", "surprise", "year", "set-aside"];
/** The shelf-full line stands in for the caption this long. */
const SHELF_FULL_MS = 3000;
/** The first-visit page fades out over this as the room is let in. */
const THRESHOLD_FADE_MS = 240;
const IDLE: DevelopState = { kind: "idle" };

/**
 * A handler whose identity never changes but which always runs the latest
 * code, so the pages it is handed to need not redraw when the screen does.
 */
function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current(...args), []);
}

function readParams(p: Record<string, string | string[] | undefined>): RoomParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const mode = MODES.find((m) => m === one(p.mode)) ?? null;
  const year = /^\d{4}$/.test(one(p.year) ?? "") ? Number(one(p.year)) : null;
  const month = /^\d{1,2}$/.test(one(p.month) ?? "") ? Math.min(11, Number(one(p.month))) : null;
  const start = one(p.start) || null;
  return { mode, year, month, start };
}

export default function Darkroom() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const pixelRatio = PixelRatio.get();
  const params = useLocalSearchParams();
  const darkroom = useDarkroom(useMemo(() => readParams(params), [])); // eslint-disable-line react-hooks/exhaustive-deps
  const { state } = darkroom;
  const reduceMotion = useReducedMotion();
  const contrast = useIncreaseContrast();
  const bold = useBoldText();
  const screenReader = useScreenReader();
  const look = useMemo<Look>(() => ({ contrast, bold, reduceMotion, screenReader }), [contrast, bold, reduceMotion, screenReader]);
  const focused = useIsFocused();
  const online = useOnline();
  const shelf = useSetAside();
  const shelfIds = useMemo(() => new Set(shelf.map((p) => p.id)), [shelf]);
  /** The visit's today: captions and the day's words are measured from it. */
  const now = useMemo(() => Date.now(), []);

  const chapter = state.chapter;
  const where = state.where;
  const limited = state.access === "limited";
  const shelfChapter = chapter?.mode === "set-aside";
  const current: Print | null = chapter && state.view.kind === "prints" ? chapter.prints[chapter.index] ?? null : null;
  const atTail = chapter != null && chapter.index >= chapter.prints.length;

  const stage = useRef<StageHandle>(null);
  const tailTitle = useRef<Text>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const lit = useRef(new Animated.Value(1)).current;
  const threshold = useRef(new Animated.Value(1)).current;
  const [stageHeight, setStageHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [shelfFull, setShelfFull] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const develop = useDevelop({
    reduceMotion,
    shelfChapter,
    online,
    onCompose: (composeParams) => router.push({ pathname: "/compose", params: composeParams }),
  });
  const chrome = useChrome({ screenReader, locked: develop.id != null, reduceMotion, top: insets.top });
  const fades = useStageFades(state.loading, now, reduceMotion);

  /** A print's state: its develop state, or "gone" when Photos said it is not there. */
  const stateOf = useCallback(
    (id: string): DevelopState => {
      const s = develop.stateFor(id);
      return s.kind === "idle" && state.missing.has(id) ? { kind: "gone" } : s;
    },
    [develop, state.missing],
  );
  const currentState = current ? stateOf(current.id) : IDLE;
  const words = stateWords(currentState, { setAside: current ? shelfIds.has(current.id) : false, shelfChapter, limited });

  // --- focus, and the status bar ---------------------------------------------

  // Read through a ref, so a change of handler never reads as a blur.
  const onFocus = useRef(() => {});
  const onBlur = useRef(() => {});
  onFocus.current = () => {
    setStatusBarStyle("light", true);
    darkroom.focus();
    develop.returned();
    chrome.reset();
  };
  onBlur.current = () => {
    setStatusBarHidden(false, "fade");
    setStatusBarStyle("auto", true);
    develop.left();
    darkroom.blur();
  };
  useFocusEffect(
    useCallback(() => {
      onFocus.current();
      return () => onBlur.current();
    }, []),
  );

  // The first-visit page has gone: its column is ready to be seen again, should it be.
  useEffect(() => {
    if (state.view.kind !== "firstVisit") threshold.setValue(1);
  }, [state.view.kind, threshold]);

  // --- saying what changed ------------------------------------------------------

  const announce = (text: string) => AccessibilityInfo.announceForAccessibility(text);
  useEffect(() => {
    if (words.announce) announce(words.announce);
    // Each state is said once, as it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentState.kind, currentState.kind === "working" && currentState.slow]);

  const sheet = useContentsSheet({
    where,
    loadYears: darkroom.loadYears,
    loadMonths: darkroom.loadMonths,
    pruneShelf: darkroom.pruneShelf,
  });

  /**
   * Contents, unless a develop is working or downloading. Page turns are
   * held then and STOP is the way out (§6.3): a chapter chosen meanwhile
   * would open frozen, and the editor would follow with the print left
   * behind, under the sheet or over the new chapter. The word stays where
   * it is; it does nothing until the develop is done.
   */
  const showContents = (months = false) => {
    if (!develop.busy) sheet.show(months);
  };

  /** After a chapter change: said, and the focus on the stage, once the sheet has gone and the chapter is in. */
  const pendingAnnouncement = useRef<string | null>(null);
  useEffect(() => {
    const text = pendingAnnouncement.current;
    if (!text || sheet.open || state.loading || state.view.kind !== "prints") return;
    pendingAnnouncement.current = null;
    announce(text);
    stage.current?.focus();
  }, [sheet.open, state.loading, state.view.kind, chapter?.generation]);

  // --- the shelf ------------------------------------------------------------------

  useEffect(() => {
    if (!shelfFull) return;
    const t = setTimeout(() => setShelfFull(null), SHELF_FULL_MS);
    return () => clearTimeout(t);
  }, [shelfFull]);

  const toggleShelf = (print: Print) => {
    const result = toggleSetAside(print);
    // The refusal at the cap is said too: under VoiceOver the caption that prints it is out of reach.
    announce(shelfSaid(result));
    if (result === "full") {
      setShelfFull(print.id);
      return;
    }
    if (result === "on") {
      haptics.setAside();
      // Set aside is looked at: Surprise leaves it be. Not on the shelf, which is browsed on purpose.
      if (!shelfChapter) markSeen(print.id);
    } else {
      haptics.putBack();
    }
  };

  // --- the ways on ---------------------------------------------------------------

  /** The ordinary picker, from the room: into the editor with no asset id. Shares develop's guard. */
  const pick = async () => {
    if (!develop.claim()) return;
    try {
      const picked = await pickFromLibrary("photo");
      if (picked && mounted.current) router.push({ pathname: "/compose", params: picked });
      else develop.unclaim();
    } catch {
      develop.unclaim();
    }
  };

  const choose = (mode: DarkroomMode, year: number | null = null, month: number | null = null) => {
    if (darkroom.choose(mode, year, month)) pendingAnnouncement.current = chapterAnnouncement(mode, year, now);
  };

  /** The first-visit word is said once: a second tap while iOS asks, or while the page fades, does nothing. */
  const entering = useRef(false);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  /** A word on a word page or an end page. */
  const onWord = (w: PageWord) => {
    switch (w.act) {
      case "continue":
      case "enter":
        if (entering.current) return;
        entering.current = true;
        void darkroom.enter().then((granted) => {
          if (!granted) {
            entering.current = false;
            return;
          }
          Animated.timing(threshold, {
            toValue: 0,
            duration: motion(look, THRESHOLD_FADE_MS),
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start(() => {
            entering.current = false;
            darkroom.begin();
          });
        });
        return;
      case "openSettings":
        return openPhotoSettings();
      case "pickOne":
      case "library":
        return void pick();
      case "surprise":
        return choose("surprise");
      case "chooseYear":
        return showContents();
      case "retry":
        return darkroom.retry();
      case "readOn":
        return darkroom.readOn();
      case "lookThroughYear":
      case "year":
        return choose("year", w.year ?? null);
      case "shareMore":
      case "choosePhotographs":
        return void chooseMorePhotographs();
      case "anotherRoll":
        return darkroom.anotherRoll();
      case "moreFrom":
        return darkroom.moreFrom();
      case "fromJanuary":
        return darkroom.fromJanuary();
    }
  };

  // --- DEVELOP and the caption's word ----------------------------------------------

  const onBottom = (act: BottomAct) => {
    if (!current) return;
    if (act === "develop" || act === "retryLocal") void develop.develop(current);
    else if (act === "download" || act === "retryCloud") void develop.download(current);
    else if (act === "shareMore") void chooseMorePhotographs();
  };

  const onRight = useEvent((print: Print) => {
    const right = stateWords(stateOf(print.id), { setAside: shelfIds.has(print.id), shelfChapter, limited }).right;
    const act: RightAct | undefined = right?.act;
    if (act === "toggle") toggleShelf(print);
    else if (act === "notNow") develop.notNow();
    else if (act === "stop") develop.stop();
    else if (act === "remove") {
      putBack(print.id);
      haptics.putBack();
      announce(shelfSaid("off"));
    }
  });

  /** The caption thread: in a year, the month strip; anywhere else, this print's year, at its month. */
  const onDate = useEvent((print: Print) => {
    if (develop.id != null) return;
    if (where?.mode === "year") return showContents(true);
    const year = new Date(print.takenAt).getFullYear();
    pendingAnnouncement.current = chapterAnnouncement("year", year, now);
    darkroom.thread(print);
  });

  // --- the pager ---------------------------------------------------------------------

  const { settle, imageLoaded, imageGone } = darkroom;
  const { clear } = develop;
  const onSettle = useCallback(
    (index: number) => {
      settle(index);
      clear();
    },
    [settle, clear],
  );

  // A new chapter is as good as a page turn: a state left on a print of
  // the last one (in iCloud, offline, a failure) is cleared, so it does
  // not hold the caption thread and the chrome in this one. A develop
  // working or downloading is kept by its own guard.
  const generation = chapter?.generation;
  useEffect(() => {
    clear();
  }, [generation, clear]);

  const renderPrint = (print: Print, index: number) => {
    const isCurrent = chapter != null && index === chapter.index;
    const said = captionWords({
      takenAt: print.takenAt,
      now,
      mode: chapter?.mode ?? "surprise",
      reach: chapter?.reach ?? null,
      postedAt: developedAt(print.id),
      state: stateOf(print.id),
      setAside: shelfIds.has(print.id),
      shelfChapter,
      limited,
      shelfFull: shelfFull === print.id,
    });
    return (
      <PrintPage
        print={print}
        width={width}
        stageHeight={stageHeight}
        fontScale={fontScale}
        pixelRatio={pixelRatio}
        current={isCurrent}
        proof={chapter != null && (index === chapter.index || index === chapter.index + 1)}
        images={focused || isCurrent}
        dissolve={!darkroom.hasLoaded(print.id)}
        revision={state.revision}
        online={online}
        limited={limited}
        gone={state.missing.has(print.id)}
        label={said.label}
        line={said.line}
        long={said.long}
        progress={isCurrent && said.progress ? develop.progress : null}
        wordLabel={said.word?.label ?? null}
        wordOn={said.word?.on ?? false}
        wordInert={said.word?.inert ?? false}
        wordHint={said.word?.hint}
        holdLayout={said.hold}
        bladesClosed={develop.bladesFor === print.id}
        captionOpacity={develop.id === print.id ? lit : chrome.opacity}
        onTap={chrome.toggle}
        onDate={onDate}
        onWord={onRight}
        onLoad={imageLoaded}
        onGone={imageGone}
      />
    );
  };

  const renderTail = () => {
    if (!chapter) return <View />;
    if (chapter.more) {
      const card = titleCardWords(chapter.mode, chapter.year, chapter.month, now);
      return card ? <TitleCard eyebrow={card.eyebrow} title={card.title} year={card.year} waiting /> : <View />;
    }
    const page = darkroom.ending ? endPage(darkroom.ending, { now, limited, years: state.years }) : null;
    return page ? <Plate ref={tailTitle} page={page} onWord={onWord} testID="darkroom-end" /> : <View />;
  };

  // --- VoiceOver's one element over the stage ----------------------------------------

  const aside = current ? shelfIds.has(current.id) : false;
  const baseLine = current ? captionFor(current.takenAt, now, chapter?.mode ?? "surprise", chapter?.reach ?? null, null).line : "";
  // The stage stays the one element over a trailing page still waiting on
  // its batch, so VoiceOver's focus is not lost there; only the end page
  // speaks for itself.
  const waiting = atTail && chapter?.more === true;
  const accessibility = {
    single: state.view.kind === "prints" && (!atTail || waiting),
    value: current ? stageValue(current.takenAt, baseLine, aside, developedAt(current.id), words) : waiting ? LOOKING : "",
    actions: stageActions(current?.takenAt ?? null, aside, { words, stated: develop.id != null, busy: develop.busy }),
    onAction: (name: StageAction["name"]) => {
      if (name === "contents") return showContents();
      if (!current) return;
      if (name === "develop") onBottom(words.bottom.act);
      else if (name === "more") onDate(current);
      // The caption's own word: SET ASIDE or PUT BACK, NOT NOW, STOP, REMOVE.
      else onRight(current);
    },
    onIncrement: () => chapter && !develop.busy && stage.current?.goTo(chapter.index + 1),
    onDecrement: () => chapter && !develop.busy && stage.current?.goTo(chapter.index - 1),
  };

  // --- what fills the stage --------------------------------------------------------

  const iosMajor = Platform.OS === "ios" ? parseInt(String(Platform.Version), 10) : 18;
  const page: PageWords | null =
    state.view.kind === "firstVisit"
      ? firstVisitPage(state.view.access)
      : state.view.kind === "denied"
        ? deniedPage(iosMajor)
        : state.view.kind === "empty"
          ? emptyPage(state.view.why, { now, limited })
          : null;
  const granted = state.access === "full" || state.access === "limited";
  const inside = granted && state.view.kind !== "firstVisit" && state.view.kind !== "checking";
  const headWhere = fades.card && state.loading?.mode ? state.loading : where;
  const headName = inside && headWhere?.mode ? chapterName(headWhere.mode, headWhere.year) : null;
  const n = chapter?.prints.length ?? 0;
  const developOpacity = useMemo(
    () =>
      Animated.multiply(
        scrollX.interpolate({ inputRange: [(n - 1) * width, n * width], outputRange: [1, 0], extrapolate: "clamp" }),
        chrome.opacity,
      ),
    [scrollX, n, width, chrome.opacity],
  );
  const showsDevelop = state.view.kind === "prints" && current != null;

  return (
    <LookContext.Provider value={look}>
      <View
        style={styles.root}
        // Magic Tap is DEVELOP (§11.1) where React Native delivers it. On
        // the new architecture in 0.81 it never arrives: the view reads its
        // handler under another name (onAccessibilityMagicTap) than the one
        // React sends, and there is no way round that from here. DEVELOP is
        // reached instead as the stage's first custom action, by its words.
        onMagicTap={() => {
          if (showsDevelop) onBottom(words.bottom.act);
        }}
        onAccessibilityEscape={() => (sheet.open ? sheet.close() : back())}
        testID="darkroom"
      >
        <Stack.Screen options={{ headerShown: false }} />
        <RunningHead
          top={chrome.top}
          name={headName}
          contents={inside}
          held={develop.busy}
          opacity={chrome.opacity}
          hidden={chrome.hidden}
          onBack={back}
          onContents={() => showContents()}
        />

        <View style={styles.stage} onLayout={(e) => setStageHeight(e.nativeEvent.layout.height)}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { opacity: fades.stage }]}
            pointerEvents={state.loading ? "none" : "auto"}
          >
            {page ? (
              <Plate
                page={page}
                onWord={onWord}
                opacity={state.view.kind === "firstVisit" ? threshold : undefined}
                testID={`darkroom-page-${state.view.kind}`}
              />
            ) : chapter && stageHeight > 0 && state.view.kind === "prints" ? (
              <Stage
                ref={stage}
                prints={chapter.prints}
                generation={chapter.generation}
                index={chapter.index}
                rebase={chapter.rebase}
                width={width}
                height={stageHeight}
                scrollX={scrollX}
                scrollEnabled={!develop.busy && !state.loading}
                renderPrint={renderPrint}
                renderTail={renderTail}
                onSettle={onSettle}
                onDragging={setDragging}
                accessibility={accessibility}
                tailTitle={tailTitle}
              />
            ) : null}
          </Animated.View>
          {fades.card ? (
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: fades.cardOpacity }]} pointerEvents="none">
              <TitleCard
                eyebrow={fades.card.eyebrow}
                title={fades.card.title}
                year={fades.card.year}
                waiting={state.loading != null}
                since={fades.card.since}
              />
            </Animated.View>
          ) : null}
        </View>

        <View style={{ marginBottom: Math.max(insets.bottom, 16) + 8 }}>
          <Develop
            words={words.bottom}
            opacity={showsDevelop && !fades.card ? developOpacity : ZERO}
            interactive={showsDevelop && !atTail && !chrome.hidden && !state.loading && !fades.card}
            dragging={dragging}
            drawing={develop.drawing && develop.id === current?.id}
            onPress={onBottom}
          />
        </View>

        <Contents
          visible={sheet.open}
          now={now}
          where={where}
          years={state.years}
          months={where?.mode === "year" ? state.months : null}
          monthInView={chapter?.mode === "year" && current ? new Date(current.takenAt).getMonth() : null}
          day={state.day}
          shelfCount={shelf.length}
          prunedNote={sheet.note}
          limited={limited}
          toMonths={sheet.toMonths}
          onChoose={(mode, year, month) => {
            haptics.chosen();
            sheet.close();
            choose(mode, year ?? null, month ?? null);
          }}
          onLibrary={() => sheet.close(() => void pick())}
          onShareMore={() => sheet.close(() => void chooseMorePhotographs())}
          onSettings={() => sheet.close(openPhotoSettings)}
          onClose={() => sheet.close()}
          onDismiss={sheet.dismissed}
        />
      </View>
    </LookContext.Provider>
  );
}

const ZERO = new Animated.Value(0);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: room.page },
  stage: { flex: 1 },
});
