import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, type Region as MapRegion } from "react-native-maps";
import { Image } from "expo-image";
import { colors, spacing, type } from "@/theme";
import { mediaUrl } from "@/api/media";
import { clusterForRegion, hasPlace, regionFor, WORLD, type Cluster, type Region } from "@/utils/geo";
import { geocodeMissing, type Point } from "@/utils/geocode";
import type { PostRow } from "@/types/db";

interface Props {
  posts: PostRow[];
  onOpenPost: (post: PostRow) => void;
  /** Rendered above the map (profile header). */
  header?: React.ReactElement;
}

type PlacedPost = PostRow & { lat: number; lng: number };

/**
 * A member's photographs on the world.
 *
 * Apple's map, zoomed out to the globe, with a small print pinned at every
 * place a photograph names. Nearby pictures share a pin with a count until
 * you zoom in and they come apart; tap a pin with several to fly to them,
 * tap a single one to open it. The points come from the place the author
 * typed on each post — looked up on the phone, never read from a camera.
 * Older posts made before places were looked up are placed as you watch,
 * one at a time, and only for the session.
 */
export function PostMap({ posts, onOpenPost, header }: Props) {
  const mapRef = useRef<MapView>(null);
  const [found, setFound] = useState<Record<string, Point>>({});

  // Posts that were placed when they were made, plus any placed since.
  const placed: PlacedPost[] = useMemo(
    () =>
      posts
        .map((p) => (hasPlace(p) ? p : found[p.id] ? { ...p, ...found[p.id] } : null))
        .filter((p): p is PlacedPost => p !== null),
    [posts, found],
  );

  useEffect(() => {
    let alive = true;
    geocodeMissing(posts, (id, point) => setFound((f) => ({ ...f, [id]: point })), () => alive);
    return () => {
      alive = false;
    };
  }, [posts]);

  const initial = useMemo(() => regionFor(placed) ?? WORLD, [placed.length === 0 ? 0 : 1]);
  const [region, setRegion] = useState<Region>(initial);
  const clusters = useMemo(() => clusterForRegion(placed, region), [placed, region]);

  const open = (cluster: Cluster<PlacedPost>) => {
    if (cluster.items.length === 1) {
      onOpenPost(cluster.items[0]);
      return;
    }
    const target = regionFor(cluster.items, 1.6);
    if (target) mapRef.current?.animateToRegion(target as MapRegion, 500);
  };

  const unplaced = posts.length - placed.length;

  return (
    <View style={styles.root}>
      {header}
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initial}
          onRegionChangeComplete={(r) => setRegion(r)}
          showsUserLocation={false}
          showsPointsOfInterest={false}
          showsCompass={false}
          rotateEnabled={false}
          pitchEnabled={false}
          mapType="mutedStandard"
        >
          {clusters.map((c) => (
            <Marker
              key={c.key}
              coordinate={{ latitude: c.lat, longitude: c.lng }}
              anchor={{ x: 0.5, y: 1 }}
              onPress={() => open(c)}
              tracksViewChanges={false}
            >
              <Pin cluster={c} />
            </Marker>
          ))}
        </MapView>
        {placed.length === 0 ? (
          <View style={styles.empty} pointerEvents="none">
            <Text style={styles.emptyTitle}>Nowhere yet</Text>
            <Text style={styles.emptyBody}>
              {posts.length === 0
                ? "Photographs with a place written on them appear here."
                : "Write a place on a post — a town, a bar, a beach — and it lands on the map."}
            </Text>
          </View>
        ) : unplaced > 0 ? (
          <Text style={styles.note}>
            {unplaced} without a place
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A small print with a white border, the way a photo library pins a place. */
function Pin({ cluster }: { cluster: Cluster<PlacedPost> }) {
  const post = cluster.items[0];
  const url =
    post.media_type === "video"
      ? mediaUrl("thumbnails", post.thumb_path)
      : mediaUrl("thumbnails", post.thumb_path) ?? mediaUrl("media", post.media_path);
  return (
    <View style={styles.pin}>
      <View style={styles.print}>
        {url ? <Image source={url} style={styles.printImage} contentFit="cover" cachePolicy="memory-disk" /> : null}
      </View>
      {cluster.items.length > 1 ? (
        <View style={styles.count}>
          <Text style={styles.countText}>{cluster.items.length}</Text>
        </View>
      ) : null}
      <View style={styles.stem} />
    </View>
  );
}

const PRINT = 46;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  mapWrap: { flex: 1 },
  map: { flex: 1 },
  pin: { alignItems: "center" },
  print: {
    width: PRINT,
    height: PRINT,
    padding: 2,
    backgroundColor: colors.paperRaised,
    borderRadius: 4,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  printImage: { flex: 1, borderRadius: 2, backgroundColor: colors.paperSunken },
  count: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.paperRaised,
  },
  countText: { fontFamily: type.mono, fontSize: 10, fontWeight: "700", color: colors.paperRaised },
  stem: { width: 1, height: 8, backgroundColor: colors.ink, opacity: 0.6 },
  empty: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    top: "38%",
    alignItems: "center",
    backgroundColor: "rgba(250, 246, 239, 0.92)",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: 6,
  },
  emptyTitle: { fontFamily: type.serif, fontSize: 17, color: colors.ink },
  emptyBody: { ...type.caption, textAlign: "center", marginTop: spacing.xs, lineHeight: 18 },
  note: {
    position: "absolute",
    bottom: spacing.md,
    alignSelf: "center",
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
    backgroundColor: "rgba(250, 246, 239, 0.9)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 3,
  },
});
