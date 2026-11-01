import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { colors, spacing, type } from "@/theme";
import { NO_EDITS, cleanEraTitle, editedEraSummary, moveChoices, type EditedEra, type EraEdits } from "@/utils/eraEdits";
import { useReducedMotion } from "@/utils/useReducedMotion";
import type { EraEditor } from "@/hooks/useEraEdits";
import { EmptyState } from "./EmptyState";
import { PhotoTile } from "./PhotoGrid";
import { aspectRatio } from "./PostMedia";
import { GridSkeleton } from "./Skeleton";
import { EraMoveSheet } from "./EraMoveSheet";
import { askEraName, canNameEras } from "./eraName";
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
  leadPrint,
  printLabel,
  type ChapterPlace,
  type ChapterSpan,
} from "./eraBook";
import type { PostRow } from "@/types/db";

/** How long the line that says where a photograph went stays up. */
const NOTE_MS = 2400;

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
 * RENAME beside it, every print is laid out and marked MOVE, and a tap on
 * one asks which era it belongs in (EraMoveSheet) instead of opening the
 * gallery. The change is on the page at once, and a line at the foot of
 * the screen says where the photograph went. DONE closes it again, on the
 * chapter the reader was at however far down they had gone. Moving
 * is chosen from a list rather than dragged: a drag across a long page
 * of chapters, under a scroll and a pull to refresh, is easy to drop in
 * the wrong one, and a list says exactly where a photograph will land.
 * Outside it, nothing differs from a member's page but the EDIT.
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
  const [moving, setMoving] = useState<PostRow | null>(null);
  const choices = useMemo(() => (moving ? moveChoices(posts, arranged, moving.id) : []), [moving, posts, arranged]);

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

  // EDIT lays every print out and DONE puts them away again, so each
  // chapter above the reader grows or shrinks by rows. The place at the
  // top of their view as they tap (under the bar, while it holds to the
  // top) is measured again once the page has been laid out, and put back
  // at the top: as far into its chapter as they were, or the chapter's
  // own top where it has closed up (depthAfter). They are left where they
  // were, not some chapters on.
  const scroller = useRef<ScrollView>(null);
  const pages = useRef(new Map<string, View>());
  const barTall = useRef(0);
  const anchor = useRef<ChapterPlace | null>(null);
  const arrange = (on: boolean) => {
    const seen = offset.current + (arranging ? barTall.current : 0);
    anchor.current = chapterAt(summary.eras.map((era) => era.key), spans.current, seen);
    setEditing(on);
  };
  useLayoutEffect(() => {
    const place = anchor.current;
    anchor.current = null;
    const page = place ? pages.current.get(place.key) : undefined;
    const book = innerView(scroller.current);
    if (!place || !page || !book) return;
    const under = arranging ? barTall.current : 0;
    page.measureLayout(book, (_x, top, _width, tall) =>
      scroller.current?.scrollTo({ y: Math.max(0, top + depthAfter(place, tall) - under), animated: false }),
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
  const say = (words: string) => {
    setNote({ words, at: Date.now() });
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => undefined);
    AccessibilityInfo.announceForAccessibility(words);
  };

  const move = (key: string) => {
    const post = moving;
    const to = choices.find((c) => c.key === key);
    setMoving(null);
    if (!post || !to || !editor) return;
    // Said only of a real move: not of a photograph gone from the page since the sheet opened.
    if (editor.move(post, key)) say(`Moved to ${to.title}`);
  };
  const rename = (era: EditedEra<PostRow>) =>
    askEraName(era, (title) => {
      editor?.rename(era.key, title);
      AccessibilityInfo.announceForAccessibility(`Named ${cleanEraTitle(title ?? "") || era.key}`);
    });

  // While arranging, the bar over the chapters holds to the top of the page.
  // Outside it the list of what holds is empty, never absent: the web lays
  // the page's children out afresh, header and chapters, when one comes
  // and goes.
  const barIndex = header ? 1 : 0;

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scroller}
        style={styles.root}
        contentContainerStyle={{ paddingBottom: Math.max(spacing.xxl * 2, insets.bottom + spacing.xxl) }}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={colors.inkFaint} /> : undefined}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
          look();
        }}
        scrollEventThrottle={100}
        stickyHeaderIndices={arranging ? [barIndex] : []}
      >
        {header}
        {editor && !loading && summary.eras.length > 0 ? (
          <View style={[styles.bar, arranging && styles.barOn]} onLayout={(e) => (barTall.current = e.nativeEvent.layout.height)}>
            <View style={styles.barLine}>
              <Text style={styles.barLabel}>{arranging ? "Arranging" : summary.eras.length === 1 ? "1 era" : `${summary.eras.length} eras`}</Text>
              <View style={styles.barRule} />
              <Pressable
                onPress={() => arrange(!arranging)}
                hitSlop={12}
                style={({ pressed }) => pressed && styles.pressed}
                accessibilityRole="button"
                accessibilityLabel={arranging ? "Done arranging eras" : "Edit eras"}
                accessibilityHint={arranging ? undefined : "Rename your eras, and move photographs from one to another."}
                testID="eras-edit"
              >
                <Text style={styles.barAction}>{arranging ? "Done" : "Edit"}</Text>
              </Pressable>
            </View>
            {arranging ? (
              <Text style={styles.barHint}>
                {canNameEras ? "Rename an era, or tap a photograph to move it." : "Tap a photograph to move it to another era."}
              </Text>
            ) : null}
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
                onToggle={() => toggle(era.key)}
                onOpen={(post) => (arranging ? setMoving(post) : onOpenPost(post, era.key))}
                onRename={() => rename(era)}
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
      {note ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.note, { bottom: Math.max(insets.bottom, spacing.lg), opacity: shown }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={styles.noteText} numberOfLines={1}>
            {note.words}
          </Text>
        </Animated.View>
      ) : null}
      {editor ? <EraMoveSheet post={moving} choices={choices} onChoose={move} onClose={() => setMoving(null)} /> : null}
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
  onToggle,
  onOpen,
  onRename,
  pageRef,
  onLayout,
}: {
  era: EditedEra<PostRow>;
  first: boolean;
  cell: number;
  expanded: boolean;
  /** On the screen or within a screen of it, now or before: the lead is drawn full. */
  near: boolean;
  /** Being arranged: every print laid out, each one moved by a tap, and the name renamed. */
  arranging: boolean;
  onToggle: () => void;
  onOpen: (post: PostRow) => void;
  onRename: () => void;
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
  const hint = arranging ? "Moves it to another era." : undefined;

  return (
    <View ref={pageRef} style={[styles.chapter, first && styles.chapterFirst]} onLayout={onLayout}>
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
            accessibilityHint={era.renamed ? `Its automatic name is ${era.key}.` : "Gives this era a name of your own."}
          >
            <Text style={styles.renameText}>Rename</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.meta} accessibilityLabel={eraSpanSpoken(era)}>
        {eraMeta(era)}
      </Text>
      <View style={styles.prints}>
        <Print arranging={arranging}>
          <PhotoTile
            post={lead}
            size={leadSize.width}
            height={leadSize.height}
            full={near}
            onPress={() => onOpen(lead)}
            accessibilityLabel={printLabel(lead)}
            accessibilityHint={hint}
          />
        </Print>
        {rows.map((row, i) => (
          <View key={i} style={styles.strip}>
            {row.map((post) => (
              <Print key={post.id} arranging={arranging}>
                <PhotoTile post={post} size={cell} onPress={() => onOpen(post)} accessibilityLabel={printLabel(post)} accessibilityHint={hint} />
              </Print>
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
 * in its top corner. The same view holds it either way, so EDIT and DONE
 * never draw a photograph afresh. MOVE is for the eye: VoiceOver hears it
 * in the print's own hint.
 */
function Print({ arranging, children }: { arranging: boolean; children: React.ReactElement }) {
  return (
    <View>
      {children}
      {arranging ? (
        <View style={styles.mark} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
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
