import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, spacing, type } from "@/theme";
import { hasPlace } from "@/utils/geo";
import { geocodeMissing, knownPoints, type Point } from "@/utils/geocode";
import { knownLabels, reverseGeocodeCells } from "@/utils/reverseGeocode";
import {
  AnswerBatch,
  cellKey,
  groupByPlace,
  placeLines,
  withAnswers,
  type PlaceLabel,
  type PlaceLine,
} from "@/utils/placeGroups";
import { GRID_GAP, GRID_SCREENS, PhotoTile, type GridPost } from "./PhotoGrid";

/** How long the photographs wait for their towns' names before showing anyway. */
const SETTLE_AFTER_MS = 4000;
/** The map's answers reach the page together, at most this often. */
const ANSWERS_EVERY_MS = 1000;
/** Squares to a row, as on the grid. */
const ACROSS = 3;

interface Props {
  posts: GridPost[];
  onOpenPost: (post: GridPost) => void;
  /** Rendered above the places (profile header). */
  header?: React.ReactElement;
  empty?: React.ReactElement | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * A member's photographs, filed by the places they were taken.
 *
 * Each place is a heading — the town, in the quiet serif — with the
 * country and the years beneath it in tracked mono, the spots within it
 * named small, and every photograph from there in the familiar squares.
 * The most photographed place leads. The town is asked of the map from
 * each photograph's point; until it answers, the photographs wait under
 * a short note rather than shuffling as the names arrive.
 *
 * Drawn as the grid is: a list of headings and rows of squares that draws
 * the screens about the reader and lets the rest go (`placeLines`), each
 * heading and row drawn again only when what it shows changes. The map's
 * answers reach the page together, at most once a second
 * (`AnswerBatch`), rather than regrouping every photograph as each one
 * comes.
 */
export function PlaceGroups({ posts, onOpenPost, header, empty, onRefresh, refreshing }: Props) {
  const { width } = useWindowDimensions();
  const size = (width - GRID_GAP * 2) / 3;

  // Points for older posts that were made before places were looked up.
  const [found, setFound] = useState<Record<string, Point>>(() => knownPoints(posts));
  // Town names, by cell — opened on everything the session already knows,
  // so coming back to this view shows the places at once rather than
  // "Placing your photographs…" again.
  const known = knownLabels(posts.filter(hasPlace).map((p) => ({ lat: p.lat, lng: p.lng })));
  const [labels, setLabels] = useState<Record<string, PlaceLabel | null>>(known.labels);
  const [settled, setSettled] = useState(known.complete);

  const [pointBatch] = useState(() => new AnswerBatch<Point>((more) => setFound((f) => withAnswers(f, more)), ANSWERS_EVERY_MS));
  const [labelBatch] = useState(
    () => new AnswerBatch<PlaceLabel | null>((named) => setLabels((l) => withAnswers(l, named)), ANSWERS_EVERY_MS),
  );
  useEffect(
    () => () => {
      pointBatch.stop();
      labelBatch.stop();
    },
    [pointBatch, labelBatch],
  );

  useEffect(() => {
    let alive = true;
    geocodeMissing(posts, (id, point) => pointBatch.add(id, point), () => alive);
    return () => {
      alive = false;
    };
  }, [posts, pointBatch]);

  const points = useMemo(
    () =>
      posts
        .map((p) => (hasPlace(p) ? { lat: p.lat, lng: p.lng } : found[p.id] ?? null))
        .filter((p): p is Point => p !== null),
    [posts, found],
  );

  // However slow the geocoder, the page shows what it knows after a moment
  // and refines as the rest of the names arrive. What is already waiting in
  // the batches goes with it, so nothing moves a second after it appears.
  useEffect(() => {
    const t = setTimeout(() => {
      pointBatch.flush();
      labelBatch.flush();
      setSettled(true);
    }, SETTLE_AFTER_MS);
    return () => clearTimeout(t);
  }, [pointBatch, labelBatch]);

  useEffect(() => {
    let alive = true;
    if (points.length === 0) {
      setSettled(true);
      return;
    }
    reverseGeocodeCells(
      points,
      (cell, label) => labelBatch.add(cell, label),
      () => alive,
      () => {
        // The pass is over: what it found is shown with the page, not a second later.
        labelBatch.flush();
        setSettled(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [points, labelBatch]);

  const groups = useMemo(
    () =>
      groupByPlace(posts, (p) => {
        const point = hasPlace(p) ? { lat: p.lat, lng: p.lng } : found[p.id];
        return point ? labels[cellKey(point.lat, point.lng)] ?? null : null;
      }),
    [posts, found, labels],
  );
  const lines = useMemo(() => placeLines(groups, ACROSS), [groups]);

  // The same press for every square, whatever the profile hands down.
  const latestOpen = useRef(onOpenPost);
  latestOpen.current = onOpenPost;
  const openPost = useCallback((post: GridPost) => latestOpen.current(post), []);

  const renderLine = useCallback(
    ({ item }: { item: PlaceLine<GridPost> }) =>
      item.kind === "head" ? (
        <PlaceHead title={item.title} placed={item.placed} count={item.count} meta={item.meta} spots={item.spots} />
      ) : (
        <PlaceRow posts={item.posts} first={item.first} size={size} onOpenPost={openPost} />
      ),
    [size, openPost],
  );

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.content}
      data={posts.length === 0 || !settled ? NO_LINES : lines}
      keyExtractor={lineKey}
      renderItem={renderLine}
      ListHeaderComponent={header}
      ListEmptyComponent={posts.length === 0 ? empty : !settled ? <Text style={styles.note}>Placing your photographs…</Text> : null}
      // Three screens of squares either side of the reader, as the grid draws.
      windowSize={GRID_SCREENS}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={colors.inkFaint} /> : undefined}
    />
  );
}

const NO_LINES: PlaceLine<GridPost>[] = [];

function lineKey(line: PlaceLine<GridPost>): string {
  return line.key;
}

/** A place's heading. Drawn again only when what it says changes. */
const PlaceHead = memo(function PlaceHead({
  title,
  placed,
  count,
  meta,
  spots,
}: {
  title: string;
  placed: boolean;
  count: number;
  meta: string;
  spots: string;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <View style={styles.rule} />
        <View style={styles.titleRow}>
          <Text style={[styles.title, !placed && styles.titleQuiet]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.count}>{count}</Text>
        </View>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        {spots ? (
          <Text style={styles.spots} numberOfLines={2}>
            {spots}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

/**
 * A row of a place's squares. Drawn again only when its photographs, its
 * size or its place in the place change: a town named elsewhere on the
 * page leaves it as it is.
 */
const PlaceRow = memo(
  function PlaceRow({
    posts,
    first,
    size,
    onOpenPost,
  }: {
    posts: GridPost[];
    first: boolean;
    size: number;
    onOpenPost: (post: GridPost) => void;
  }) {
    return (
      <View style={[styles.gridRow, !first && styles.rowGap]}>
        {posts.map((post) => (
          <PhotoTile key={post.id} post={post} size={size} onPress={() => onOpenPost(post)} />
        ))}
      </View>
    );
  },
  (a, b) =>
    a.first === b.first &&
    a.size === b.size &&
    a.onOpenPost === b.onOpenPost &&
    a.posts.length === b.posts.length &&
    a.posts.every((post, i) => post === b.posts[i]),
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: spacing.xl * 2 },
  note: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.inkFaint,
    textAlign: "center",
    paddingVertical: spacing.xl,
  },
  section: { paddingTop: spacing.lg },
  heading: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  rule: { width: 24, height: 1, backgroundColor: colors.ink, opacity: 0.85, marginBottom: spacing.md },
  titleRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.md },
  title: {
    flex: 1,
    fontFamily: type.serif,
    fontSize: 24,
    letterSpacing: 0.4,
    color: colors.ink,
  },
  titleQuiet: { color: colors.inkSoft, fontStyle: "italic" },
  count: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.inkFaint,
  },
  meta: {
    marginTop: 6,
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    color: colors.inkSoft,
  },
  spots: {
    marginTop: 4,
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    lineHeight: 15,
    color: colors.inkFaint,
  },
  gridRow: { flexDirection: "row", gap: GRID_GAP },
  // Between a place's rows, as the gap of the grid they were drawn in once.
  rowGap: { marginTop: GRID_GAP },
});
