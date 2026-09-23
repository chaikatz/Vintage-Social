import React, { useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, spacing, type } from "@/theme";
import { hasPlace } from "@/utils/geo";
import { geocodeMissing, type Point } from "@/utils/geocode";
import { reverseGeocodeCells } from "@/utils/reverseGeocode";
import { cellKey, groupByPlace, type PlaceGroup, type PlaceLabel } from "@/utils/placeGroups";
import { GRID_GAP, PhotoTile, type GridPost } from "./PhotoGrid";

/** How long the photographs wait for their towns' names before showing anyway. */
const SETTLE_AFTER_MS = 4000;

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
 */
export function PlaceGroups({ posts, onOpenPost, header, empty, onRefresh, refreshing }: Props) {
  const { width } = useWindowDimensions();
  const size = (width - GRID_GAP * 2) / 3;

  // Points for older posts that were made before places were looked up.
  const [found, setFound] = useState<Record<string, Point>>({});
  // Town names, by cell.
  const [labels, setLabels] = useState<Record<string, PlaceLabel | null>>({});
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let alive = true;
    geocodeMissing(posts, (id, point) => setFound((f) => ({ ...f, [id]: point })), () => alive);
    return () => {
      alive = false;
    };
  }, [posts]);

  const points = useMemo(
    () =>
      posts
        .map((p) => (hasPlace(p) ? { lat: p.lat, lng: p.lng } : found[p.id] ?? null))
        .filter((p): p is Point => p !== null),
    [posts, found],
  );

  // However slow the geocoder, the page shows what it knows after a moment
  // and refines as the rest of the names arrive.
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), SETTLE_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let alive = true;
    if (points.length === 0) {
      setSettled(true);
      return;
    }
    reverseGeocodeCells(
      points,
      (cell, label) => setLabels((l) => (cell in l && l[cell] === label ? l : { ...l, [cell]: label })),
      () => alive,
      () => setSettled(true),
    );
    return () => {
      alive = false;
    };
  }, [points]);

  const groups = useMemo(
    () =>
      groupByPlace(posts, (p) => {
        const point = hasPlace(p) ? { lat: p.lat, lng: p.lng } : found[p.id];
        return point ? labels[cellKey(point.lat, point.lng)] ?? null : null;
      }),
    [posts, found, labels],
  );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={colors.inkFaint} /> : undefined}
    >
      {header}
      {posts.length === 0 ? (
        empty
      ) : !settled ? (
        <Text style={styles.note}>Placing your photographs…</Text>
      ) : (
        groups.map((g) => <Section key={g.key} group={g} size={size} onOpenPost={onOpenPost} />)
      )}
    </ScrollView>
  );
}

function Section({ group, size, onOpenPost }: { group: PlaceGroup<GridPost>; size: number; onOpenPost: (post: GridPost) => void }) {
  const meta = [group.subtitle?.toUpperCase(), group.years].filter(Boolean).join("  ·  ");
  const spots = group.spots.map((s) => s.toUpperCase()).join("  ·  ") + (group.more > 0 ? `  ·  +${group.more}` : "");
  const rows: GridPost[][] = [];
  for (let i = 0; i < group.posts.length; i += 3) rows.push(group.posts.slice(i, i + 3));

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <View style={styles.rule} />
        <View style={styles.titleRow}>
          <Text style={[styles.title, !group.placed && styles.titleQuiet]} numberOfLines={2}>
            {group.title}
          </Text>
          <Text style={styles.count}>{group.posts.length}</Text>
        </View>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        {group.spots.length > 0 ? (
          <Text style={styles.spots} numberOfLines={2}>
            {spots}
          </Text>
        ) : null}
      </View>
      <View style={styles.grid}>
        {rows.map((row, i) => (
          <View key={i} style={styles.gridRow}>
            {row.map((post) => (
              <PhotoTile key={post.id} post={post} size={size} onPress={() => onOpenPost(post)} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

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
  grid: { gap: GRID_GAP },
  gridRow: { flexDirection: "row", gap: GRID_GAP },
});
