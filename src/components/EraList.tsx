import React, { useMemo, useRef, useState } from "react";
import {
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
import { colors, spacing, type } from "@/theme";
import { eraSummary, type Era } from "@/utils/memories";
import { EmptyState } from "./EmptyState";
import { PhotoTile } from "./PhotoGrid";
import { aspectRatio } from "./PostMedia";
import { GridSkeleton } from "./Skeleton";
import {
  ERA_RULE,
  ERA_STRIP,
  PRINT_GAP,
  chaptersNear,
  eraHeading,
  eraMeta,
  eraMore,
  eraSpanSpoken,
  eraStrip,
  erasEmpty,
  erasFootnote,
  leadPrint,
  printLabel,
  type ChapterSpan,
} from "./eraBook";
import type { PostRow } from "@/types/db";

interface Props {
  /** The member's own photographs. Never the ones they were tagged in: those are not theirs to gather. */
  posts: PostRow[];
  /** A print was tapped, in the era of that title. */
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
 * a year, gathered exactly as On this day gathers them (`groupEras`).
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
 */
export function EraList({ posts, onOpenPost, header, member, loading, onRefresh, refreshing }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The strip's squares span the page between its margins; the lead is
  // measured in them.
  const cell = (width - spacing.lg * 2 - PRINT_GAP * (ERA_STRIP - 1)) / ERA_STRIP;

  const summary = useMemo(() => eraSummary(posts), [posts]);
  const empty = erasEmpty(summary, member);
  const footnote = erasFootnote(summary);

  // Eras opened in place, by title (titles are unique).
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (title: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  // Where each chapter lies down the page, and how far it is scrolled:
  // the chapters near the screen, by title, have their leads drawn full.
  const spans = useRef(new Map<string, ChapterSpan>());
  const offset = useRef(0);
  const [near, setNear] = useState<ReadonlySet<string>>(() => new Set());
  const look = () => setNear((prev) => chaptersNear(prev, spans.current, offset.current, height));

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: Math.max(spacing.xxl * 2, insets.bottom + spacing.xxl) }}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={colors.inkFaint} /> : undefined}
      onScroll={(e) => {
        offset.current = e.nativeEvent.contentOffset.y;
        look();
      }}
      scrollEventThrottle={100}
    >
      {header}
      {loading ? (
        <GridSkeleton />
      ) : empty ? (
        <EmptyState title={empty.title} body={empty.body} />
      ) : (
        <>
          {summary.eras.map((era, i) => (
            <Chapter
              key={era.title}
              era={era}
              first={i === 0}
              cell={cell}
              expanded={open.has(era.title)}
              near={near.has(era.title)}
              onToggle={() => toggle(era.title)}
              onOpen={(post) => onOpenPost(post, era.title)}
              onLayout={(e) => {
                const { y, height: tall } = e.nativeEvent.layout;
                spans.current.set(era.title, { top: y, height: tall });
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
  );
}

function Chapter({
  era,
  first,
  cell,
  expanded,
  near,
  onToggle,
  onOpen,
  onLayout,
}: {
  era: Era<PostRow>;
  first: boolean;
  cell: number;
  expanded: boolean;
  /** On the screen or within a screen of it, now or before: the lead is drawn full. */
  near: boolean;
  onToggle: () => void;
  onOpen: (post: PostRow) => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  const [lead] = era.posts;
  const leadSize = leadPrint(aspectRatio(lead.width, lead.height), cell);
  const strip = eraStrip(era, expanded);
  const rows: PostRow[][] = [];
  for (let i = 0; i < strip.length; i += ERA_STRIP) rows.push(strip.slice(i, i + ERA_STRIP));
  const more = eraMore(era, expanded);

  return (
    <View style={[styles.chapter, first && styles.chapterFirst]} onLayout={onLayout}>
      {first ? null : <View style={styles.rule} />}
      <Text style={styles.title} accessibilityRole="header" accessibilityLabel={eraHeading(era)}>
        {era.title}
      </Text>
      <Text style={styles.meta} accessibilityLabel={eraSpanSpoken(era)}>
        {eraMeta(era)}
      </Text>
      <View style={styles.prints}>
        <PhotoTile
          post={lead}
          size={leadSize.width}
          height={leadSize.height}
          full={near}
          onPress={() => onOpen(lead)}
          accessibilityLabel={printLabel(lead)}
        />
        {rows.map((row, i) => (
          <View key={i} style={styles.strip}>
            {row.map((post) => (
              <PhotoTile key={post.id} post={post} size={cell} onPress={() => onOpen(post)} accessibilityLabel={printLabel(post)} />
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  // A chapter: air above and below, and a hairline between it and the last.
  chapter: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  chapterFirst: { paddingTop: spacing.xl },
  rule: { height: 1, backgroundColor: colors.border, marginBottom: spacing.xxl },
  title: {
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
