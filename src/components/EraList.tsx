import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { colors, spacing, type } from "@/theme";
import { NO_EDITS, cleanEraTitle, editedEraSummary, type EditedEra, type EraEdits } from "@/utils/eraEdits";
import { reducedMotion, useReducedMotion } from "@/utils/useReducedMotion";
import { holdTabSwipe } from "@/utils/tabSwipe";
import type { EraEditor } from "@/hooks/useEraEdits";
import { EmptyState } from "./EmptyState";
import { PhotoTile } from "./PhotoGrid";
import { aspectRatio } from "./PostMedia";
import { GridSkeleton } from "./Skeleton";
import { EraMoveSheet } from "./EraMoveSheet";
import { askEraName, canNameEras, confirmDeleteEra } from "./eraName";
import {
  addedNote,
  deletedNote,
  eraSheetView,
  madeNote,
  movedNote,
  takenOutNote,
  type EraSheetState,
} from "./eraSheet";
import {
  LIFT_MS,
  LIFT_SCALE,
  armedSpeed,
  dropLabel,
  dropTarget,
  eraUnderFinger,
  reached,
  scrolledTo,
  type ChapterBox,
  type DragPage,
  type Reach,
} from "./eraDrag";
import {
  ERA_RULE,
  ERA_STRIP,
  PRINT_GAP,
  chapterAt,
  chaptersNear,
  depthAfter,
  eraHeading,
  eraMeta,
  eraMore,
  eraSpanSpoken,
  eraStrip,
  erasEmpty,
  erasFootnote,
  eraWhole,
  leadPrint,
  printLabel,
  type ChapterPlace,
  type ChapterSpan,
} from "./eraBook";
import type { PostRow } from "@/types/db";

/** How long the line that says where a photograph went stays up. */
const NOTE_MS = 2400;

/**
 * A print being dragged, as the gesture knows it: on the screen, in window
 * points, but for the chapters and the bar, which are in the page's own.
 */
interface Drag {
  /** Which lift this is, so a print put back from an earlier one never takes this one's copy with it. */
  id: number;
  post: PostRow;
  /** The era it is in, by key. */
  from: string;
  /** Where the finger was as the print lifted, and where it is now. */
  start: { x: number; y: number };
  finger: { x: number; y: number };
  /** How far the finger has gone above and below where it lifted: the page runs on at an edge only once the finger has meant it to. */
  reach: Reach;
  /** The view the page scrolls in, on the screen; null until it has been measured. */
  view: { y: number; height: number } | null;
  /** Each chapter where it lies in the page, as it answers. */
  chapters: Map<string, ChapterBox>;
  bar: { top: number; height: number } | null;
  /** How far the page is scrolled now, and was as the print lifted. */
  offset: number;
  liftedAt: number;
  /** The era it would go to, let go now. */
  over: string | null;
  /** The page has taken the gesture over from the print. */
  claimed: boolean;
  /** The frame the page runs on in, near an edge, and when the last one was. */
  frame: number | null;
  last: number;
}

/** A print held to be lifted: the photograph, its view, and the tile's own size, which its view may be wider than. */
interface Held {
  post: PostRow;
  view: View | null;
  width: number;
  height: number;
  /** Drawn from the photograph itself, as a lead near the screen is. */
  full: boolean;
}

/** The copy that follows the finger: the print, and where it lay, from the top left of the page's view. */
interface Lifted {
  id: number;
  post: PostRow;
  full: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Where the slip saying where it would go sits as it lifts: a little above the finger, clear of the thumb. */
  slipTop: number;
}

/** How far above the finger that slip sits. */
const SLIP_ABOVE = 56;

interface Props {
  /** The member's own photographs. Never the ones they were tagged in: those are not theirs to gather. */
  posts: PostRow[];
  /** The member's own names for their eras and the photographs they moved; the eras are drawn as they left them. */
  edits?: EraEdits;
  /** Your own page, once your arrangement has been read: the eras can be renamed and their photographs moved. Never on a member's. */
  editor?: EraEditor;
  /** A print was tapped, in the era of that key (its automatic title, which a rename does not change). */
  onOpenPost: (post: PostRow, era: string) => void;
  /** Rendered above the eras (profile header). */
  header?: React.ReactElement;
  /** Whose page this is, for the words when there is nothing to show; omitted on your own. */
  member?: string;
  /** The photographs have not arrived yet. */
  loading?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * A member's photographs read as eras: a place and a year, or a season and
 * a year, gathered exactly as On this day gathers them (`groupEras`), then
 * named and arranged as the member left them (`editEras`).
 *
 * Laid out like the chapters of a photographic book. Each era opens on its
 * name in the quiet serif, with the months it ran and how many photographs
 * it holds beneath in tracked mono; then its newest photograph as a lead
 * print, larger and at its own proportions; then a short strip of the next
 * few in the familiar squares, with the rest a tap away, opened in place.
 * Hairlines part the chapters, and the newest era comes first.
 *
 * What the eras leave out is said at the foot, as the map says what it
 * could not place: photographs with no capture date, and those alone in
 * their place and year. Every print is drawn as the grid draws it
 * (PhotoTile), filtered and postered alike, from the grid's small copy.
 * Only a lead is drawn larger than that copy stays sharp at, so once its
 * chapter comes within a screen of view, a photograph's lead is drawn
 * from the photograph itself; chapters far down the page never load it.
 *
 * On your own page (`editor`), a quiet EDIT over the chapters opens them
 * for arranging, and holds on as you scroll. Each era's name takes a
 * RENAME and an ADD beside it, every print is laid out and marked MOVE,
 * and a tap on one asks which era it belongs in (EraMoveSheet) instead of
 * opening the gallery: any era, back out of one a move put it in, or a
 * new one. ADD gathers photographs into an era from anywhere else, several
 * at once, and NEW ERA, in the bar, makes one of the member's own, named
 * and with its photographs; it takes its place among the others by date.
 * The change is on the page at once, and a line at the foot of the screen
 * says what was done. DONE closes it again, on the chapter the reader was
 * at however far down they had gone. Outside it, nothing differs from a
 * member's page but the EDIT.
 *
 * Held a moment, a print being arranged lifts and can be dragged to
 * another era instead (eraDrag): a copy follows the finger, the era under
 * it is framed and named, and the page runs on while the finger is near
 * its top or foot. Let go over another era, the photograph moves there as
 * the sheet would move it; anywhere else, or cut short, it goes back as it
 * was. The drag is a shortcut for the hand. A drag across a long page of
 * chapters is easy to drop in the wrong one, and a list says exactly where
 * a photograph will land, so the sheet and ADD stay the way every change
 * is made, and the way VoiceOver is offered.
 */
export function EraList({ posts, edits, editor, onOpenPost, header, member, loading, onRefresh, refreshing }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const still = useReducedMotion();
  // The strip's squares span the page between its margins; the lead is
  // measured in them.
  const cell = (width - spacing.lg * 2 - PRINT_GAP * (ERA_STRIP - 1)) / ERA_STRIP;

  const arranged = edits ?? NO_EDITS;
  const summary = useMemo(() => editedEraSummary(posts, arranged), [posts, arranged]);
  const empty = erasEmpty(summary, member);
  const footnote = erasFootnote(summary);

  // Arranging, on your own page only, and only while there is an era to arrange.
  const [editing, setEditing] = useState(false);
  const arranging = editing && editor != null && summary.eras.length > 0;
  // The sheet a change is made in, and what it shows as the arrangement stands.
  const [sheet, setSheet] = useState<EraSheetState | null>(null);
  const view = useMemo(() => eraSheetView(posts, arranged, sheet), [sheet, posts, arranged]);
  // An era ADD was for that has gone from the page takes its sheet with it, never to come back up on its own.
  useEffect(() => {
    if (sheet && !view) setSheet(null);
  }, [sheet, view]);

  // Eras opened in place, by key (keys are unique; names a member gives need not be).
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Where each chapter lies down the page, and how far it is scrolled:
  // the chapters near the screen, by key, have their leads drawn full.
  const spans = useRef(new Map<string, ChapterSpan>());
  const offset = useRef(0);
  const [near, setNear] = useState<ReadonlySet<string>>(() => new Set());
  const look = () => setNear((prev) => chaptersNear(prev, spans.current, offset.current, height));
  // As the page scrolls, no oftener than scrollEventThrottle outside
  // arranging, and once more as each scroll comes to rest, where a phone
  // says nothing more of its own: a print lifted after it starts from
  // where the page is, never from a place it had already passed.
  const scrolled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
    look();
  };

  // EDIT lays every print out and DONE puts them away again, so each
  // chapter above the reader grows or shrinks by rows. The place at the
  // top of their view as they tap (under the bar, while it holds to the
  // top) is measured again once the page has been laid out, and put back
  // at the top: as far into its chapter as they were, or the chapter's
  // own top where it has closed up (depthAfter). They are left where they
  // were, not some chapters on.
  //
  // The first chapter's top as the reader taps, and how far the bar
  // reaches down the screen each time, are measured as they lie then,
  // never taken from what they last reported: the web reports a view's
  // place only when its size changes, so the first chapter's can be from
  // before the bar grew or shrank above it, and the bar tells how tall
  // arranging has made it only after the reader has been put back (on the
  // web, which sets it in a new holder as it begins to hold to the top,
  // not at all). The
  // web answers measures a moment later, in the order they were asked;
  // React Native answers at once. Either way the bar's is in hand by the
  // next.
  const scroller = useRef<ScrollView>(null);
  const pages = useRef(new Map<string, View>());
  const bar = useRef<View>(null);
  const anchor = useRef<ChapterPlace | null>(null);
  const arrange = (on: boolean) => {
    const keys = summary.eras.map((era) => era.key);
    const first = pages.current.get(keys[0]);
    const book = innerView(scroller.current);
    let under = 0;
    let held = false;
    // Once: with the place, when the first chapter has been measured, or
    // without it, when it cannot be or goes unanswered (the timer runs
    // after the web's answer, and long after React Native's), so the tap
    // is never lost.
    const hold = (top?: number) => {
      if (held) return;
      held = true;
      anchor.current = top == null ? null : chapterAt(keys, spans.current, top, offset.current + under);
      setEditing(on);
    };
    if (!first || !book) return hold();
    if (arranging) bar.current?.measureLayout(book, (_x, _y, _width, tall) => (under = tall));
    first.measureLayout(book, (_x, top) => hold(top), () => hold());
    setTimeout(() => hold(), 0);
  };
  useLayoutEffect(() => {
    const place = anchor.current;
    anchor.current = null;
    const era = place ? summary.eras.find((e) => e.key === place.key) : undefined;
    const page = place ? pages.current.get(place.key) : undefined;
    const book = innerView(scroller.current);
    if (!place || !era || !page || !book) return;
    let under = 0;
    if (arranging) bar.current?.measureLayout(book, (_x, _y, _width, tall) => (under = tall));
    // Arranging lays every photograph out; after DONE, only an era opened, or one the strip holds whole.
    const whole = arranging || eraWhole(era, open.has(era.key));
    page.measureLayout(book, (_x, top, _width, tall) =>
      scroller.current?.scrollTo({ y: Math.max(0, top + depthAfter(place, tall, whole) - under), animated: false }),
    );
  }, [arranging]);

  // The line that says where a photograph went, faded in and out (cut in
  // and out under Reduce Motion). Each move puts it up afresh, even to the
  // same era twice.
  const [note, setNote] = useState<{ words: string; at: number } | null>(null);
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!note) return;
    const native = Platform.OS !== "web";
    shown.setValue(still ? 1 : 0);
    if (!still) Animated.timing(shown, { toValue: 1, duration: 160, useNativeDriver: native }).start();
    const t = setTimeout(() => {
      if (still) setNote(null);
      else Animated.timing(shown, { toValue: 0, duration: 220, useNativeDriver: native }).start(() => setNote(null));
    }, NOTE_MS);
    return () => clearTimeout(t);
  }, [note, still, shown]);
  // Said aloud as well. The web has no announceForAccessibility (react-native-web's
  // does nothing), so there a polite live region, always on the page, says it instead.
  const [spoken, setSpoken] = useState<{ words: string; at: number } | null>(null);
  const announce = (words: string) => {
    AccessibilityInfo.announceForAccessibility(words);
    if (Platform.OS === "web") setSpoken({ words, at: Date.now() });
  };
  const say = (words: string) => {
    setNote({ words, at: Date.now() });
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => undefined);
    announce(words);
  };

  // Each change is said only when the editor made it: not of a photograph
  // gone from the page since the sheet opened, nor of one already there.
  // A move is the same from the sheet or a print let go over another era.
  const moveTo = (post: PostRow, key: string, title: string): boolean => {
    if (!editor?.move(post, key)) return false;
    say(movedNote(title));
    return true;
  };
  const move = (key: string) => {
    const shown = view;
    setSheet(null);
    if (shown?.kind !== "move" || !editor) return;
    const to = shown.choices.find((c) => c.key === key && !c.newEra);
    if (!to) return;
    moveTo(shown.post, key, to.title);
  };
  const takeOut = () => {
    const shown = view;
    setSheet(null);
    if (shown?.kind !== "move" || !shown.out || !editor) return;
    if (editor.takeOut(shown.post)) say(takenOutNote(shown.out));
  };
  const add = (photoIds: string[]) => {
    const shown = view;
    setSheet(null);
    if (shown?.kind !== "add" || !editor) return;
    if (editor.add(shown.key, photoIds)) say(addedNote(photoIds.length, shown.title));
  };
  const create = (name: string, photoIds: string[]) => {
    setSheet(null);
    if (editor?.create(name, photoIds)) say(madeNote(name));
  };
  // "New era…" turns Move to over to a new era, with the photograph already chosen.
  const newEra = () => setSheet((now) => (now?.kind === "move" ? { kind: "new", chosen: [now.post.id] } : now));
  const remove = (era: EditedEra<PostRow>) => {
    if (editor?.deleteEra(era.key)) say(deletedNote(era.title));
  };
  const rename = (era: EditedEra<PostRow>) =>
    askEraName(
      era,
      (title) => {
        editor?.rename(era.key, title);
        // An era the member made keeps its name when given none: it has no automatic one.
        announce(`Named ${cleanEraTitle(title ?? "") || (era.made ? era.title : era.key)}`);
      },
      () => remove(era),
    );

  // Dragging a print to another era, while arranging. Held for LIFT_MS, a
  // print lifts: a copy follows the finger and the print waits, dimmed, in
  // its place. The page takes the gesture over from the print on the first
  // move, and never before, so a touch, a scroll and a pull to refresh go
  // on as ever; from then it holds still under the finger, as do the tabs,
  // but for running on near its top and foot. Let go over another era, the
  // photograph moves there (moveTo, as from the sheet); anywhere else, over
  // its own era, or cut short (another finger, the phone taking the touch),
  // it goes back as it was.
  //
  // Where the chapters and the bar lie is measured as the print lifts, as
  // EDIT measures them, never taken from what they last reported; nothing
  // the drag changes moves them, so the page's scroll is all that changes
  // under the finger.
  const root = useRef<View>(null);
  const contentTall = useRef(0);
  const drag = useRef<Drag | null>(null);
  const lifts = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [lifted, setLifted] = useState<Lifted | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const pan = useRef(new Animated.ValueXY()).current;
  const raise = useRef(new Animated.Value(1)).current;

  const pageOf = (d: Drag): DragPage => ({
    chapters: [...d.chapters.values()],
    bar: d.bar,
    offset: d.offset,
    height: d.view?.height ?? 0,
  });
  // The era under the finger, framed and named while it is another era than the print's own.
  const aim = () => {
    const d = drag.current;
    if (!d?.view) return;
    const to = dropTarget(d.from, eraUnderFinger(pageOf(d), d.finger.y - d.view.y));
    if (to === d.over) return;
    d.over = to;
    setOver(to);
  };
  // Near the top of the view, under the bar, or near its foot, the page runs
  // on a frame at a time: at an edge the print lifted near, only once the
  // finger has gone on toward it, or been clear of it (armedSpeed).
  const run = (now: number) => {
    const d = drag.current;
    if (!d) return;
    const ms = d.last ? now - d.last : 16;
    d.last = now;
    if (d.view) {
      const speed = armedSpeed(d.finger.y - d.view.y, d.start.y - d.view.y, d.reach, { top: d.bar?.height ?? 0, bottom: d.view.height });
      const next = scrolledTo(d.offset, speed, ms, contentTall.current - d.view.height);
      if (next !== d.offset) {
        d.offset = next;
        scroller.current?.scrollTo({ y: next, animated: false });
        aim();
      }
    }
    d.frame = requestAnimationFrame(run);
  };
  const lift = (held: Held, from: string, e: GestureResponderEvent) => {
    const book = innerView(scroller.current);
    const page = root.current;
    const print = held.view;
    if (!arranging || drag.current || !print || !book || !page) return;
    const id = (lifts.current += 1);
    const at = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    const d: Drag = {
      id,
      post: held.post,
      from,
      start: at,
      finger: at,
      reach: { up: 0, down: 0 },
      view: null,
      chapters: new Map(),
      bar: null,
      offset: offset.current,
      liftedAt: offset.current,
      over: null,
      claimed: false,
      frame: null,
      last: 0,
    };
    drag.current = d;
    // The bar is asked first, so its height is in hand by the first chapter's
    // answer: it lies just above that chapter, wherever it is held now.
    const keys = summary.eras.map((era) => era.key);
    let under = 0;
    bar.current?.measureLayout(book, (_x, _y, _width, tall) => (under = tall));
    keys.forEach((key, i) =>
      pages.current.get(key)?.measureLayout(book, (_x, top, _width, tall) => {
        if (drag.current !== d) return;
        d.chapters.set(key, { key, top, height: tall });
        if (i === 0) d.bar = { top: top - under, height: under };
      }),
    );
    // The copy is drawn at the tile's own size, from where its view begins.
    page.measureInWindow((x, y, _width, tall) => {
      if (drag.current !== d) return;
      d.view = { y, height: tall };
      print.measureInWindow((px, py) => {
        if (drag.current !== d) return;
        const { post, full, width: w, height: h } = held;
        setLifted({ id, post, full, left: px - x, top: py - y, width: w, height: h, slipTop: at.y - y - SLIP_ABOVE });
      });
    });
    pan.setValue({ x: 0, y: 0 });
    if (reducedMotion.get()) raise.setValue(LIFT_SCALE);
    else {
      raise.setValue(1);
      Animated.timing(raise, { toValue: LIFT_SCALE, duration: 140, useNativeDriver: false }).start();
    }
    setDragging(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  };
  const follow = (x: number, y: number) => {
    const d = drag.current;
    if (!d) return;
    d.finger = { x, y };
    d.reach = reached(d.reach, d.start.y, y);
    pan.setValue({ x: x - d.start.x, y: y - d.start.y });
    aim();
  };
  // The page has the gesture: the frames begin.
  const take = () => {
    const d = drag.current;
    if (!d) return;
    d.claimed = true;
    d.last = 0;
    if (d.frame == null) d.frame = requestAnimationFrame(run);
  };
  // The drag over: the page scrolls again, the frame goes, and the copy is left to be put away.
  const release = (): Drag | null => {
    const d = drag.current;
    if (!d) return null;
    drag.current = null;
    if (d.frame != null) cancelAnimationFrame(d.frame);
    setDragging(false);
    setOver(null);
    return d;
  };
  // The copy back to its print, wherever the page has carried it, and the print in its place again; at once under Reduce Motion.
  const putBack = (d: Drag) => {
    const gone = () => setLifted((now) => (now?.id === d.id ? null : now));
    if (reducedMotion.get()) return gone();
    // Brisk, and at rest within half a point, so the print is itself again as soon as the eye has it back.
    const spring = { damping: 40, stiffness: 500, mass: 1, useNativeDriver: false };
    Animated.parallel([
      Animated.spring(pan, { ...spring, toValue: { x: 0, y: d.liftedAt - d.offset }, restDisplacementThreshold: 0.5, restSpeedThreshold: 10 }),
      Animated.spring(raise, { ...spring, toValue: 1, restSpeedThreshold: 0.01 }),
    ]).start(gone);
  };
  const cancel = () => {
    const d = release();
    if (d) putBack(d);
  };
  const drop = () => {
    const d = drag.current;
    if (!d) return;
    aim();
    const era = d.over ? summary.eras.find((e) => e.key === d.over) : undefined;
    release();
    if (era && moveTo(d.post, era.key, era.title)) setLifted((now) => (now?.id === d.id ? null : now));
    else putBack(d);
  };
  // A print let go before the page took the gesture (held, never moved) goes back.
  const letGo = () => {
    if (drag.current && !drag.current.claimed) cancel();
  };
  // The responder is made once; it reaches the latest render's drag through `act`.
  const act = useRef({ take, follow, drop, cancel });
  act.current = { take, follow, drop, cancel };
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Nothing but a print already lifted, on the first move after: the print gives it up.
        onMoveShouldSetPanResponderCapture: () => {
          const d = drag.current;
          if (!d || d.claimed) return false;
          d.claimed = true;
          return true;
        },
        onPanResponderReject: () => {
          if (drag.current) drag.current.claimed = false;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => act.current.take(),
        onPanResponderStart: (_e, g) => {
          if (g.numberActiveTouches > 1) act.current.cancel();
        },
        onPanResponderMove: (_e, g) => {
          if (g.numberActiveTouches > 1) act.current.cancel();
          else act.current.follow(g.moveX, g.moveY);
        },
        onPanResponderRelease: () => act.current.drop(),
        onPanResponderTerminate: () => act.current.cancel(),
      }),
    [],
  );
  // Arranging over (DONE, or the editor gone), the drag goes with it; and nothing runs on once the page has gone.
  useEffect(() => {
    if (!arranging) act.current.cancel();
  }, [arranging]);
  useEffect(
    () => () => {
      const d = drag.current;
      drag.current = null;
      if (d?.frame != null) cancelAnimationFrame(d.frame);
    },
    [],
  );
  // The tabs hold still while a print is dragged, as they do for a pinch.
  useEffect(() => (dragging ? holdTabSwipe() : undefined), [dragging]);
  // The browser drags a photograph off the page itself once the mouse moves
  // with it held, and takes the mouse from the page to do so; while
  // arranging, a print's photograph stays where it is.
  useEffect(() => {
    if (Platform.OS !== "web" || !arranging) return;
    const page = root.current as unknown as { contains?: (node: unknown) => boolean } | null;
    const keep = (e: Event) => {
      if (!page?.contains?.(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("dragstart", keep, true);
    return () => window.removeEventListener("dragstart", keep, true);
  }, [arranging]);
  const overTitle = over ? summary.eras.find((e) => e.key === over)?.title : undefined;

  // While arranging, the bar over the chapters holds to the top of the page.
  // Outside it the list of what holds is empty, never absent: the web lays
  // the page's children out afresh, header and chapters, when one comes
  // and goes.
  const barIndex = header ? 1 : 0;

  return (
    <View ref={root} collapsable={false} style={styles.root} {...responder.panHandlers}>
      <ScrollView
        ref={scroller}
        style={styles.root}
        contentContainerStyle={{ paddingBottom: Math.max(spacing.xxl * 2, insets.bottom + spacing.xxl) }}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={colors.inkFaint} /> : undefined}
        onScroll={scrolled}
        onScrollEndDrag={scrolled}
        onMomentumScrollEnd={scrolled}
        onContentSizeChange={(_width, tall) => (contentTall.current = tall)}
        scrollEventThrottle={100}
        scrollEnabled={!dragging}
        stickyHeaderIndices={arranging ? [barIndex] : []}
      >
        {header}
        {editor && !loading && summary.eras.length > 0 ? (
          // Measured by the view that holds to the top: React Native moves a
          // sticky child's own style onto the holder it wraps it in, so the
          // padding and the rule sit one view in, and the bar measures whole.
          <View ref={bar} collapsable={false}>
            <View style={[styles.bar, arranging && styles.barOn]}>
              <View style={styles.barLine}>
                <Text style={styles.barLabel}>{arranging ? "Arranging" : summary.eras.length === 1 ? "1 era" : `${summary.eras.length} eras`}</Text>
                <View style={styles.barRule} />
                {arranging ? (
                  <Pressable
                    onPress={() => setSheet({ kind: "new", chosen: [] })}
                    hitSlop={12}
                    style={({ pressed }) => pressed && styles.pressed}
                    accessibilityRole="button"
                    accessibilityLabel="New era"
                    accessibilityHint="Name an era of your own, and choose its photographs."
                    testID="eras-new"
                  >
                    <Text style={styles.barAction}>New era</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => arrange(!arranging)}
                  hitSlop={12}
                  style={({ pressed }) => pressed && styles.pressed}
                  accessibilityRole="button"
                  accessibilityLabel={arranging ? "Done arranging eras" : "Edit eras"}
                  accessibilityHint={arranging ? undefined : "Rename your eras, make new ones, and move photographs between them."}
                  testID="eras-edit"
                >
                  <Text style={styles.barAction}>{arranging ? "Done" : "Edit"}</Text>
                </Pressable>
              </View>
              {arranging ? (
                <Text style={styles.barHint}>
                  {canNameEras
                    ? "Rename an era or add to it. Tap a photograph to move it, or hold it and drag."
                    : "Add to an era. Tap a photograph to move it, or hold it and drag."}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
        {loading ? (
          <GridSkeleton />
        ) : empty ? (
          <EmptyState title={empty.title} body={empty.body} />
        ) : (
          <>
            {summary.eras.map((era, i) => (
              <Chapter
                key={era.key}
                era={era}
                first={i === 0}
                cell={cell}
                expanded={open.has(era.key)}
                near={near.has(era.key)}
                arranging={arranging}
                lifted={lifted?.post.id ?? null}
                target={over === era.key}
                onToggle={() => toggle(era.key)}
                onOpen={(post) => (arranging ? setSheet({ kind: "move", post }) : onOpenPost(post, era.key))}
                onRename={() => rename(era)}
                onAdd={() => setSheet({ kind: "add", key: era.key })}
                onDelete={() => confirmDeleteEra(era.title, () => remove(era))}
                onLift={(held, e) => lift(held, era.key, e)}
                onLetGo={letGo}
                pageRef={(node) => {
                  if (node) pages.current.set(era.key, node);
                  else pages.current.delete(era.key);
                }}
                onLayout={(e) => {
                  const { y, height: tall } = e.nativeEvent.layout;
                  spans.current.set(era.key, { top: y, height: tall });
                  look();
                }}
              />
            ))}
            {footnote ? (
              <View style={styles.foot}>
                <View style={styles.rule} />
                <Text style={styles.counts}>{footnote}</Text>
                <Text style={styles.rulebook}>{ERA_RULE}</Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      {lifted ? (
        // The print in hand, over everything on the page, a little larger and
        // on a shadow; and, once it is over another era, a slip a little above
        // the finger saying which, across the middle of the screen so it is
        // never cut off at a side. For the eye alone: the sheet says the same
        // to VoiceOver.
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.lifted,
              {
                left: lifted.left,
                top: lifted.top,
                width: lifted.width,
                height: lifted.height,
                transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: raise }],
              },
            ]}
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID="era-drag-print"
          >
            <PhotoTile post={lifted.post} size={lifted.width} height={lifted.height} full={lifted.full} onPress={() => undefined} />
          </Animated.View>
          {overTitle ? (
            <Animated.View
              pointerEvents="none"
              style={[styles.slipRow, { top: lifted.slipTop, transform: [{ translateY: pan.y }] }]}
              aria-hidden
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID="era-drag-slip"
            >
              <View style={styles.slip}>
                <Text style={styles.noteText} numberOfLines={1}>
                  {dropLabel(overTitle)}
                </Text>
              </View>
            </Animated.View>
          ) : null}
        </>
      ) : null}
      {note ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.note, { bottom: Math.max(insets.bottom, spacing.lg), opacity: shown }]}
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={styles.noteText} numberOfLines={1}>
            {note.words}
          </Text>
        </Animated.View>
      ) : null}
      {editor && Platform.OS === "web" ? (
        // Keyed by when, so the same words said twice are said twice.
        <View style={styles.spoken} aria-live="polite">
          {spoken ? <Text key={spoken.at}>{spoken.words}</Text> : null}
        </View>
      ) : null}
      {editor ? (
        <EraMoveSheet
          view={view}
          onMove={move}
          onTakeOut={takeOut}
          onNewEra={newEra}
          onAdd={add}
          onCreate={create}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </View>
  );
}

function Chapter({
  era,
  first,
  cell,
  expanded,
  near,
  arranging,
  lifted,
  target,
  onToggle,
  onOpen,
  onRename,
  onAdd,
  onDelete,
  onLift,
  onLetGo,
  pageRef,
  onLayout,
}: {
  era: EditedEra<PostRow>;
  first: boolean;
  cell: number;
  expanded: boolean;
  /** On the screen or within a screen of it, now or before: the lead is drawn full. */
  near: boolean;
  /** Being arranged: every print laid out, each one moved by a tap or a drag, the name renamed, and photographs added. */
  arranging: boolean;
  /** The photograph lifted to be dragged, by id, wherever it is. */
  lifted: string | null;
  /** The era a lifted print would go to, let go now. */
  target: boolean;
  onToggle: () => void;
  onOpen: (post: PostRow) => void;
  onRename: () => void;
  /** ADD: photographs from anywhere else, gathered into this era. */
  onAdd: () => void;
  /** An era the member made, deleted, where its name cannot be asked for (and so Delete era with it). */
  onDelete: () => void;
  /** A print held while arranging, to be dragged, and the touch that held it. */
  onLift: (held: Held, e: GestureResponderEvent) => void;
  /** A held print let go. */
  onLetGo: () => void;
  /** The chapter's own view, so where it lies can be measured. */
  pageRef: (node: View | null) => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  const [lead] = era.posts;
  const leadSize = leadPrint(aspectRatio(lead.width, lead.height), cell);
  // Arranging, every photograph is out on the page, so any can be moved.
  const strip = eraStrip(era, expanded || arranging);
  const rows: PostRow[][] = [];
  for (let i = 0; i < strip.length; i += ERA_STRIP) rows.push(strip.slice(i, i + ERA_STRIP));
  const more = arranging ? null : eraMore(era, expanded);
  const print = { arranging, onOpen, onLift, onLetGo };

  return (
    <View ref={pageRef} style={[styles.chapter, first && styles.chapterFirst]} onLayout={onLayout}>
      {target ? (
        // Behind the chapter, so the prints are not washed; it moves nothing.
        <View
          style={[styles.target, first && styles.targetFirst]}
          pointerEvents="none"
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="era-drop-target"
        >
          <View style={styles.targetWash} />
        </View>
      ) : null}
      {first ? null : <View style={styles.rule} />}
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header" accessibilityLabel={eraHeading(era)}>
          {era.title}
        </Text>
        {arranging && canNameEras ? (
          <Pressable
            onPress={onRename}
            hitSlop={12}
            style={({ pressed }) => [styles.rename, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Rename ${era.title}`}
            accessibilityHint={
              era.made ? "Renames this era of yours, or deletes it." : era.renamed ? `Its automatic name is ${era.key}.` : "Gives this era a name of your own."
            }
          >
            <Text style={styles.renameText}>Rename</Text>
          </Pressable>
        ) : null}
        {arranging && !canNameEras && era.made ? (
          <Pressable
            onPress={onDelete}
            hitSlop={12}
            style={({ pressed }) => [styles.rename, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${era.title}`}
            accessibilityHint="Its photographs go back where they were."
          >
            <Text style={styles.renameText}>Delete</Text>
          </Pressable>
        ) : null}
        {arranging ? (
          <Pressable
            onPress={onAdd}
            hitSlop={12}
            style={({ pressed }) => [styles.rename, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Add to ${era.title}`}
            accessibilityHint="Choose photographs of yours to add to this era."
          >
            <Text style={styles.renameText}>Add</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.meta} accessibilityLabel={eraSpanSpoken(era)}>
        {eraMeta(era)}
      </Text>
      <View style={styles.prints}>
        <Print post={lead} size={leadSize.width} height={leadSize.height} full={near} dim={lifted === lead.id} {...print} />
        {rows.map((row, i) => (
          <View key={i} style={styles.strip}>
            {row.map((post) => (
              <Print key={post.id} post={post} size={cell} dim={lifted === post.id} {...print} />
            ))}
          </View>
        ))}
      </View>
      {more ? (
        <Pressable
          onPress={onToggle}
          hitSlop={10}
          style={styles.more}
          accessibilityRole="button"
          accessibilityLabel={more.label}
          accessibilityState={{ expanded }}
        >
          <Text style={styles.moreText}>{more.text}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A print as it lies on the page; being arranged, it carries a small MOVE
 * in its top corner, and held a moment it lifts to be dragged, dimmed in
 * its place while it is. The same view holds it either way, so EDIT and
 * DONE never draw a photograph afresh. MOVE is for the eye: VoiceOver
 * hears it in the print's own hint, and moves it from the sheet a tap
 * opens.
 */
function Print({
  post,
  size,
  height,
  full,
  dim,
  arranging,
  onOpen,
  onLift,
  onLetGo,
}: {
  post: PostRow;
  size: number;
  height?: number;
  full?: boolean;
  /** Lifted, and being dragged. */
  dim: boolean;
  arranging: boolean;
  onOpen: (post: PostRow) => void;
  onLift: (held: Held, e: GestureResponderEvent) => void;
  onLetGo: () => void;
}) {
  const self = useRef<View>(null);
  const hint = arranging ? "Moves it to another era." : undefined;
  return (
    <View ref={self} collapsable={false} style={dim && styles.left}>
      <PhotoTile
        post={post}
        size={size}
        height={height}
        full={full}
        onPress={() => onOpen(post)}
        onLongPress={arranging ? (e) => onLift({ post, view: self.current, width: size, height: height ?? size, full: full === true }, e) : undefined}
        delayLongPress={LIFT_MS}
        onPressOut={arranging ? onLetGo : undefined}
        accessibilityLabel={printLabel(post)}
        accessibilityHint={hint}
      />
      {arranging ? (
        <View style={styles.mark} pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.markText}>Move</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The view a ScrollView lays its children in, which a chapter's place on
 * the page is measured from. React Native and the web both give it, though
 * React Native's types leave it out.
 */
function innerView(scroll: ScrollView | null): View | null {
  return (scroll as unknown as { getInnerViewRef?: () => View | null } | null)?.getInnerViewRef?.() ?? null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  // A chapter: air above and below, and a hairline between it and the last.
  chapter: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  chapterFirst: { paddingTop: spacing.xl },
  rule: { height: 1, backgroundColor: colors.border, marginBottom: spacing.xxl },
  titleRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.md },
  title: {
    flex: 1,
    fontFamily: type.serif,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: 0.4,
    color: colors.ink,
  },
  meta: {
    marginTop: 6,
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    lineHeight: 15,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  prints: { marginTop: spacing.lg, gap: PRINT_GAP },
  strip: { flexDirection: "row", gap: PRINT_GAP },
  more: { alignSelf: "flex-start", marginTop: spacing.md },
  moreText: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.accent,
  },
  pressed: { opacity: 0.6 },
  // The line over the chapters on your own page: how many there are, and
  // EDIT; while arranging, a strip of paper that holds to the top.
  bar: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, backgroundColor: colors.paper },
  barOn: { paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  barLine: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  barLabel: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  barRule: { flex: 1, height: 1, backgroundColor: colors.border },
  barAction: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.accent,
  },
  barHint: { ...type.caption, fontSize: 12, lineHeight: 17, color: colors.inkSoft, marginTop: spacing.sm },
  rename: { paddingVertical: 2 },
  renameText: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.accent,
  },
  // MOVE, set small on a slip of paper in a print's top corner, where it
  // is seen as soon as the print is, however tall a lead runs.
  mark: {
    position: "absolute",
    left: 5,
    top: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    backgroundColor: colors.paper,
    opacity: 0.92,
  },
  markText: {
    fontFamily: type.mono,
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink,
  },
  // A print lifted to be dragged: off the page on a soft shadow.
  lifted: {
    position: "absolute",
    backgroundColor: colors.paperSunken,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  // The print it was lifted from, waiting in its place.
  left: { opacity: 0.3 },
  // Where it would go, on a slip across the middle of the screen, set as
  // the note that says where it went.
  slipRow: { position: "absolute", left: spacing.lg, right: spacing.lg, alignItems: "center" },
  slip: {
    maxWidth: "100%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.paperRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  // The era a lifted print is over: a quiet frame round its chapter, under
  // its rule, washed faintly with the accent.
  target: {
    position: "absolute",
    left: spacing.sm,
    right: spacing.sm,
    top: 1 + spacing.xxl - spacing.md,
    bottom: spacing.xxl - spacing.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  targetFirst: { top: spacing.xl - spacing.md },
  targetWash: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.accent, opacity: 0.07 },
  // Out of sight: for the web's screen readers only.
  spoken: { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 },
  // Where a photograph went, said once at the foot of the screen.
  note: {
    position: "absolute",
    alignSelf: "center",
    maxWidth: "88%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.paperRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  noteText: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.ink,
  },
  // The foot of the eras, set like the map's note: what they leave out.
  foot: { paddingHorizontal: spacing.lg },
  counts: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    lineHeight: 15,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  rulebook: { ...type.caption, fontSize: 12, lineHeight: 17, color: colors.inkFaint, marginTop: spacing.sm },
});
