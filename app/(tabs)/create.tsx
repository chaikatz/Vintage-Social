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
import { useFocusEffect, useIsFocused, useNavigation } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "@/components/Screen";
import { useOnline } from "@/components/darkroom/useOnline";
import { DoorPage } from "@/components/post/DoorPage";
import { MountPanel } from "@/components/post/MountPanel";
import { PostPager, type PagerScrollState, type PostPagerHandle } from "@/components/post/PostPager";
import { RollHero } from "@/components/post/RollHero";
import { RollRow } from "@/components/post/RollCell";
import { WaysRow } from "@/components/post/WaysRow";
import { colors } from "@/theme";
import { showAlert } from "@/utils/alert";
import { pickFromLibrary, takeForCompose, type PickedParams } from "@/utils/pickForCompose";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";
import { useReducedMotion } from "@/utils/useReducedMotion";
import { darkroomAvailable } from "@/darkroom/source";
import type { Print } from "@/darkroom/types";
import { onPostAgain } from "@/post/again";
import { discardPrintCopy, openPrint, postHaptic } from "@/post/openPrint";
import { onPageAsked, postPage, setPostPage } from "@/post/pages";
import { panelFor, type PanelAct } from "@/post/panels";
import {
  cellSize,
  GAP,
  HEADER_BELOW,
  NARROW,
  photoRect,
  previewFrame,
  recentHeight,
  rollRows,
  rowsInSight,
  SECOND_TAP_MS,
  wellRows,
  type RollRow as Row,
} from "@/post/roll";
import { createRoomDoor, holdWhileInFront } from "@/post/slide";
import { stampedParams } from "@/post/stamp";
import { useRoll } from "@/post/useRoll";

// A page that breaks as it draws breaks only this tab (src/navigation/Recover.tsx).
export { RecoverPage as ErrorBoundary } from "@/navigation/Recover";

/**
 * Where a post begins, as the owner's mock draws it: the member's own
 * photographs, and the one they tap, large, one tap from the editor.
 *
 * One photograph per post. Short videos are allowed but live in the same
 * feed and grid as everything else — there is no separate video surface.
 *
 * Two pages, side by side, named in the header the tabs share
 * (`PostHeader`): RECENT, which this is, and MEMORY ROOM. Recent, top to
 * bottom: the selected photograph on the paper, in a 4:5 frame 27 points
 * in from either edge, at the shape the editor will post it, with
 * VINTAGE's date stamp on it as its post will carry it; LIBRARY (the
 * iPhone's own picker) and VIDEO at the left of the line under it, POST →
 * at the right; then the roll: newest first, four to a row, edge to edge,
 * the camera first on the iPhone. Every state without a photograph to
 * show (never asked, refused, empty, failed, loading) is a panel in the
 * same frame, so the page keeps one shape.
 *
 * The Memory Room is reached by tapping MEMORY ROOM, or by sliding Recent
 * to the left, deliberately, by the app's own rule on the iPhone and in
 * the browser alike (`PostPager`, `src/post/slide.ts`): a scroll of the
 * roll, a diagonal drift, a tap or a nudge of a few points never moves the
 * page, and a quick short flick moves it a little and lets it go back.
 * Past half the width, or on a clear flick that has already carried it a
 * fifth of the way, the pager comes to rest on the room's door
 * — its own paper, nothing read — and the room is pushed, once, and fades
 * in over it; once the room covers the tab the pager goes back to Recent
 * without animation, so the way back from the room lands here. While the
 * tab is in front the tabs' own pager is held still, so the two never
 * take the same drag: a slide to the left no longer goes to Activity, and
 * one to the right does nothing (the tabs are a tap away).
 *
 * The roll is read from the library only while the tab is in front, and
 * only with the access the member already gave; the tab asks for it only
 * from a tap on its own explanation's CONTINUE. Everything it reads stays
 * on this phone, a bounded page at a time. Ten seconds after the tab is
 * left, and at once when the app goes to the background, it lets go of
 * every photograph out of sight, keeping the rows on the screen and the
 * frame, so the page is just as it was whenever it is seen again
 * (`src/post/useRoll.ts`).
 *
 * Where there is no library to read (Android, a browser outside the
 * demo) there is no room and no roll: the page is the picker's panel, the
 * picker, the clip and the camera, under the plain "Post" title.
 */
export default function Create() {
  const router = useRouter();
  const navigation = useNavigation();
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
  const room = darkroomAvailable();
  const held = busy !== null;
  const focused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const online = useOnline();
  const { width: W, height: windowH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const narrow = W < NARROW;
  const frame = useMemo(() => previewFrame(W, recentHeight(windowH, insets.top, insets.bottom)), [W, windowH, insets.top, insets.bottom]);
  const size = cellSize(W);
  const iosMajor = parseInt(String(Platform.Version), 10);

  const roll = useRoll(focused);

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
        // A photograph of the roll was shown stamped, so the editor starts with the stamp on.
        if (params) router.push({ pathname: "/compose", params: way === "print" ? stampedParams(params) : params });
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

  // The two pages, and the room pushed once from the second.
  const pager = useRef<PostPagerHandle>(null);
  const scrollState = useRef<PagerScrollState>("idle");
  const routerRef = useRef(router);
  routerRef.current = router;
  const [door] = useState(() =>
    createRoomDoor({
      isFront: () => front.current && AppState.currentState === "active",
      push: () => routerRef.current.push("/darkroom"),
      reset: () => pager.current?.setPageWithoutAnimation(0),
      later: (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
    }),
  );
  const toRecent = useCallback(() => {
    if (postPage() !== 0) pager.current?.setPageWithoutAnimation(0);
  }, []);

  // In front: the tabs' pager held still, so only this one slides. Leaving the tab, or the app going
  // to the background, stops a photograph opening; leaving lets the tabs' pager go.
  useFocusEffect(
    useCallback(() => {
      front.current = true;
      const release = holdWhileInFront(room);
      door.focused();
      toRecent();
      return () => {
        front.current = false;
        printStop.current?.abort();
        release();
      };
    }, [door, room, toRecent]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") printStop.current?.abort();
      // Back with the pager left on the door (it came to rest while the app was away, and pushed nothing): Recent.
      else if (state === "active" && door.phase() === "closed") toRecent();
    });
    return () => sub.remove();
  }, [door, toRecent]);

  // The room covers the tabs once its fade is over: the stack says so as the tabs disappear.
  useEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    const listen = parent.addListener as unknown as (type: string, cb: (e: { data?: { closing?: boolean } }) => void) => () => void;
    return listen("transitionEnd", (e) => {
      if (e.data?.closing) door.covered();
    });
  }, [door, navigation]);

  const onPageSelected = useCallback(
    (page: number) => {
      setPostPage(page);
      if (page === 1) door.settled();
    },
    [door],
  );
  const onScrollState = useCallback((state: PagerScrollState) => {
    scrollState.current = state;
  }, []);

  // The header's MEMORY ROOM (and RECENT): only in front, at rest, with nothing opening, and the room not on its way.
  useEffect(
    () =>
      onPageAsked((page) => {
        if (!front.current || opening.current || scrollState.current !== "idle" || door.phase() !== "closed") return;
        if (page === postPage()) return;
        if (reduceMotionRef.current) pager.current?.setPageWithoutAnimation(page);
        else pager.current?.setPage(page);
      }),
    [door],
  );

  /** POST, the photograph in the frame, or a second tap on the selected cell: the editor. */
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
  // Where the frame stands in the list's header, how tall the header is, and how much of the list shows.
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
  const frameW = frame.width;
  const frameH = frame.height;
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
      // With any of it out of view, the photograph is brought up to the frame, with POST under it.
      if (offset.current > heroTop.current + photoRect(print, { width: frameW, height: frameH }).top) toTop();
    },
    [post, select, selection, toTop, frameW, frameH],
  );
  const onCellPost = useCallback(
    (print: Print) => {
      if (opening.current) return;
      select(print.id);
      post(print);
    },
    [post, select],
  );

  // Tapping Post again: Recent, the top, the newest, and the newest page read once.
  const { selectNewest, refresh } = roll;
  useEffect(
    () =>
      onPostAgain(() => {
        if (door.phase() === "closed") toRecent();
        toTop();
        selectNewest();
        refresh();
      }),
    [door, refresh, selectNewest, toRecent, toTop],
  );

  const onCamera = useMemo(() => (native ? () => openWith("camera", takeForCompose) : undefined), [native, openWith]);
  const onVideo = () => openWith("video", () => pickFromLibrary("video"));
  const onLibrary = () => openWith("photo", () => pickFromLibrary("photo"));

  const ready = roll.phase === "ready";
  const more = roll.access === "limited" && roll.prints.length > 0;
  // Rows are made again only when the roll changes, so a row whose photographs did not change is not drawn again.
  const rows = useMemo<Row[]>(
    () => (ready ? rollRows(roll.prints, { camera: ios, more }) : wellRows({ camera: ios })),
    [ready, roll.prints, ios, more],
  );

  const onAct = (act: PanelAct) => {
    if (act === "ask") roll.ask();
    else if (act === "shareMore") roll.shareMore();
    else if (act === "retry") roll.retry();
    else void openWith("photo", () => pickFromLibrary("photo"));
  };

  const ways = busy && busy.way !== "print" ? busy.way : null;
  const panel = panelFor({ available: room, phase: roll.phase, access: roll.access, empty: roll.prints.length === 0 });
  // The clip's limit, where no trimmer holds a clip to it.
  const clipNote =
    Platform.OS !== "ios" ? (
      <View style={[styles.note, { marginLeft: frame.left, width: frame.width }]} pointerEvents="none">
        <Text testID="post-clip-note" style={styles.noteText} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
          Clips up to {MAX_VIDEO_SECONDS} seconds.
        </Text>
      </View>
    ) : null;

  // What stays drawn when the tab lets go of what is out of sight: the rows on the screen, one
  // either side, and the frame when it shows — read from where the list stood as it was let go.
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

  if (!room) {
    return (
      <Screen padded={false} scroll>
        <View style={styles.below} />
        <MountPanel
          kind="unavailable"
          iosMajor={iosMajor}
          frame={frame}
          narrow={narrow}
          busy={ways === "photo"}
          held={held}
          onAct={onAct}
          onOpenSettings={roll.openSettings}
        />
        <WaysRow
          frame={frame}
          camera={native}
          canPost={false}
          posting={false}
          busy={ways}
          held={held}
          onLibrary={onLibrary}
          onVideo={onVideo}
          onCamera={onCamera}
          onPost={noop}
        />
        {clipNote}
      </Screen>
    );
  }

  const dim = roll.phase === "undetermined" || roll.phase === "denied";
  const selectedId = roll.selected?.id ?? null;
  const busyId = busy?.way === "print" ? (busy.id ?? null) : null;
  const shown = panel === null ? roll.selected : null;

  const header = (
    <View onLayout={onHeaderLayout}>
      <View onLayout={onMountLayout}>
        {shown ? (
          <RollHero
            print={shown}
            frame={frame}
            held={held}
            released={heroLetGo}
            heroReleased={roll.heroReleased}
            reduceMotion={reduceMotion}
            focused={focused}
            online={online}
            onPost={() => roll.selected && post(roll.selected)}
          />
        ) : (
          <MountPanel
            kind={panel ?? "loading"}
            iosMajor={iosMajor}
            frame={frame}
            narrow={narrow}
            busy={roll.asking}
            held={held}
            onAct={onAct}
            onOpenSettings={roll.openSettings}
          />
        )}
      </View>
      <WaysRow
        frame={frame}
        camera={false}
        canPost={shown != null}
        posting={busy?.way === "print"}
        busy={ways}
        held={held}
        onLibrary={onLibrary}
        onVideo={onVideo}
        onPost={() => roll.selected && post(roll.selected)}
      />
      {clipNote}
    </View>
  );

  return (
    <Screen padded={false}>
      {/* The header's band reaches this far into the page: its two words are centred over it. */}
      <View style={styles.below} />
      <PostPager ref={pager} scrollEnabled={!held} onPageSelected={onPageSelected} onScrollState={onScrollState}>
        <View key="recent" style={styles.page} collapsable={false}>
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
                onShareMore={roll.shareMore}
              />
            )}
            extraData={[selectedId, busy, held, release, sight, dim]}
            ListHeaderComponent={header}
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
        </View>
        <View key="door" style={styles.page} collapsable={false}>
          <DoorPage />
        </View>
      </PostPager>
    </Screen>
  );
}

type Way = "photo" | "camera" | "video" | "print";

const noop = () => undefined;

/** The page's type stops growing here, as the Memory Room's own word pages do. */
const TYPE_CAP = 2.4;

const styles = StyleSheet.create({
  below: { height: HEADER_BELOW },
  page: { flex: 1 },
  list: { paddingBottom: 32 },
  note: { paddingBottom: 10 },
  noteText: { fontSize: 12, lineHeight: 17, color: colors.inkSoft },
});
