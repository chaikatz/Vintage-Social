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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pickFromLibrary } from "@/utils/pickForCompose";
import { showAlert } from "@/utils/alert";
import { useReducedMotion } from "@/utils/useReducedMotion";
import { useBoldText, useIncreaseContrast, useScreenReader } from "@/utils/useRoomAccessibility";
import { useDarkroom, type RoomParams } from "@/darkroom/useDarkroom";
import { chooseMorePhotographs, openPhotoSettings } from "@/darkroom/access";
import { developedAt, markSeen } from "@/darkroom/history";
import { captionFor } from "@/darkroom/labels";
import { contentsFound, markContentsFound } from "@/darkroom/session";
import { putBack, toggleSetAside, useSetAside } from "@/darkroom/setAside";
import type { DarkroomMode, Print, Span } from "@/darkroom/types";
import { Contents } from "@/components/darkroom/Contents";
import { Develop } from "@/components/darkroom/Develop";
import { GLIDE_GAP, GLIDE_HEIGHT, GLIDE_LIFT, MIN_BOTTOM_INSET } from "@/components/darkroom/geometry";
import { GlideSheet, type GlideSheetHandle, type GlideWords } from "@/components/darkroom/GlideSheet";
import { GlideStrip } from "@/components/darkroom/GlideStrip";
import { haptics } from "@/components/darkroom/haptics";
import { LookContext, motion, type Look } from "@/components/darkroom/look";
import { Plate } from "@/components/darkroom/Plate";
import { wantsPhotograph, wantsProof } from "@/components/darkroom/plateImage";
import { PrintPage } from "@/components/darkroom/PrintPage";
import { rooms, useScheme } from "@/components/darkroom/room";
import { RunningHead } from "@/components/darkroom/RunningHead";
import { Stage, type StageHandle } from "@/components/darkroom/Stage";
import { TitleCard } from "@/components/darkroom/TitleCard";
import { useContentsSheet } from "@/components/darkroom/useContentsSheet";
import { useDevelop } from "@/components/darkroom/useDevelop";
import { useOnline } from "@/components/darkroom/useOnline";
import { useStageFades } from "@/components/darkroom/useStageFades";
import { useWordFade } from "@/components/darkroom/useWordFade";
import { wordOnPage } from "@/components/darkroom/wordFade";
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

// A print that breaks the room breaks only the room, with the way back on its page,
// which has no header (src/navigation/Recover.tsx).
export { RecoverRoom as ErrorBoundary } from "@/navigation/Recover";

/**
 * THE MEMORY ROOM, which the code still calls the Darkroom.
 *
 * The member's own camera roll, one print at a time, set as a photobook:
 * a running head, a plate with its caption hung beneath, a Contents
 * sheet, title cards and end pages. This day in other years, every
 * photograph of it, year by year; a roll of twenty-four from the back of
 * the drawer; this week, last weekend or this month; an occasion — days
 * on end with many photographs — found in the library; or a year read as
 * a chapter.
 * Swipe for the next, or tap the photograph: its right half turns on, its
 * left half back. POST, right under the photograph, takes the print into
 * the ordinary editor to post (the code still calls that develop); SET
 * ASIDE keeps it on this phone to come back to. Under POST, on every
 * page, the glide strip: every photograph of the chapter as a small
 * frame, and sliding across it plays the chapter through, the page
 * following the finger (`GlideStrip`, `GlideSheet`) until it lets go, and
 * the room turns there. Printed on
 * the app's own page, light or dark as the appearance is, and changing
 * with it (`useScheme` in room.ts); the status bar is the app's own,
 * which follows the appearance in the same way.
 *
 * This file puts the room together. The chapters and where the member is
 * are `useDarkroom`; develop is `useDevelop`; the pager is `Stage`, each
 * print `PrintPage`, the strip `GlideStrip`, every word the room says
 * `words.ts`.
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
  const scheme = useScheme();
  const look = useMemo<Look>(
    () => ({ room: rooms[scheme], contrast, bold, reduceMotion, screenReader }),
    [scheme, contrast, bold, reduceMotion, screenReader],
  );
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
  const threshold = useRef(new Animated.Value(1)).current;
  const [stageHeight, setStageHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [shelfFull, setShelfFull] = useState<string | null>(null);
  /** The preview over the stage while a finger glides the strip (`sheet` is Contents). */
  const glide = useRef<GlideSheetHandle>(null);
  /** A finger is gliding the strip: the pager waits, and POST with it. */
  const [gliding, setGliding] = useState(false);
  /** The same, as of now, for handlers that run between renders. */
  const glidingNow = useRef(false);
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

  // --- focus -------------------------------------------------------------------

  // Read through a ref, so a change of handler never reads as a blur.
  const onFocus = useRef(() => {});
  const onBlur = useRef(() => {});
  onFocus.current = () => {
    darkroom.focus();
    develop.returned();
  };
  onBlur.current = () => {
    endGlide();
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
    loadOccasions: darkroom.loadOccasions,
    pruneShelf: darkroom.pruneShelf,
  });

  /** Contents has been opened on this phone: the running head stops saying what is in it. */
  const [found, setFound] = useState(contentsFound);

  /**
   * Contents, unless a develop is working or downloading. Page turns are
   * held then and STOP is the way out (§6.3): a chapter chosen meanwhile
   * would open frozen, and the editor would follow with the print left
   * behind, under the sheet or over the new chapter. The word stays where
   * it is; it does nothing until the develop is done. However it is
   * opened — CONTENTS, the chapter's name, the line under CONTENTS, the
   * caption thread, a word on an end page, VoiceOver's action — the first
   * opening is remembered, and the line under CONTENTS goes while the
   * sheet is up, so the stage takes back its room out of sight.
   */
  const showContents = (months = false) => {
    if (develop.busy) return;
    sheet.show(months);
    if (!found) {
      markContentsFound();
      setFound(true);
    }
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
      // The picker can refuse outright (an iCloud original that would not
      // come down, a file that could not be read). The tap used to end in
      // silence, as it did on the Post tab; it says so, in the same words.
      if (mounted.current) {
        showAlert("Couldn’t open that", "It couldn’t be read here. Try again in a moment, or choose another.");
      }
    }
  };

  const choose = (mode: DarkroomMode, year: number | null = null, month: number | null = null, span: Span | null = null) => {
    if (darkroom.choose(mode, year, month, span)) pendingAnnouncement.current = chapterAnnouncement(mode, year, now, span);
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
      case "contents":
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

  // --- POST and the caption's word --------------------------------------------------

  const onBottom = (act: BottomAct) => {
    if (!current) return;
    if (act === "develop" || act === "retryLocal") void develop.develop(current);
    else if (act === "download" || act === "retryCloud") void develop.download(current);
    else if (act === "shareMore") void chooseMorePhotographs();
  };

  const onRight = useEvent((print: Print) => {
    if (glidingNow.current) return;
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
    if (glidingNow.current || develop.id != null) return;
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
  // not hold the caption thread and the plate's taps in this one. A
  // develop working or downloading is kept by its own guard.
  const generation = chapter?.generation;
  useEffect(() => {
    clear();
  }, [generation, clear]);

  // --- the glide strip -----------------------------------------------------------------

  /** A glide is over without landing: the pager is freed, and the preview goes at once. */
  const endGlide = () => {
    if (!glidingNow.current) return;
    glidingNow.current = false;
    setGliding(false);
    glide.current?.reset();
  };
  // A chapter dealt again, gone, or on its way under a glide: it ends there, so the pager is never left held.
  useEffect(() => {
    endGlide();
    // Only as the chapter or the view changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, state.view.kind, state.loading != null]);

  /** A finger down on the strip: the pager waits, and the page follows the strip instead. */
  const onGlideStart = useEvent(() => {
    if (!chapter) return;
    glidingNow.current = true;
    setGliding(true);
    glide.current?.start(chapter.index);
  });

  /** The frame under the box, each time it changes: shown, and the next few dealt if it nears the end of what is dealt. */
  const onGlideTo = useEvent((i: number) => {
    if (!glidingNow.current) return;
    glide.current?.to(i);
    darkroom.dealAhead(i);
  });

  /**
   * The glide has come to rest on frame `i`: the room turns there at once,
   * as a page turn would, and settles there by the room's own rules.
   * True when the room lands there (or is there already).
   */
  const onGlideEnd = useEvent((i: number): boolean => {
    if (!glidingNow.current || !chapter) return false;
    glidingNow.current = false;
    setGliding(false);
    const turns = i !== chapter.index;
    const p = chapter.prints[i] ?? null;
    glide.current?.to(i);
    glide.current?.end(turns && p ? p.id : null, p != null && darkroom.hasLoaded(p.id));
    if (turns) stage.current?.goTo(i);
    return true;
  });

  /** A frame tapped: straight to its page. */
  const onFrame = useEvent((i: number) => {
    if (!chapter || develop.busy || state.loading || i === chapter.index) return;
    stage.current?.goTo(i);
  });

  /** A plate's photograph has drawn: the room counts it, and a glide landed there hands over to it. */
  const onPlateLoad = useEvent((id: string) => {
    imageLoaded(id);
    glide.current?.drawn(id);
  });

  /** The words a print's page sets under it, its right-hand word too, for the preview of it while gliding. */
  const glideWords = useEvent((p: Print): GlideWords => {
    const said = captionWords({
      takenAt: p.takenAt,
      now,
      mode: chapter?.mode ?? "surprise",
      reach: chapter?.reach ?? null,
      postedAt: developedAt(p.id),
      state: stateOf(p.id),
      setAside: shelfIds.has(p.id),
      shelfChapter,
      limited,
      shelfFull: false,
    });
    return {
      label: said.label,
      line: said.line,
      long: said.long,
      gone: state.missing.has(p.id),
      word: said.word ? { label: said.word.label, on: said.word.on } : null,
    };
  });

  /** A tap on a photograph, handed to the pager, which knows which page is settled. */
  const onPlateTap = useCallback((x: number, zoomed: boolean) => stage.current?.tap(x, zoomed), []);

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
        proof={chapter != null && wantsProof(index, chapter.index)}
        // The settled print and its warm neighbours ask for their photograph; under the editor, the settled one alone.
        images={(focused && chapter != null && wantsPhotograph(index, chapter.index)) || isCurrent}
        inFront={focused}
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
        onTap={onPlateTap}
        onDate={onDate}
        onWord={onRight}
        onLoad={onPlateLoad}
        onGone={imageGone}
      />
    );
  };

  /** The page after the last print: the title card while more is dealt, or the end page. */
  const tailPage = (preview: boolean) => {
    if (!chapter) return <View />;
    if (chapter.more) {
      const card = titleCardWords(chapter.mode, chapter.year, chapter.month, now, chapter.span);
      return card ? <TitleCard eyebrow={card.eyebrow} title={card.title} year={card.year} waiting /> : <View />;
    }
    const page = darkroom.ending ? endPage(darkroom.ending, { now, limited, years: state.years }) : null;
    if (!page) return <View />;
    // The preview of it while gliding is for the eye: no focus, no words to press.
    return preview ? (
      <Plate page={page} onWord={noWord} testID="darkroom-glide-end" />
    ) : (
      <Plate ref={tailTitle} page={page} onWord={onWord} testID="darkroom-end" />
    );
  };
  const renderTail = () => tailPage(false);
  const renderTailPreview = useEvent(() => tailPage(true));

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
          ? emptyPage(state.view.why, { now, limited, span: state.where?.span ?? null })
          : null;
  const granted = state.access === "full" || state.access === "limited";
  const inside = granted && state.view.kind !== "firstVisit" && state.view.kind !== "checking";
  const headWhere = fades.card && state.loading?.mode ? state.loading : where;
  const headName = inside && headWhere?.mode ? chapterName(headWhere.mode, headWhere.year, headWhere.span) : null;
  const n = chapter?.prints.length ?? 0;
  const showsDevelop = state.view.kind === "prints" && current != null;
  // POST is on every photograph's page settled in front, and fades toward the end page with the scroll and back
  // with it while a page is turned: one graph for as long as the room is open, never handed over to another
  // value (wordFade.ts says why).
  const wordShown = wordOnPage({
    prints: state.view.kind === "prints",
    photograph: current != null,
    turning: dragging,
    count: n,
    card: fades.card != null,
  });
  const wordOpacity = useWordFade(scrollX, n, width, wordShown, reduceMotion);

  return (
    <LookContext.Provider value={look}>
      <View
        style={[styles.root, { backgroundColor: look.room.page }]}
        // Magic Tap is POST (§11.1) where React Native delivers it. On
        // the new architecture in 0.81 it never arrives: the view reads its
        // handler under another name (onAccessibilityMagicTap) than the one
        // React sends, and there is no way round that from here. POST is
        // reached instead as the stage's first custom action, by its words.
        onMagicTap={() => {
          if (showsDevelop) onBottom(words.bottom.act);
        }}
        onAccessibilityEscape={() => (sheet.open ? sheet.close() : back())}
        testID="darkroom"
      >
        <Stack.Screen options={{ headerShown: false }} />
        <RunningHead
          top={insets.top}
          name={headName}
          contents={inside}
          invite={!found}
          held={develop.busy}
          onBack={back}
          onContents={() => showContents()}
        />

        <View style={styles.room}>
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
                  scrollEnabled={!develop.busy && !state.loading && !gliding}
                  renderPrint={renderPrint}
                  renderTail={renderTail}
                  onSettle={onSettle}
                  onDragging={setDragging}
                  // A state showing holds the plate's taps; so do a chapter on its way and its title card.
                  taps={{ locked: develop.id != null || state.loading != null || fades.card != null, screenReader, reduceMotion }}
                  accessibility={accessibility}
                  tailTitle={tailTitle}
                />
              ) : null}
            </Animated.View>
            {chapter && stageHeight > 0 && state.view.kind === "prints" ? (
              <GlideSheet
                key={chapter.generation}
                ref={glide}
                prints={chapter.prints}
                index={chapter.index}
                dragging={dragging}
                width={width}
                stageHeight={stageHeight}
                fontScale={fontScale}
                pixelRatio={pixelRatio}
                wordsFor={glideWords}
                renderTail={renderTailPreview}
              />
            ) : null}
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

          {/* POST, right under the photograph, on every photograph's page; its block is on every page, so the
              stage keeps one height whatever it shows. */}
          <View style={styles.wordSlot}>
            <Develop
              words={words.bottom}
              opacity={wordOpacity}
              interactive={showsDevelop && !atTail && !state.loading && !fades.card}
              dragging={dragging || gliding}
              drawing={develop.drawing && develop.id === current?.id}
              onPress={onBottom}
            />
          </View>

          {/* The glide strip's slot under it, on every page, so the stage keeps one height whatever it shows. */}
          <View style={[styles.glideSlot, { marginBottom: Math.max(insets.bottom, MIN_BOTTOM_INSET) + GLIDE_LIFT }]}>
            {chapter && state.view.kind === "prints" ? (
              <GlideStrip
                key={chapter.generation}
                prints={chapter.prints}
                index={chapter.index}
                rebase={chapter.rebase}
                mode={chapter.mode}
                now={now}
                width={width}
                enabled={!develop.busy && state.loading == null && fades.card == null && !dragging}
                opacity={fades.stage}
                onStart={onGlideStart}
                onTo={onGlideTo}
                onEnd={onGlideEnd}
                onFrame={onFrame}
              />
            ) : null}
          </View>
        </View>

        <Contents
          visible={sheet.open}
          now={now}
          where={where}
          years={state.years}
          months={where?.mode === "year" ? state.months : null}
          monthInView={chapter?.mode === "year" && current ? new Date(current.takenAt).getMonth() : null}
          day={state.day}
          dayYears={state.dayYears}
          yearInView={chapter?.mode === "on-this-day" && current ? new Date(current.takenAt).getFullYear() : null}
          occasions={state.occasions}
          occasionsReading={state.occasionsReading}
          shelfCount={shelf.length}
          prunedNote={sheet.note}
          limited={limited}
          toMonths={sheet.toMonths}
          onChoose={(mode, year, month, span) => {
            haptics.chosen();
            sheet.close();
            choose(mode, year ?? null, month ?? null, span ?? null);
          }}
          onEarlier={() => void darkroom.loadOccasions(true)}
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

/** A word on the end page's preview while gliding: for the eye, never pressed. */
const noWord = () => undefined;

const styles = StyleSheet.create({
  root: { flex: 1 },
  room: { flex: 1 },
  stage: { flex: 1 },
  wordSlot: { marginBottom: GLIDE_GAP },
  glideSlot: { height: GLIDE_HEIGHT },
});
