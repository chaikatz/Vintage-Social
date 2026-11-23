import { clusterForRegion, regionFor, type Placed, type Region } from "./geo";
import { SPOTS_SHOWN, yearSpan, type PlaceablePost } from "./placeGroups";

/**
 * A tap on the map of a profile, and what it opens.
 *
 * A pin is one place or several. One place opens a sheet of its
 * photographs (`placeSheet`), each of which opens as the grid's do; a pin
 * of several places flies the map in until they come apart, as it always
 * has. Photographs at one place share one point (the place written on
 * each is looked up once), so they never come apart however close the
 * map goes: flying to them again and again was all a tap on them did, and
 * nothing opened. A pin that would not come apart, or that the map is
 * already as close to as flying would take it, is one place.
 *
 * Pure, so it can be tested without a map.
 */

/** The map flies in only when that brings it at least this much closer. */
export const ZOOM_STEP = 1.5;

/** What a tap on a pin does: opens its place, or flies the map in to `region`. */
export type PinTap = { kind: "place" } | { kind: "zoom"; region: Region };

export function pinTap(items: readonly Placed[], region: Region): PinTap {
  if (items.length <= 1) return { kind: "place" };
  const target = regionFor(items, 1.6);
  if (!target) return { kind: "place" };
  // Together however close the map goes: one place.
  if (clusterForRegion(items, target).length <= 1) return { kind: "place" };
  // The map shows its own shape around what it is asked to show, so it
  // comes closer by the lesser of the two: if that is not a real step in,
  // it is already showing what there is to see.
  const closer =
    target.longitudeDelta * ZOOM_STEP <= region.longitudeDelta && target.latitudeDelta * ZOOM_STEP <= region.latitudeDelta;
  return closer ? { kind: "zoom", region: target } : { kind: "place" };
}

/** What the sheet for a place shows. */
export interface PlaceSheetView<T> {
  /** The place, as its photographs name it: the name most of them carry. */
  title: string;
  count: number;
  /** "2021" or "2019–2024": the years the photographs were taken in. */
  meta: string;
  /** The other names its photographs carry, small and in capitals: "BAR PITTI  ·  THE MET  ·  +2". */
  spots: string;
  /** Newest first, by the day the shutter fired, as Places files them. */
  posts: T[];
}

/** What a place with no name on any of its photographs is called. */
export const UNNAMED_PLACE = "Here";

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function when(p: PlaceablePost): string {
  return p.taken_at ?? p.created_at;
}

/** Two of the server's ISO timestamps, newest first (their characters sort by time). */
function newerFirst(a: PlaceablePost, b: PlaceablePost): number {
  const x = when(a);
  const y = when(b);
  return x < y ? 1 : x > y ? -1 : 0;
}

/**
 * The sheet for a pin's photographs: the place's name, how many, the
 * years, the other names they carry, and the photographs, newest first.
 * The name is the one most of them were written with (letter case and
 * spacing aside), as the newest of those writes it; on a tie, the one the
 * newest photograph carries.
 */
export function placeSheet<T extends PlaceablePost>(items: readonly T[]): PlaceSheetView<T> {
  const posts = [...items].sort(newerFirst);
  const names = new Map<string, { name: string; n: number; first: number }>();
  posts.forEach((p, i) => {
    const name = p.location?.trim();
    if (!name) return;
    const key = norm(name);
    const seen = names.get(key);
    if (seen) seen.n++;
    else names.set(key, { name, n: 1, first: i });
  });
  const ranked = [...names.values()].sort((a, b) => b.n - a.n || a.first - b.first);
  const others = ranked.slice(1);
  const shown = others.slice(0, SPOTS_SHOWN).map((s) => s.name.toUpperCase());
  const more = others.length - shown.length;
  return {
    title: ranked[0]?.name ?? UNNAMED_PLACE,
    count: posts.length,
    meta: yearSpan(posts) ?? "",
    spots: shown.length > 0 ? shown.join("  ·  ") + (more > 0 ? `  ·  +${more}` : "") : "",
    posts,
  };
}

/**
 * The pin a tap on the map landed on, if any, for when the tap reached
 * the map rather than the pin (src/components/PostMap.tsx takes a press
 * from the pin itself first). Asked in the map's own projection
 * (Mercator, north up: the map turns neither way), from the region it
 * shows and its width in points: how far each pin's point is from the
 * point tapped. Apple's map draws a pin's view centred on its point, so
 * the tap must fall within that view, and a little around it; of several
 * that hold it, the nearest.
 */
export function pinAt<C extends { lat: number; lng: number }>(
  pins: readonly C[],
  tap: { latitude: number; longitude: number },
  region: Region,
  width: number,
  box: PinBox = PIN_BOX,
): C | null {
  if (!(width > 0) || !(region.longitudeDelta > 0)) return null;
  const perRadian = width / radians(region.longitudeDelta);
  const tapY = mercatorY(tap.latitude);
  let best: C | null = null;
  let bestDistance = Infinity;
  for (const pin of pins) {
    // Where the tap is from the pin's point, in points, down and to the right.
    const x = radians(wrapLongitude(tap.longitude - pin.lng)) * perRadian;
    const y = -(tapY - mercatorY(pin.lat)) * perRadian;
    if (x < -box.halfWidth || x > box.halfWidth || y < -box.halfHeight || y > box.halfHeight) continue;
    const distance = x * x + y * y;
    if (distance < bestDistance) {
      best = pin;
      bestDistance = distance;
    }
  }
  return best;
}

/** Half a pin's view either way from its point, and the reach around it a finger is allowed. */
export interface PinBox {
  halfWidth: number;
  halfHeight: number;
}

/** The pin PostMap draws (a 46-point print over an 8-point stem), and six points about it. */
export const PIN_PRINT = 46;
export const PIN_STEM = 8;
const REACH = 6;
export const PIN_BOX: PinBox = { halfWidth: PIN_PRINT / 2 + REACH, halfHeight: (PIN_PRINT + PIN_STEM) / 2 + REACH };

/**
 * The pins worth drawing for the span on screen: those within it, and
 * within half a screen of it every way, so a short pan finds them already
 * there; at most `max`, nearest the middle first. Every place the member
 * photographed made a pin of its own wherever the map was, so a member
 * of two hundred places, looking at one town, had two hundred pins
 * drawn, each with its picture.
 */
export function pinsInView<C extends { lat: number; lng: number }>(clusters: readonly C[], region: Region, max = MAX_PINS): C[] {
  // Half the span either way is the screen; as much again is the half screen around it.
  const reachLat = region.latitudeDelta;
  const reachLng = region.longitudeDelta;
  const near: { c: C; d: number }[] = [];
  for (const c of clusters) {
    const dLat = Math.abs(c.lat - region.latitude);
    const dLng = Math.abs(wrapLongitude(c.lng - region.longitude));
    // A span of half the world or more reaches all the way round.
    if (reachLng < 180 && dLng > reachLng) continue;
    if (dLat > reachLat) continue;
    near.push({ c, d: (dLat / Math.max(reachLat, 1e-9)) ** 2 + (dLng / Math.max(reachLng, 1e-9)) ** 2 });
  }
  if (near.length <= max) return near.map((n) => n.c);
  return near
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((n) => n.c);
}

/** Pins drawn at once, at most: a handful of screens' worth of the grid's cells. */
export const MAX_PINS = 80;

/** A cluster's photographs, as the sheet takes them, found again among those placed now. */
export function stillPlaced<T extends Placed>(ids: readonly string[], placed: readonly T[]): T[] {
  const wanted = new Set(ids);
  return placed.filter((p) => wanted.has(p.id));
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** A difference of longitudes the short way round: -180 up to 180. */
function wrapLongitude(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/** Mercator's y for a latitude, in radians of longitude; the poles held just short of infinity. */
function mercatorY(latitude: number): number {
  const phi = radians(Math.max(-85.05112878, Math.min(85.05112878, latitude)));
  return Math.log(Math.tan(Math.PI / 4 + phi / 2));
}
