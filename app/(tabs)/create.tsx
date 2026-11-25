import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { todaysPrint } from "@/components/onThisDayPrint";
import { useOnline } from "@/components/darkroom/useOnline";
import { MountPanel } from "@/components/post/MountPanel";
import { OnThisDayDoor, PostDoors } from "@/components/post/PostDoors";
import { RollFooter } from "@/components/post/RollFooter";
import { RollHero } from "@/components/post/RollHero";
import { RollRow } from "@/components/post/RollCell";
import { LimitedLine, WaysRow } from "@/components/post/WaysRow";
import { colors, spacing } from "@/theme";
import { showAlert } from "@/utils/alert";
import { fetchUserPosts } from "@/api/posts";
import { useSession } from "@/providers/SessionProvider";
import { pickFromLibrary, takeForCompose, type PickedParams } from "@/utils/pickForCompose";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";
import { useReducedMotion } from "@/utils/useReducedMotion";
import { darkroomAvailable } from "@/darkroom/source";
import { placeCover, placeLine } from "@/darkroom/session";
import { useSetAside } from "@/darkroom/setAside";
import type { Print } from "@/darkroom/types";
import { onPostAgain } from "@/post/again";
import { discardPrintCopy, openPrint, postHaptic } from "@/post/openPrint";
import { panelFor, type PanelAct } from "@/post/panels";
import {
  cellSize,
  GAP,
  heroFrame,
  heroHeight,
  NARROW,
  pageHeight,
  roomDoorFace,
  rollRows,
  rowsInSight,
  SECOND_TAP_MS,
  wellRows,
  type RollRow as Row,
} from "@/post/roll";
import { useDayDoor } from "@/post/useDayDoor";
import { useRoll } from "@/post/useRoll";

// A page that breaks as it draws breaks only this tab (src/navigation/Recover.tsx).
export { RecoverPage as ErrorBoundary } from "@/navigation/Recover";

/**
 * Where a post begins: the member's own photographs, and the one they
 * tap, large, one tap from the editor.
 *
 * One photograph per post. Short videos are allowed but live in the same
 * feed and grid as everything else — there is no separate video surface.
 *
 * Top to bottom. The two doors: the Memory Room's, in the invitation
 * card's stock, carrying the print the member left off on and where that
 * was; and On this day's, this date in earlier years, in their
 * photographs and the member's own posts. SET ASIDE · 3 under them when
 * anything is set aside. Then the selected photograph on the camera's
 * dark mount, in the frame the editor will give it, with the print's
 * signature line under it and POST beside it. Then RECENT, with SHORT
 * VIDEO and LIBRARY (the iPhone's own picker) on the same line, and the
 * roll: newest first, four to a row, the camera first on the iPhone. At
 * its foot, further back, the Memory Room again.
 *
 * The roll is read from the library only while the tab is in front, and
 * only with the access the member already gave; the tab asks for it only
 * from a tap on its own explanation, SHOW MY PHOTOGRAPHS. Everything it
 * reads stays on this phone, a bounded page at a time. Ten seconds after
 * the tab is left, and at once when the app goes to the background, it
 * lets go of every photograph out of sight, keeping the rows on the
 * screen and the mount, so the page is just as it was whenever it is
 * seen again (`src/post/useRoll.ts`). What it says about the room it
 * reads from the room's own small files, from the first frame. The one
 * posted photograph On this day may show is read from the server once
 * the tab is in front.
 *
 * Where there is no library to read (Android, a browser outside the
 * demo) the page is On this day, the picker's bar, the camera and the
 * clip.
 */
export default function Create() {
  const router = useRouter();
  // Opening a photograph takes a moment (a rendition from Photos, a
  // capture date, a decode), and a control only goes quiet once React has
  // rendered: two taps in one frame both got through and opened the
  // editor twice. The ref is checked and set in the tap itself, before
  // anything awaits, for every way in, the roll's photographs included.
  // `busy` is for the eye only: it says which way in is opening, so only
  // that one shows it, and the others rest until it is done.
  const opening = useRef(false);
  const [busy, setBusy] = useState<{ way: Way; id?: string } | null>(null);
  // Only a photograph from the roll can be stopped: a picker presented
  // over the app may send it to the background, and is never stopped.
  const printStop = useRef<AbortController | null>(null);
  const front = useRef(false);

  const native = Platform.OS !== "web";
  const ios = Platform.OS === "ios";
  const door = darkroomAvailable();
  const held = busy !== null;
  // On this day's date turns over with the clock, and it waits for focus
  // before asking the server for anything.
  const today = useToday();
  const focused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const online = useOnline();
  const { width: W, height: windowH, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const narrow = W < NARROW;
  const short = windowH < 700;
  const large = fontScale >= 1.35;
  const H = heroHeight(pageHeight(windowH, insets.top, insets.bottom));
  const size = cellSize(W);
  const iosMajor = parseInt(String(Platform.Version), 10);

  const roll = useRoll(focused);
  const allowed = roll.access === "full" || roll.access === "limited";

  const openWith = useCallback(
    async (way: Way, get: (signal?: AbortSignal) => Promise<PickedParams | null>, id?: string) => {
      if (opening.current) return;
      opening.current = true;
      setBusy({ way, id });
      const stop = way === "print" ? new AbortController() : null;
      printStop.current = stop;
      try {
        const params = await get(stop?.signal);
        // Asked as the photograph arrives: the tab may have been left while it came.
        if (params && (stop?.signal.aborted || !front.current)) {
          discardPrintCopy(params.uri);
          return;
        }
        if (params) router.push({ pathname: "/compose", params });
      } catch {
        // The picker or the camera can refuse outright (an iCloud original
        // that would not come down, a clip that could not be exported). The
        // tap used to end in silence, as if it had not been made.
        showAlert("Couldn’t open that", "It couldn’t be read here. Try again in a moment, or choose another.");
      } finally {
        if (printStop.current === stop) printStop.current = null;
        opening.current = false;
        setBusy(null);
      }
    },
    [router],
  );

  // Leaving the tab, or the app going to the background, stops a photograph opening.
  useFocusEffect(
    useCallback(() => {
      front.current = true;
      return () => {
        front.current = false;
        printStop.current?.abort();
      };
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") printStop.current?.abort();
    });
    return () => sub.remove();
  }, []);

  /** POST, the photograph on the mount, or a second tap on the selected cell: the editor. */
  const post = useCallback(
    (print: Print) => {
      if (opening.current) return;
      postHaptic();
      void openWith("print", (signal) => openPrint(print, signal), print.id);
    },
    [openWith],
  );

  const listRef = useRef<FlatList<Row>>(null);
  const offset = useRef(0);
  // Where the mount stands in the list's header, how tall the header is, and how much of the list shows.
  const heroTop = useRef(0);
  const heroBottom = useRef(Number.POSITIVE_INFINITY);
  const headerHeight = useRef(0);
  const viewport = useRef(0);
  const onMountLayout = useCallback((e: LayoutChangeEvent) => {
    heroTop.current = e.nativeEvent.layout.y;
    heroBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height;
  }, []);
  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    headerHeight.current = e.nativeEvent.layout.height;
  }, []);
  const onListLayout = useCallback((e: LayoutChangeEvent) => {
    viewport.current = e.nativeEvent.layout.height;
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);
  const toTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: !reduceMotionRef.current });
  }, []);

  const { select, selection } = roll;
  /** A photograph of the roll: selected, and seen large; tapped again once it is, opened. */
  const onCell = useCallback(
    (print: Print) => {
      if (opening.current) return;
      const sel = selection();
      if (sel?.id === print.id) {
        // A quick double tap selects; it does not post.
        if (Date.now() - sel.at >= SECOND_TAP_MS) post(print);
        return;
      }
      select(print.id);
      // With any of its frame out of view, the photograph is brought up to the mount, with POST under it.
      if (offset.current > heroTop.current + heroFrame(print, W, H).top) toTop();
    },
    [post, select, selection, toTop, W, H],
  );
  const onCellPost = useCallback(
    (print: Print) => {
      if (opening.current) return;
      select(print.id);
      post(print);
    },
    [post, select],
  );

  // Tapping Post again: the top, the newest, and the newest page read once.
  const { selectNewest, refresh } = roll;
  useEffect(
    () =>
      onPostAgain(() => {
        toTop();
        selectNewest();
        refresh();
      }),
    [refresh, selectNewest, toTop],
  );

  // The posts the profile shares, for the day's memory.
  const { session } = useSession();
  const userId = session?.user?.id ?? "";
  const posts = useQuery({
    queryKey: ["user-posts", userId],
    queryFn: () => fetchUserPosts(userId),
    enabled: Boolean(userId) && focused,
    // A memory changes once a day, and a new post reaches this cache on its own.
    staleTime: 10 * 60_000,
  });
  const memory = useMemo(() => todaysPrint(posts.data, new Date(today)), [posts.data, today]);
  const day = useDayDoor({ focused, access: roll.access, ready: roll.phase === "ready", today, memory });

  // Where the member left off in the room, from its own small file, from the first frame and again
  // each time the tab is in front; and the shelf, from its own.
  const [place, setPlace] = useState<Place>(readPlaceFile);
  useFocusEffect(
    useCallback(() => {
      try {
        setPlace({ line: placeLine(), cover: placeCover() });
      } catch {
        setPlace({ line: null, cover: null });
      }
    }, []),
  );
  const shelf = useSetAside();
  // The doors' prints stand where they will be while access is still being read, and their
  // photographs come into them once it was given. They stay while the tab rests (they are a few
  // points across), so the doors are the same whenever the page is seen again.
  const pictures = allowed;
  const room = roomDoorFace(place.line, place.cover, shelf[0] ?? null, allowed || roll.access === null);

  const openRoom = useCallback(() => router.push("/darkroom"), [router]);
  const openDay = useCallback(() => router.push("/memories"), [router]);
  const openShelf = useCallback(() => router.push({ pathname: "/darkroom", params: { mode: "set-aside" } }), [router]);
  const onCamera = useMemo(() => (native ? () => openWith("camera", takeForCompose) : undefined), [native, openWith]);
  const onVideo = () => openWith("video", () => pickFromLibrary("video"));
  const onLibrary = () => openWith("photo", () => pickFromLibrary("photo"));

  const ready = roll.phase === "ready";
  // Rows are made again only when the roll changes, so a row whose photographs did not change is not drawn again.
  const rows = useMemo<Row[]>(() => (ready ? rollRows(roll.prints, { camera: ios }) : wellRows({ camera: ios })), [ready, roll.prints, ios]);

  const onAct = (act: PanelAct) => {
    if (act === "ask") roll.ask();
    else if (act === "shareMore") roll.shareMore();
    else if (act === "retry") roll.retry();
    else void openWith("photo", () => pickFromLibrary("photo"));
  };

  const ways = busy && busy.way !== "print" ? busy.way : null;
  const panel = panelFor({ available: door, phase: roll.phase, access: roll.access, empty: roll.prints.length === 0 });
  // The clip's limit, where no trimmer holds a clip to it.
  const clipNote =
    Platform.OS !== "ios" ? (
      <View style={styles.note} pointerEvents="none">
        <Text style={styles.noteText} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
          Clips up to {MAX_VIDEO_SECONDS} seconds.
        </Text>
      </View>
    ) : null;

  // What stays drawn when the tab lets go of what is out of sight: the rows on the screen, one
  // either side, and the mount when it shows — read from where the list stood as it was let go.
  const release = roll.release;
  const sight = useMemo(
    () =>
      release === "unseen"
        ? {
            ...rowsInSight({ offset: offset.current, header: headerHeight.current, viewport: viewport.current, row: size + GAP }),
            hero: offset.current < heroBottom.current,
          }
        : null,
    [release, size],
  );
  const rowReleased = (index: number) => release === "all" || (sight != null && (index < sight.first || index > sight.last));
  const heroLetGo = release === "all" || (sight != null && !sight.hero);

  if (!door) {
    return (
      <Screen padded={false} scroll>
        <View style={[styles.alone, { paddingVertical: short ? spacing.sm : spacing.md }]}>
          <OnThisDayDoor face={day} narrow={narrow} short={short} large={large} pictures={false} reduceMotion={reduceMotion} held={held} onPress={openDay} />
        </View>
        <MountPanel
          kind="unavailable"
          iosMajor={iosMajor}
          H={H}
          narrow={narrow}
          busy={ways === "photo"}
          held={held}
          onAct={onAct}
          onOpenSettings={roll.openSettings}
        />
        <WaysRow recent={false} camera={native} library={false} narrow={narrow} large={large} busy={ways} held={held} onCamera={onCamera} onVideo={onVideo} />
        {clipNote}
      </Screen>
    );
  }

  const dim = roll.phase === "undetermined" || roll.phase === "denied";
  const selectedId = roll.selected?.id ?? null;
  const busyId = busy?.way === "print" ? (busy.id ?? null) : null;

  const header = (
    <View onLayout={onHeaderLayout}>
      <PostDoors
        room={room}
        day={day}
        shelf={shelf.length}
        narrow={narrow}
        short={short}
        large={large}
        pictures={pictures}
        reduceMotion={reduceMotion}
        held={held}
        onRoom={openRoom}
        onDay={openDay}
        onShelf={openShelf}
      />
      <View onLayout={onMountLayout}>
        {panel === null && roll.selected ? (
          <RollHero
            print={roll.selected}
            W={W}
            H={H}
            large={large}
            busy={busy?.way === "print"}
            held={held}
            released={heroLetGo}
            heroReleased={roll.heroReleased}
            reduceMotion={reduceMotion}
            focused={focused}
            online={online}
            now={today}
            onPost={() => roll.selected && post(roll.selected)}
          />
        ) : (
          <MountPanel
            kind={panel ?? "loading"}
            iosMajor={iosMajor}
            H={H}
            narrow={narrow}
            busy={roll.asking}
            held={held}
            onAct={onAct}
            onOpenSettings={roll.openSettings}
          />
        )}
      </View>
      <WaysRow
        recent
        camera={false}
        library
        narrow={narrow}
        large={large}
        busy={ways}
        held={held}
        onVideo={onVideo}
        onLibrary={onLibrary}
      />
      {roll.access === "limited" && ready && roll.prints.length > 0 ? <LimitedLine held={held} onShareMore={roll.shareMore} /> : null}
      {clipNote}
    </View>
  );

  // Where the roll ends, the room hands on; an empty roll has nothing further back to hand on to.
  const footer = ready && roll.end !== "more" && roll.prints.length > 0 ? <RollFooter held={held} onEnter={openRoom} /> : null;

  return (
    <Screen padded={false}>
      <FlatList
        ref={listRef}
        testID="post-roll"
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item, index }) => (
          <RollRow
            row={item}
            size={size}
            selectedId={selectedId && item.items.some((i) => i.key === selectedId) ? selectedId : null}
            busyId={busyId && item.items.some((i) => i.key === busyId) ? busyId : null}
            cameraBusy={busy?.way === "camera"}
            released={rowReleased(index)}
            held={held}
            dim={dim}
            reduceMotion={reduceMotion}
            onCell={onCell}
            onPost={onCellPost}
            onCamera={onCamera}
          />
        )}
        extraData={[selectedId, busy, held, release, sight, dim]}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={3}
        removeClippedSubviews={false}
        onEndReached={roll.loadMore}
        onEndReachedThreshold={1.5}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onLayout={onListLayout}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

type Way = "photo" | "camera" | "video" | "print";

type Place = { line: string | null; cover: ReturnType<typeof placeCover> };

/** Where the member left off in the room, from its own small file; nothing when it cannot be read. */
function readPlaceFile(): Place {
  try {
    return { line: placeLine(), cover: placeCover() };
  } catch {
    return { line: null, cover: null };
  }
}

/** The page's type stops growing here, as the Memory Room's own word pages do. */
const TYPE_CAP = 2.4;

/**
 * Today, from its first moment, local time: the date On this day reads.
 * It turns over at midnight, and is read again each time the app comes
 * back to the front, since a phone put away overnight holds its timers
 * until then.
 */
function useToday(): number {
  const [today, setToday] = useState(() => startOfDay(Date.now()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A timer that wakes a moment early sets the same day and waits again.
    const turn = () => {
      const now = Date.now();
      setToday(startOfDay(now));
      clearTimeout(timer);
      timer = setTimeout(turn, tomorrow(now) - now);
    };
    turn();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") turn();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);
  return today;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The first moment of the next day, local time, however long a day the clocks make it. */
function tomorrow(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.xxl },
  alone: { paddingHorizontal: spacing.lg, flexDirection: "row" },
  note: { paddingHorizontal: spacing.lg, paddingBottom: 10 },
  noteText: { fontSize: 12, lineHeight: 17, color: colors.inkSoft },
});
