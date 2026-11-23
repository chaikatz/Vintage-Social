import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, type MapPressEvent, type MarkerPressEvent, type Region as MapRegion } from "react-native-maps";
import { Image } from "expo-image";
import { colors, spacing, type } from "@/theme";
import { mediaUrl } from "@/api/media";
import { clusterForRegion, hasPlace, regionFor, WORLD, type Cluster, type Region } from "@/utils/geo";
import { geocodeMissing, type Point } from "@/utils/geocode";
import { PIN_PRINT, PIN_STEM, pinAt, pinTap, pinsInView, placeSheet, stillPlaced } from "@/utils/mapPlace";
import { PlaceSheet } from "./PlaceSheet";
import type { GridPost } from "./PhotoGrid";

interface Props {
  posts: GridPost[];
  /** Opens a photograph as the profile's grid does (the screen decides: its gallery, or the post). */
  onOpenPost: (post: GridPost) => void;
  /** Rendered above the map (profile header). */
  header?: React.ReactElement;
}

type PlacedPost = GridPost & { lat: number; lng: number };

/**
 * One tap is answered once. The pin's own press, the map's word for a pin
 * pressed, and the map's own tap can each report the same touch; the
 * first opens, and the others within this long are the same tap.
 */
const TAP_ONCE_MS = 600;

/**
 * A member's photographs on the world.
 *
 * Apple's map, zoomed out to the globe, with a small print pinned at every
 * place a photograph names. Nearby pictures share a pin with a count until
 * you zoom in and they come apart. Tap a pin of one place, a single
 * photograph or many, and its photographs come up in a sheet over the map
 * (src/components/PlaceSheet.tsx), each opening as the grid's do; tap a pin
 * of several places and the map flies in until they come apart
 * (src/utils/mapPlace.ts). The points come from the place the author typed
 * on each post — looked up on the phone, never read from a camera. Older
 * posts made before places were looked up are placed as you watch, one at
 * a time, and only for the session.
 *
 * A tap on a pin did nothing for photographs at one place: they share one
 * point, and a pin of several only flew the map to them, where they stayed
 * one pin however close it went. A tap is now taken three ways, each
 * leading to the same place once: the pin's own press, the map's word for
 * a pin pressed (`onMarkerPress`, by the pin's identifier), and a plain
 * tap on the map, matched to the pin drawn under it (`pinAt`) for when the
 * pin's press does not reach us. The pin's picture takes no touches of its
 * own, so a touch on it is the pin's.
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
  // Drawn: the pins on screen and half a screen about it, a bounded number.
  const pins = useMemo(() => pinsInView(clusters, region), [clusters, region]);
  const [mapWidth, setMapWidth] = useState(0);

  // The place open in the sheet: its photographs, found again among those
  // placed now, so one deleted meanwhile leaves it, and the last to leave
  // puts the sheet away.
  const [placeIds, setPlaceIds] = useState<string[] | null>(null);
  const sheet = useMemo(() => {
    if (!placeIds) return null;
    const here = stillPlaced(placeIds, placed);
    return here.length > 0 ? placeSheet(here) : null;
  }, [placeIds, placed]);
  const closeSheet = useCallback(() => setPlaceIds(null), []);

  // What the handlers below read when a tap comes, without being made again for it.
  const now = useRef({ region, pins, mapWidth, sheetOpen: sheet != null });
  now.current = { region, pins, mapWidth, sheetOpen: sheet != null };
  const latestOpen = useRef(onOpenPost);
  latestOpen.current = onOpenPost;
  const openFromSheet = useCallback((post: GridPost) => latestOpen.current(post), []);

  const lastTap = useRef(0);
  const tapPin = useCallback((cluster: Cluster<PlacedPost>) => {
    const at = Date.now();
    if (at - lastTap.current < TAP_ONCE_MS) return;
    lastTap.current = at;
    const tap = pinTap(cluster.items, now.current.region);
    if (tap.kind === "zoom") {
      mapRef.current?.animateToRegion(tap.region as MapRegion, 500);
      return;
    }
    setPlaceIds(cluster.items.map((p) => p.id));
  }, []);
  // The map's word for a pin pressed, by the identifier each pin carries.
  const onMarkerPress = useCallback(
    (e: MarkerPressEvent) => {
      const pin = now.current.pins.find((c) => c.key === e.nativeEvent.id);
      if (pin) tapPin(pin);
    },
    [tapPin],
  );
  // A tap on the map: the pin drawn under it, if any.
  const onMapPress = useCallback(
    (e: MapPressEvent) => {
      const { region: shown, pins: drawn, mapWidth: width, sheetOpen } = now.current;
      const at = e.nativeEvent.coordinate;
      if (sheetOpen || !at) return;
      const pin = pinAt(drawn, at, shown, width);
      if (pin) tapPin(pin);
    },
    [tapPin],
  );

  const unplaced = posts.length - placed.length;

  return (
    <View style={styles.root}>
      {header}
      {/* Measured here, a plain view as wide as the map, for pinAt. */}
      <View style={styles.mapWrap} onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initial}
          onRegionChangeComplete={(r) => setRegion(r)}
          onPress={onMapPress}
          onMarkerPress={onMarkerPress}
          showsUserLocation={false}
          showsPointsOfInterest={false}
          showsCompass={false}
          rotateEnabled={false}
          pitchEnabled={false}
          mapType="mutedStandard"
        >
          {pins.map((c) => (
            <Marker
              key={c.key}
              identifier={c.key}
              coordinate={{ latitude: c.lat, longitude: c.lng }}
              anchor={{ x: 0.5, y: 1 }}
              onPress={() => tapPin(c)}
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
          // Over the map's foot, where a pin may stand: a tap there is the pin's.
          <Text style={styles.note} pointerEvents="none">
            {unplaced} without a place
          </Text>
        ) : null}
        {sheet ? <PlaceSheet sheet={sheet} onOpenPost={openFromSheet} onClose={closeSheet} /> : null}
      </View>
    </View>
  );
}

/**
 * A small print with a white border, the way a photo library pins a place.
 * It takes no touches itself (`pointerEvents="none"`): a touch on it is the
 * pin's, so the pin's own press has it. Drawn again only when its pin's
 * photographs change, not when the sheet opens or the map is redrawn.
 */
const Pin = memo(function Pin({ cluster }: { cluster: Cluster<PlacedPost> }) {
  const post = cluster.items[0];
  const url =
    post.media_type === "video"
      ? mediaUrl("thumbnails", post.thumb_path)
      : mediaUrl("thumbnails", post.thumb_path) ?? mediaUrl("media", post.media_path);
  return (
    <View style={styles.pin} pointerEvents="none">
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
});

/** The print and its stem, as `pinAt` measures them. */
const PRINT = PIN_PRINT;

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
  stem: { width: 1, height: PIN_STEM, backgroundColor: colors.ink, opacity: 0.6 },
  empty: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    top: "38%",
    alignItems: "center",
    backgroundColor: colors.paper,
    opacity: 0.94,
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
    backgroundColor: colors.paper,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 3,
  },
});
