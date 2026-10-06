import { Platform } from "react-native";
import * as Location from "expo-location";
import { makeLazyWriter, readDiskCache, writeDiskCache } from "./diskCache";

/**
 * Turning the place a member typed into a point.
 *
 * This is the only geography VINTAGE does, and it runs on the words the
 * author wrote — "Lisbon", "Bar Pitti", "St. Barths" — never on where
 * the phone is or where the camera was. The lookup is the system's own
 * (Apple's on iOS) and needs no location permission. It is best-effort
 * throughout: no match, no network, no module — the post simply has no
 * point and the map leaves it out.
 */

export interface Point {
  lat: number;
  lng: number;
}

const FILE = "place-points.json";
const KEY = "vintage.place-points";

const cache = new Map<string, Point | null>();
let loaded = false;

/** The stored points, checked value by value. */
export function parseStoredPoints(raw: unknown): Record<string, Point | null> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, Point | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null) {
      out[k] = null;
      continue;
    }
    if (!v || typeof v !== "object") continue;
    const { lat, lng } = v as Record<string, unknown>;
    if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) out[k] = { lat, lng };
  }
  return out;
}

// Points found for the words on older posts are kept on the phone too, so
// the map and the places view do not look the same towns up again on
// every launch.
function load() {
  if (loaded) return;
  loaded = true;
  const stored = readDiskCache(FILE, KEY, parseStoredPoints);
  if (!stored) return;
  for (const [k, v] of Object.entries(stored)) {
    if (!cache.has(k)) cache.set(k, v);
  }
}

const persist = makeLazyWriter(() => writeDiskCache(FILE, KEY, Object.fromEntries(cache)));

function key(place: string): string {
  return place.trim().toLowerCase();
}

/** Points already known for posts that carry words but no point, by post id. */
export function knownPoints<T extends { id: string; location: string | null; lat: number | null; lng: number | null }>(
  posts: readonly T[],
): Record<string, Point> {
  load();
  const out: Record<string, Point> = {};
  for (const p of posts) {
    if (!p.location || (p.lat != null && p.lng != null)) continue;
    const point = cache.get(key(p.location));
    if (point) out[p.id] = point;
  }
  return out;
}

/** Look a place up, remembering the answer for the session. */
export async function geocodePlace(place: string, timeoutMs = 2500): Promise<Point | null> {
  load();
  const k = key(place);
  if (k.length < 2) return null;
  if (cache.has(k)) return cache.get(k) ?? null;
  if (Platform.OS === "web") return null;
  let settled = false;
  const lookup = Location.geocodeAsync(place.trim())
    .then((results) => {
      const first = results[0];
      if (!first || !Number.isFinite(first.latitude) || !Number.isFinite(first.longitude)) return null;
      return { lat: first.latitude, lng: first.longitude };
    })
    .catch(() => null)
    .then((point) => {
      settled = true;
      // Remember the answer — including "no such place" — but only when the
      // lookup actually answered. A timeout stays unremembered so a later,
      // calmer moment can try again.
      cache.set(k, point);
      persist();
      return point;
    });
  const point = await Promise.race([
    lookup,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  return settled ? point : null;
}

/**
 * Points for older posts that were made before places were looked up.
 * One at a time, briefly spaced — the system geocoder rate-limits — and
 * only for the profile on screen. Nothing is written back to the
 * database from here; a point found this way lives for the session.
 */
export async function geocodeMissing<T extends { id: string; location: string | null; lat: number | null; lng: number | null }>(
  posts: readonly T[],
  onPoint: (id: string, point: Point) => void,
  isAlive: () => boolean,
  limit = 40,
): Promise<void> {
  const todo = posts.filter((p) => p.location && (p.lat == null || p.lng == null)).slice(0, limit);
  for (const post of todo) {
    if (!isAlive()) return;
    const point = await geocodePlace(post.location!);
    if (point && isAlive()) onPoint(post.id, point);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}
