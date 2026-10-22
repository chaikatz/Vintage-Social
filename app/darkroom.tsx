import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  FlatList,
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
import { setStatusBarStyle } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Feather from "@expo/vector-icons/Feather";
import { showAlert } from "@/utils/alert";
import { pickFromLibrary } from "@/utils/pickForCompose";
import { useDarkroom } from "@/darkroom/useDarkroom";
import { develop, type DevelopStage } from "@/darkroom/develop";
import { developedAt } from "@/darkroom/history";
import { toggleSetAside, useSetAside } from "@/darkroom/setAside";
import { chooseMorePhotographs, openPhotoSettings } from "@/darkroom/access";
import { readDiskCache, writeDiskCache } from "@/utils/diskCache";
import type { DarkroomMode, Print } from "@/darkroom/types";
import { PrintPage } from "@/components/darkroom/PrintPage";
import { YearIndex } from "@/components/darkroom/YearIndex";
import { Plate } from "@/components/darkroom/Plate";
import { Word } from "@/components/darkroom/Word";
import { room, roomType } from "@/components/darkroom/room";

/**
 * THE DARKROOM.
 *
 * The member's own camera roll, one print at a time, from further back
 * than they would ever scroll: this day in earlier years, a year read as
 * a chapter, or one at random from the back of the drawer. Swipe for the
 * next; Develop to take it into the ordinary editor and post it; set it
 * aside to decide later. Printed on the dark page, so the photographs are
 * the only light in the room.
 *
 * Everything is read on the phone. Nothing here uploads or publishes —
 * the editor's "Share to VINTAGE" is still the only way out.
 */

const MODES: { mode: Exclude<DarkroomMode, "set-aside">; label: string }[] = [
  { mode: "on-this-day", label: "On this day" },
  { mode: "surprise", label: "Surprise me" },
  { mode: "year", label: "By year" },
];

const STAGE_WORDS: Record<DevelopStage, string> = {
  reading: "Developing",
  icloud: "From iCloud",
  preparing: "Developing",
};

const INTRO_FILE = "darkroom-intro.json";
const INTRO_KEY = "vintage.darkroom-intro";

export default function Darkroom() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ mode?: DarkroomMode; year?: string; start?: string }>();
  const initialMode = params.mode && ["on-this-day", "surprise", "year", "set-aside"].includes(params.mode) ? params.mode : undefined;
  const { state, checkAccess, ask, open, openDefault, setIndex } = useDarkroom({
    mode: initialMode,
    year: params.year ? Number(params.year) : null,
    startId: params.start ?? null,
  });
  const setAsideList = useSetAside();
  const [pageHeight, setPageHeight] = useState(0);
  const [yearsOpen, setYearsOpen] = useState(false);
  const [stage, setStage] = useState<DevelopStage | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [intro, setIntro] = useState(false);
  const list = useRef<FlatList<Print>>(null);
  const chrome = useRef(new Animated.Value(1)).current;
  const now = useMemo(() => Date.now(), []);

  // --- first look ---------------------------------------------------------
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduceMotion(v)).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    setIntro(!readDiskCache(INTRO_FILE, INTRO_KEY, (raw) => (raw === true ? true : null)));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  // With access, open a way in — unless the last visit's place was kept.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    if (state.access !== "full" && state.access !== "limited") return;
    opened.current = true;
    if (state.restored) return;
    if (initialMode) open(initialMode, params.year ? Number(params.year) : null, { startId: params.start ?? null });
    else openDefault();
  }, [state.access, state.restored, initialMode, params.year, params.start, open, openDefault]);

  // Back from the editor without posting: the room as it was. The status
  // bar is set while the room is in front and given back when it is not —
  // the room stays mounted under the editor, whose page may be light.
  useFocusEffect(
    useCallback(() => {
      setStage(null);
      chrome.setValue(1);
      setStatusBarStyle("light", true);
      return () => setStatusBarStyle("auto", true);
    }, [chrome]),
  );

  const current = state.prints[state.index] ?? null;
  const finite = state.mode !== "surprise" && !(state.mode === "year" && state.more);
  const pages = state.sequence === "ready" ? state.prints : [];
  // A finite sequence ends with a page that says so; an endless one with a page that is still looking.
  const tail = state.sequence === "ready" ? (finite ? "end" : state.more ? "more" : "end") : null;

  const choose = (mode: DarkroomMode, year: number | null = null) => {
    Haptics.selectionAsync().catch(() => undefined);
    if (mode === "year" && year == null) {
      setYearsOpen(true);
      return;
    }
    open(mode, year);
  };

  const dismissIntro = () => {
    if (!intro) return;
    setIntro(false);
    writeDiskCache(INTRO_FILE, INTRO_KEY, true);
  };

  const onPage = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== state.index && next >= 0 && next < state.prints.length) {
      setIndex(next);
      dismissIntro();
    }
  };

  const go = (to: number) => {
    if (to < 0 || to >= state.prints.length) return;
    list.current?.scrollToIndex({ index: to, animated: !reduceMotion });
    setIndex(to);
  };

  // --- develop ------------------------------------------------------------
  const developCurrent = async () => {
    if (!current || stage) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setStage("reading");
    Animated.timing(chrome, { toValue: 0, duration: reduceMotion ? 0 : 220, useNativeDriver: true }).start();
    const outcome = await develop(current, setStage);
    if (!outcome.ok) {
      setStage(null);
      Animated.timing(chrome, { toValue: 1, duration: reduceMotion ? 0 : 180, useNativeDriver: true }).start();
      const words = {
        missing: ["No longer in your library", "This photograph has been deleted, or is outside the photographs VINTAGE may see."],
        icloud: ["Couldn’t bring it down from iCloud", "The original is in iCloud and didn’t arrive. Check your connection and try again."],
        offline: ["In iCloud, and you’re offline", "Set it aside and develop it when you’re connected."],
        unreadable: ["Couldn’t develop this one", "The file couldn’t be read. Try another, or choose it from your library."],
      }[outcome.reason];
      showAlert(words[0], words[1]);
      return;
    }
    router.push({ pathname: "/compose", params: outcome.params });
  };

  const fromLibrary = async () => {
    const picked = await pickFromLibrary("photo");
    if (picked) router.push({ pathname: "/compose", params: picked });
  };

  const isAside = current ? setAsideList.some((p) => p.id === current.id) : false;
  const setAsideCurrent = () => {
    if (!current) return;
    Haptics.selectionAsync().catch(() => undefined);
    const now = toggleSetAside(current);
    AccessibilityInfo.announceForAccessibility(now ? "Set aside" : "Put back");
  };

  // --- what fills the room ------------------------------------------------
  const body = (() => {
    if (state.access === "checking") return <Quiet />;
    if (state.access === "unavailable") {
      return (
        <Plate eyebrow="The Darkroom" title="There’s no photo library here." body="The Darkroom reads the photographs on your iPhone. Open VINTAGE on your phone to use it.">
          <Word label="Close" ruled onPress={() => router.back()} />
        </Plate>
      );
    }
    if (state.access === "undetermined") {
      return (
        <Plate
          eyebrow="The Darkroom"
          title="Your library, one print at a time."
          body="The Darkroom shows you photographs already on this iPhone — this day in other years, a year at a time, or one from the back of the drawer. They are read here and never uploaded. Only a photograph you develop and post leaves your phone."
          foot="Nothing is posted without your say."
        >
          <Word label="Allow access" ruled strong onPress={ask} />
          <Word label="Choose one myself" dim onPress={fromLibrary} />
        </Plate>
      );
    }
    if (state.access === "denied") {
      return (
        <Plate
          eyebrow="The Darkroom"
          title="The Darkroom is closed."
          body="VINTAGE isn’t allowed to see your photo library, so there is nothing to show. You can let it in Settings, under Photos — or choose a photograph yourself."
        >
          <Word label="Open Settings" ruled strong onPress={openPhotoSettings} />
          <Word label="Choose one myself" dim onPress={fromLibrary} />
        </Plate>
      );
    }
    if (state.sequence === "idle" || state.sequence === "loading" || pageHeight === 0) {
      return <Quiet label={state.mode === "on-this-day" ? "Looking back through this day" : "Looking further back"} />;
    }
    if (state.sequence === "failed") {
      return (
        <Plate eyebrow="The Darkroom" title="The library didn’t answer." body="Something went wrong reading your photographs. It is usually brief.">
          <Word label="Try again" ruled strong onPress={() => open(state.mode, state.year, { refreshYears: true })} />
          <Word label="Choose one myself" dim onPress={fromLibrary} />
        </Plate>
      );
    }
    if (state.sequence === "empty") return <Empty mode={state.mode} limited={state.access === "limited"} hasYears={state.years.length > 0} onChoose={choose} onLibrary={fromLibrary} />;
    return null;
  })();

  const showPager = body === null;

  return (
    <View
      style={styles.root}
      // VoiceOver: a two-finger double tap develops; the escape gesture leaves.
      onMagicTap={() => {
        if (current && !stage) developCurrent();
      }}
      onAccessibilityEscape={() => router.back()}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* The top of the room: out, the name, the bench. */}
      <Animated.View style={[styles.top, { paddingTop: insets.top + 6, opacity: chrome }]} pointerEvents={stage ? "none" : "auto"}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Leave the Darkroom">
          <Feather name="x" size={20} color={room.ink} />
        </Pressable>
        <Text style={styles.name} accessibilityRole="header">
          The Darkroom
        </Text>
        <View style={styles.bench}>
          {setAsideList.length > 0 && state.mode !== "set-aside" && (state.access === "full" || state.access === "limited") ? (
            <Pressable
              onPress={() => choose("set-aside")}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Set aside, ${setAsideList.length} ${setAsideList.length === 1 ? "photograph" : "photographs"}`}
            >
              <Text style={styles.benchText}>Set aside · {setAsideList.length}</Text>
            </Pressable>
          ) : null}
        </View>
      </Animated.View>

      {/* The ways in. */}
      {state.access === "full" || state.access === "limited" ? (
        <Animated.View style={[styles.modes, { opacity: chrome }]} pointerEvents={stage ? "none" : "auto"}>
          {state.mode === "set-aside" ? (
            <>
              <Word label="Set aside" ruled onPress={() => undefined} selected />
              <Word label="Back to the room" dim onPress={() => openDefault()} />
            </>
          ) : (
            MODES.map(({ mode, label }) => {
              const chosen = state.mode === mode;
              const shown = mode === "year" && chosen && state.year != null ? String(state.year) : label;
              return (
                <Word
                  key={mode}
                  label={shown}
                  ruled={chosen}
                  dim={!chosen}
                  selected={chosen}
                  onPress={() => (mode === "year" ? setYearsOpen(true) : chosen ? undefined : choose(mode))}
                  accessibilityLabel={mode === "year" && chosen && state.year != null ? `By year, ${state.year}. Choose another year` : label}
                />
              );
            })
          )}
        </Animated.View>
      ) : null}

      <View style={styles.room} onLayout={(e) => setPageHeight(e.nativeEvent.layout.height)}>
        {intro && showPager ? (
          <Text style={styles.intro} pointerEvents="none">
            Swipe for the next. Develop the one worth sharing.
          </Text>
        ) : null}
        {showPager ? (
          <FlatList
            ref={list}
            key={`${state.mode}-${state.year ?? ""}-${state.restored ? "r" : "f"}`}
            data={pages}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(p) => p.id}
            initialScrollIndex={state.index > 0 && state.index < pages.length ? state.index : undefined}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={onPage}
            onScrollToIndexFailed={() => undefined}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            windowSize={5}
            removeClippedSubviews
            scrollEnabled={!stage}
            renderItem={({ item, index }) => (
              <PrintPage
                print={item}
                width={width}
                height={pageHeight}
                now={now}
                active={index === state.index}
                posted={developedAt(item.id)}
                reduceMotion={reduceMotion}
                stage={index === state.index && stage ? `${STAGE_WORDS[stage]}…` : null}
                onAccessibilityAction={(a) => go(a === "increment" ? index + 1 : index - 1)}
              />
            )}
            ListFooterComponent={
              tail ? (
                <View style={{ width, height: pageHeight }}>
                  {tail === "more" ? (
                    <Quiet label="Looking further back" />
                  ) : (
                    <End mode={state.mode} year={state.year} onChoose={choose} onLibrary={fromLibrary} />
                  )}
                </View>
              ) : null
            }
          />
        ) : (
          body
        )}
      </View>

      {/* The bench: set aside, develop, the ordinary library. */}
      {showPager ? (
        <Animated.View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) + 6, opacity: chrome }]} pointerEvents={stage ? "none" : "auto"}>
          {state.access === "limited" ? (
            <Pressable onPress={chooseMorePhotographs} hitSlop={8} accessibilityRole="button" accessibilityLabel="VINTAGE sees only the photographs you chose. Choose more.">
              <Text style={styles.limited}>Only the photographs you chose · Choose more</Text>
            </Pressable>
          ) : null}
          <View style={styles.actions}>
            <View style={styles.side}>
              {current ? (
                <Word
                  label={isAside ? "Put back" : "Set aside"}
                  dim={!isAside}
                  onPress={setAsideCurrent}
                  accessibilityHint={isAside ? "Takes it off the set-aside bench." : "Keeps it on this phone to come back to. Nothing is posted."}
                />
              ) : null}
            </View>
            <Word label="Develop" ruled strong onPress={developCurrent} disabled={!current || Boolean(stage)} accessibilityHint="Opens it in the editor to post." />
            <View style={[styles.side, styles.sideRight]}>
              <Word label="Library" dim onPress={fromLibrary} accessibilityHint="Choose any photograph from your library instead." />
            </View>
          </View>
        </Animated.View>
      ) : null}

      <YearIndex
        visible={yearsOpen}
        years={state.years}
        current={state.mode === "year" ? state.year : null}
        onClose={() => setYearsOpen(false)}
        onChoose={(year) => {
          setYearsOpen(false);
          Haptics.selectionAsync().catch(() => undefined);
          open("year", year);
        }}
      />
      {stage ? <View style={StyleSheet.absoluteFill} pointerEvents="auto" accessibilityViewIsModal /> : null}
    </View>
  );
}

function Quiet({ label }: { label?: string }) {
  return (
    <View style={styles.quiet} accessibilityLiveRegion="polite">
      <ActivityIndicator color={room.faint} />
      {label ? <Text style={styles.quietText}>{label}</Text> : null}
    </View>
  );
}

function Empty({
  mode,
  limited,
  hasYears,
  onChoose,
  onLibrary,
}: {
  mode: DarkroomMode;
  limited: boolean;
  hasYears: boolean;
  onChoose: (mode: DarkroomMode, year?: number | null) => void;
  onLibrary: () => void;
}) {
  if (!hasYears) {
    return (
      <Plate
        eyebrow="The Darkroom"
        title={limited ? "Nothing chosen yet." : "Nothing in the library yet."}
        body={
          limited
            ? "VINTAGE can only see the photographs you chose for it, and there are none. Choose some, or pick one yourself."
            : "When there are photographs on this iPhone, the Darkroom will find the old ones."
        }
      >
        {limited ? <Word label="Choose photographs" ruled strong onPress={chooseMorePhotographs} /> : null}
        <Word label="Choose one myself" dim={limited} ruled={!limited} onPress={onLibrary} />
      </Plate>
    );
  }
  if (mode === "on-this-day") {
    return (
      <Plate eyebrow="On this day" title="Nothing from this time of year." body="No photographs from around this date in earlier years. The rest of the library is still here.">
        <Word label="Surprise me" ruled strong onPress={() => onChoose("surprise")} />
        <Word label="By year" dim onPress={() => onChoose("year")} />
      </Plate>
    );
  }
  if (mode === "set-aside") {
    return (
      <Plate eyebrow="Set aside" title="Nothing set aside." body="Set a print aside in the Darkroom to come back to it. It stays on this phone and is never posted on its own.">
        <Word label="Back to the room" ruled strong onPress={() => onChoose("surprise")} />
      </Plate>
    );
  }
  return (
    <Plate
      eyebrow="The Darkroom"
      title="Nothing older than a few months."
      body={limited ? "Among the photographs you chose, everything is recent. Choose more, or pick one yourself." : "Everything in your library is recent. The Darkroom is for the ones from further back."}
    >
      {limited ? <Word label="Choose photographs" ruled strong onPress={chooseMorePhotographs} /> : null}
      <Word label="Choose one myself" dim={limited} ruled={!limited} onPress={onLibrary} />
    </Plate>
  );
}

function End({
  mode,
  year,
  onChoose,
  onLibrary,
}: {
  mode: DarkroomMode;
  year: number | null;
  onChoose: (mode: DarkroomMode, year?: number | null) => void;
  onLibrary: () => void;
}) {
  const title =
    mode === "on-this-day" ? "That’s this day." : mode === "year" ? `That’s ${year ?? "the year"}.` : mode === "set-aside" ? "That’s everything set aside." : "That’s all for now.";
  return (
    <Plate eyebrow="The Darkroom" title={title}>
      {mode !== "surprise" ? <Word label="Surprise me" ruled strong onPress={() => onChoose("surprise")} /> : null}
      <Word label="By year" dim={mode !== "surprise"} ruled={mode === "surprise"} strong={mode === "surprise"} onPress={() => onChoose("year")} />
      <Word label="Choose one myself" dim onPress={onLibrary} />
    </Plate>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: room.page },
  top: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 4 },
  close: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center", paddingLeft: 4 },
  name: { flex: 1, textAlign: "center", ...roomType.eyebrow, color: room.soft },
  bench: { width: 96, alignItems: "flex-end" },
  benchText: { ...roomType.eyebrow, fontSize: 9.5, color: room.gold },
  modes: { flexDirection: "row", justifyContent: "center", gap: 14, paddingBottom: 2 },
  room: { flex: 1 },
  intro: {
    position: "absolute",
    top: 4,
    left: 0,
    right: 0,
    textAlign: "center",
    fontFamily: roomType.serif,
    fontStyle: "italic",
    fontSize: 13,
    color: room.faint,
    zIndex: 2,
  },
  bottom: { paddingHorizontal: 20, paddingTop: 4 },
  limited: { ...roomType.eyebrow, fontSize: 9, color: room.faint, textAlign: "center", marginBottom: 6 },
  actions: { flexDirection: "row", alignItems: "center" },
  side: { flex: 1, alignItems: "flex-start" },
  sideRight: { alignItems: "flex-end" },
  quiet: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  quietText: { ...roomType.eyebrow, color: room.faint },
});
