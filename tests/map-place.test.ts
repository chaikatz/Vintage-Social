import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clusterForRegion, regionFor, WORLD, type Region } from "@/utils/geo";
import {
  MAX_PINS,
  PIN_BOX,
  PIN_PRINT,
  PIN_STEM,
  UNNAMED_PLACE,
  ZOOM_STEP,
  pinAt,
  pinTap,
  pinsInView,
  placeSheet,
  stillPlaced,
} from "@/utils/mapPlace";
import { SPOTS_SHOWN } from "@/utils/placeGroups";

/**
 * A profile's map: a tap on a pin opens the photographs at its place.
 * The deciding and the measuring are pure (src/utils/mapPlace.ts) and are
 * tested here; the wiring in PostMap and the sheet is held to its source
 * below. What only a phone shows (the press reaching the pin through
 * Apple's map) is listed in the branch's notes.
 */

const at = (id: string, lat: number, lng: number, location: string | null = null, taken: string | null = null) => ({
  id,
  lat,
  lng,
  location,
  taken_at: taken,
  created_at: "2026-01-01T00:00:00Z",
});

describe("what a tap on a pin does", () => {
  it("opens a single photograph's place", () => {
    expect(pinTap([at("a", 48.85, 2.35)], WORLD)).toEqual({ kind: "place" });
  });

  it("opens the place of several photographs at one point, wherever the map is", () => {
    const cafe = [at("a", 48.8539, 2.3338), at("b", 48.8539, 2.3338), at("c", 48.8539, 2.3338)];
    expect(pinTap(cafe, WORLD)).toEqual({ kind: "place" });
    expect(pinTap(cafe, regionFor(cafe, 1.6)!)).toEqual({ kind: "place" });
  });

  it("was stuck before: photographs at one point stay one pin however close the map flies", () => {
    // The old tap flew to regionFor(items, 1.6), where they were one pin again, and opened nothing.
    const cafe = [at("a", 48.8539, 2.3338), at("b", 48.8539, 2.3338)];
    const flown = regionFor(cafe, 1.6)!;
    expect(clusterForRegion(cafe, flown)).toHaveLength(1);
    expect(clusterForRegion(cafe, regionFor(cafe, 1.6)!)).toHaveLength(1);
  });

  it("flies in to several places that come apart closer, as before", () => {
    const france = [at("paris", 48.85, 2.35), at("lyon", 45.76, 4.84)];
    const tap = pinTap(france, WORLD);
    expect(tap.kind).toBe("zoom");
    if (tap.kind !== "zoom") return;
    expect(tap.region).toEqual(regionFor(france, 1.6));
    expect(clusterForRegion(france, tap.region).length).toBeGreaterThan(1);
  });

  it("opens the place when the map is already as close as flying would take it", () => {
    // Two spots a street apart, on a map already showing that street: flying again changes nothing.
    const street = [at("a", 48.8539, 2.3338), at("b", 48.8541, 2.3352)];
    const target = regionFor(street, 1.6)!;
    const there: Region = { ...target };
    // (They come apart at the target only if a cell boundary falls between them; either way no loop.)
    expect(pinTap(street, there)).toEqual({ kind: "place" });
    const nearly: Region = { ...target, latitudeDelta: target.latitudeDelta * (ZOOM_STEP - 0.1), longitudeDelta: target.longitudeDelta * (ZOOM_STEP - 0.1) };
    expect(pinTap(street, nearly)).toEqual({ kind: "place" });
  });

  it("never flies to the same place twice in a row", () => {
    const pair = [at("a", 40.0, -74.0), at("b", 40.6, -73.2)];
    let region: Region = WORLD;
    for (let i = 0; i < 6; i++) {
      const tap = pinTap(pair, region);
      if (tap.kind === "place") return;
      expect(tap.region.longitudeDelta * ZOOM_STEP).toBeLessThanOrEqual(region.longitudeDelta);
      region = tap.region;
    }
    throw new Error("still flying after six taps");
  });
});

describe("the sheet for a place", () => {
  it("is named by the name most of its photographs carry, letter case and spacing aside", () => {
    const sheet = placeSheet([
      at("a", 1, 1, "Café de Flore", "2024-05-01T10:00:00Z"),
      at("b", 1, 1, "café  de flore", "2021-05-01T10:00:00Z"),
      at("c", 1, 1, "Paris", "2025-05-01T10:00:00Z"),
    ]);
    expect(sheet.title).toBe("Café de Flore");
    expect(sheet.spots).toBe("PARIS");
    expect(sheet.count).toBe(3);
    expect(sheet.meta).toBe("2021–2025");
  });

  it("lists its photographs newest first, by the day the shutter fired", () => {
    const sheet = placeSheet([
      at("old", 1, 1, "Kyoto", "2019-01-01T00:00:00Z"),
      at("new", 1, 1, "Kyoto", "2024-01-01T00:00:00Z"),
      { ...at("posted", 1, 1, "Kyoto", null), created_at: "2022-06-01T00:00:00Z" },
    ]);
    expect(sheet.posts.map((p) => p.id)).toEqual(["new", "posted", "old"]);
  });

  it("names the newest photograph's place on a tie, and counts the names it cannot show", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const sheet = placeSheet(names.map((n, i) => at(n, 1, 1, n, `202${i}-01-01T00:00:00Z`)));
    expect(sheet.title).toBe("F");
    expect(sheet.spots).toBe(["E", "D", "C"].join("  ·  ") + "  ·  +2");
    expect(SPOTS_SHOWN).toBe(3);
  });

  it("is called by a quiet word when no photograph names its place, and says nothing it does not know", () => {
    const sheet = placeSheet([at("a", 1, 1, null), at("b", 1, 1, "  ")]);
    expect(sheet.title).toBe(UNNAMED_PLACE);
    expect(sheet.spots).toBe("");
    expect(sheet.meta).toBe("2026");
  });

  it("keeps only the photographs still placed, in the order they come", () => {
    const placed = [at("a", 1, 1), at("b", 1, 1), at("c", 1, 1)];
    expect(stillPlaced(["c", "a", "gone"], placed).map((p) => p.id)).toEqual(["a", "c"]);
    expect(stillPlaced([], placed)).toEqual([]);
  });
});

describe("the pin under a tap on the map", () => {
  // A street's width of map, 400 points across: 4,000 points a degree of longitude.
  const region: Region = { latitude: 0, longitude: 0, latitudeDelta: 0.1, longitudeDelta: 0.1 };
  const width = 400;
  const perDegree = width / region.longitudeDelta;
  const pin = { key: "p", lat: 0, lng: 0 };
  const tap = (dx: number, dy: number, base = pin) => ({
    // At the equator Mercator's y is the latitude in radians, near enough a few points away.
    longitude: base.lng + dx / perDegree,
    latitude: base.lat - dy / perDegree,
  });

  it("is the pin whose print the tap fell on, and a little about it", () => {
    expect(pinAt([pin], tap(0, 0), region, width)).toBe(pin);
    expect(pinAt([pin], tap(PIN_PRINT / 2, 0), region, width)).toBe(pin);
    expect(pinAt([pin], tap(0, -(PIN_PRINT + PIN_STEM) / 2), region, width)).toBe(pin);
    expect(pinAt([pin], tap(PIN_BOX.halfWidth - 1, PIN_BOX.halfHeight - 1), region, width)).toBe(pin);
  });

  it("is none when the tap fell on the map beside it", () => {
    expect(pinAt([pin], tap(PIN_BOX.halfWidth + 2, 0), region, width)).toBeNull();
    expect(pinAt([pin], tap(0, PIN_BOX.halfHeight + 2), region, width)).toBeNull();
    expect(pinAt([pin], tap(-80, -80), region, width)).toBeNull();
    expect(pinAt([], tap(0, 0), region, width)).toBeNull();
  });

  it("is the nearest of two that hold it", () => {
    const left = { key: "l", lat: 0, lng: -10 / perDegree };
    const right = { key: "r", lat: 0, lng: 10 / perDegree };
    expect(pinAt([left, right], tap(6, 0), region, width)).toBe(right);
    expect(pinAt([left, right], tap(-6, 0), region, width)).toBe(left);
  });

  it("measures in the map's own projection, north of the equator too", () => {
    // At 60° north a degree of latitude is drawn twice as tall as at the equator.
    const north: Region = { latitude: 60, longitude: 10, latitudeDelta: 0.05, longitudeDelta: 0.1 };
    const p = { key: "n", lat: 60, lng: 10 };
    const degreeTall = (width / 0.1) / Math.cos((60 * Math.PI) / 180);
    expect(pinAt([p], { latitude: 60 + 20 / degreeTall, longitude: 10 }, north, width)).toBe(p);
    expect(pinAt([p], { latitude: 60 + (PIN_BOX.halfHeight + 3) / degreeTall, longitude: 10 }, north, width)).toBeNull();
  });

  it("finds a pin across the date line", () => {
    const fiji: Region = { latitude: -17, longitude: 179.99, latitudeDelta: 0.1, longitudeDelta: 0.1 };
    const p = { key: "f", lat: -17, lng: -179.995 };
    expect(pinAt([p], { latitude: -17, longitude: 179.999 }, fiji, width)).toBe(p);
  });

  it("asks nothing of a map not laid out yet", () => {
    expect(pinAt([pin], tap(0, 0), region, 0)).toBeNull();
  });
});

describe("the pins drawn", () => {
  it("are those on screen and half a screen about it", () => {
    const region: Region = { latitude: 48.85, longitude: 2.35, latitudeDelta: 0.2, longitudeDelta: 0.2 };
    const pins = [
      { key: "here", lat: 48.85, lng: 2.35 },
      { key: "edge", lat: 48.94, lng: 2.44 },
      { key: "near", lat: 49.0, lng: 2.5 },
      { key: "lyon", lat: 45.76, lng: 4.84 },
      { key: "tokyo", lat: 35.68, lng: 139.69 },
    ];
    expect(pinsInView(pins, region).map((p) => p.key)).toEqual(["here", "edge", "near"]);
  });

  it("are every pin when the map shows the world", () => {
    const pins = Array.from({ length: 30 }, (_, i) => ({ key: String(i), lat: (i * 37) % 140 - 70, lng: (i * 71) % 360 - 180 }));
    expect(pinsInView(pins, WORLD)).toHaveLength(30);
  });

  it("are never more than the bound, the ones nearest the middle kept", () => {
    const region: Region = { latitude: 0, longitude: 0, latitudeDelta: 10, longitudeDelta: 10 };
    const pins = Array.from({ length: 300 }, (_, i) => ({ key: String(i), lat: ((i % 20) - 10) * 0.5, lng: (Math.floor(i / 20) - 7) * 0.5 }));
    const drawn = pinsInView(pins, region);
    expect(drawn).toHaveLength(MAX_PINS);
    const far = (p: { lat: number; lng: number }) => p.lat ** 2 + p.lng ** 2;
    const kept = Math.max(...drawn.map(far));
    const left = pins.filter((p) => !drawn.includes(p));
    expect(Math.min(...left.map(far))).toBeGreaterThanOrEqual(kept - 1e-9);
    expect(pinsInView(pins, region, 5)).toHaveLength(5);
  });
});

const root = path.resolve(import.meta.dirname, "..");
/** The source without its comments, so prose is not taken for code. */
const code = (file: string) =>
  readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the map's wiring (src/components/PostMap.tsx)", () => {
  const map = code("src/components/PostMap.tsx");
  const marker = map.match(/<Marker\b[\s\S]*?<\/Marker>/)?.[0] ?? "";

  it("takes a tap three ways, all to one answer", () => {
    expect(marker).toMatch(/identifier=\{c\.key\}/);
    expect(marker).toMatch(/onPress=\{\(\) => tapPin\(c\)\}/);
    expect(map).toMatch(/onPress=\{onMapPress\}/);
    expect(map).toMatch(/onMarkerPress=\{onMarkerPress\}/);
    expect(map).toMatch(/const pin = now\.current\.pins\.find\(\(c\) => c\.key === e\.nativeEvent\.id\);\s*if \(pin\) tapPin\(pin\);/);
    expect(map).toMatch(/const pin = pinAt\(drawn, at, shown, width\);\s*if \(pin\) tapPin\(pin\);/);
    // Once: a second report of the same touch is not a second tap.
    expect(map).toMatch(/if \(at - lastTap\.current < TAP_ONCE_MS\) return;\s*lastTap\.current = at;/);
    // A tap on the map while the sheet is up is the sheet's.
    expect(map).toMatch(/if \(sheetOpen \|\| !at\) return;/);
    // The map's width, for measuring a tap, from the plain view that holds it.
    expect(map).toMatch(/<View style=\{styles\.mapWrap\} onLayout=\{\(e\) => setMapWidth\(e\.nativeEvent\.layout\.width\)\}>/);
  });

  it("opens the place, or flies in only where the photographs come apart; never a lone photograph straight past its place", () => {
    expect(map).toMatch(/const tap = pinTap\(cluster\.items, now\.current\.region\);/);
    expect(map).toMatch(/if \(tap\.kind === "zoom"\) \{\s*mapRef\.current\?\.animateToRegion\(tap\.region as MapRegion, 500\);\s*return;\s*\}\s*setPlaceIds\(cluster\.items\.map\(\(p\) => p\.id\)\);/);
    expect(map).not.toMatch(/onOpenPost\(cluster\.items\[0\]\)/);
    expect(map).toMatch(/<PlaceSheet sheet=\{sheet\} onOpenPost=\{openFromSheet\} onClose=\{closeSheet\} \/>/);
  });

  it("lets a touch on a pin's picture be the pin's, and draws a pin again only when its photographs change", () => {
    expect(map).toMatch(/<View style=\{styles\.pin\} pointerEvents="none">/);
    expect(map).toMatch(/const Pin = memo\(function Pin\(/);
  });

  it("draws a bounded number of pins, the ones about the screen", () => {
    expect(map).toMatch(/const pins = useMemo\(\(\) => pinsInView\(clusters, region\), \[clusters, region\]\);/);
    expect(map).toMatch(/\{pins\.map\(\(c\) => \(\s*<Marker/);
    expect(map).not.toMatch(/clusters\.map\(/);
  });

  it("measures the pin it draws", () => {
    expect(map).toMatch(/const PRINT = PIN_PRINT;/);
    expect(map).toMatch(/stem: \{ width: 1, height: PIN_STEM,/);
    expect(map).toMatch(/print: \{\s*width: PRINT,\s*height: PRINT,/);
  });

  it("is handed the same props by the browser's stand-in", () => {
    const web = code("src/components/PostMap.web.tsx");
    expect(web).toMatch(/posts: GridPost\[\];\s*onOpenPost: \(post: GridPost\) => void;/);
    expect(map).toMatch(/posts: GridPost\[\];\s*onOpenPost: \(post: GridPost\) => void;/);
  });
});

describe("the place sheet (src/components/PlaceSheet.tsx)", () => {
  const sheet = code("src/components/PlaceSheet.tsx");

  it("is the grid's squares under the Places heading, and opens each through the profile", () => {
    expect(sheet).toMatch(/<PlaceHead title=\{sheet\.title\} placed count=\{sheet\.count\} meta=\{sheet\.meta\} spots=\{sheet\.spots\} \/>/);
    expect(sheet).toMatch(/return <PhotoTile post=\{post\} size=\{size\} onPress=\{\(\) => onOpen\(post\)\} \/>;/);
    expect(sheet).toMatch(/const open = useCallback\(\(post: GridPost\) => latestOpen\.current\(post\), \[\]\);/);
    expect(sheet).toMatch(/numColumns=\{ACROSS\}/);
    expect(sheet).toMatch(/windowSize=\{GRID_SCREENS\}/);
    expect(sheet).toMatch(/const size = \(width - GRID_GAP \* \(ACROSS - 1\)\) \/ ACROSS;/);
    expect(sheet).toMatch(/const ACROSS = 3;/);
  });

  it("is drawn again only when what it shows changes, its squares too", () => {
    expect(sheet).toMatch(/export const PlaceSheet = memo\(function PlaceSheet\(/);
    expect(sheet).toMatch(/const SheetTile = memo\(function SheetTile\(/);
  });

  it("can always be put away, and says so to VoiceOver", () => {
    expect(sheet).toMatch(/onPress=\{onClose\}[\s\S]*?accessibilityLabel="Back to the map"/);
    expect(sheet).toMatch(/onPress=\{onClose\}[\s\S]*?accessibilityLabel="Close"/);
    expect(sheet).toMatch(/<View accessibilityRole="header">/);
  });

  it("uses the Places heading itself, not a copy", () => {
    expect(code("src/components/PlaceGroups.tsx")).toMatch(/export const PlaceHead = memo\(function PlaceHead\(/);
    expect(sheet).toMatch(/import \{ PlaceHead \} from "\.\/PlaceGroups";/);
  });
});

describe("the profiles hand the map their own way of opening a photograph", () => {
  for (const file of ["app/(tabs)/profile.tsx", "app/user/[username].tsx"]) {
    it(file, () => {
      const src = code(file);
      expect(src).toMatch(/<PostMap posts=\{[a-z]+\} onOpenPost=\{openPost\} header=\{header\} \/>/);
      expect(src).toMatch(/if \(!opensGallery\(view, p\)\) \{/);
    });
  }
});
