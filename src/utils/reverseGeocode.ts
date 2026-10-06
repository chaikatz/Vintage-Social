import { Platform } from "react-native";
import * as Location from "expo-location";
import { cellKey, labelFromAddress, type PlaceLabel } from "./placeGroups";
import { makeLazyWriter, readDiskCache, writeDiskCache } from "./diskCache";

/**
 * From a point back to the name of the town.
 *
 * The places view files photographs under the town they were taken in.
 * A post carries the point of the spot its author chose ("Bar Pitti"),
 * not the town, so the town is asked of the system geocoder — Apple's on
 * iOS, no permission needed — once per five-kilometre cell and remembered:
 * for the session, and in a small file on the phone, so the places are
 * known the moment the view opens on every launch after the first. The
 * names are asked for as soon as a profile's photographs load, and for a
 * new photograph as it is posted, so by the time anyone taps "Places" the
 * answer is already there. Nothing is written back to the database. Where
 * there is no geocoder (the browser) every cell answers with nothing and
 * the words on the post stand in for the town.
 */

export interface Point {
  lat: number;
  lng: number;
}

const FILE = "place-names.json";
const KEY = "vintage.place-names";

const cache = new Map<string, PlaceLabel | null>();
let loaded = false;

/** The stored names, checked field by field: a file from another build is not trusted blindly. */
export function parseStoredLabels(raw: unknown): Record<string, PlaceLabel | null> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, PlaceLabel | null> = {};
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  for (const [cell, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null) {
      out[cell] = null;
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    out[cell] = { city: text(v.city), region: text(v.region), country: text(v.country) };
  }
  return out;
}

function load() {
  if (loaded) return;
  loaded = true;
  const stored = readDiskCache(FILE, KEY, parseStoredLabels);
  if (!stored) return;
  for (const [cell, label] of Object.entries(stored)) {
    if (!cache.has(cell)) cache.set(cell, label);
  }
}

const persist = makeLazyWriter(() => writeDiskCache(FILE, KEY, Object.fromEntries(cache)));

function remember(cell: string, label: PlaceLabel | null) {
  cache.set(cell, label);
  persist();
}

/** What is already known for these points, cell by cell — and whether that is all of them. */
export function knownLabels(points: readonly Point[]): { labels: Record<string, PlaceLabel | null>; complete: boolean } {
  load();
  const labels: Record<string, PlaceLabel | null> = {};
  let complete = true;
  for (const p of points) {
    const k = cellKey(p.lat, p.lng);
    if (cache.has(k)) labels[k] = cache.get(k) ?? null;
    else complete = false;
  }
  return { labels, complete };
}

async function lookup(point: Point, timeoutMs: number): Promise<PlaceLabel | null> {
  if (Platform.OS === "web") return null;
  const ask = Location.reverseGeocodeAsync({ latitude: point.lat, longitude: point.lng })
    .then((results) => (results[0] ? labelFromAddress(results[0]) : null))
    .catch(() => null);
  const late = new Promise<"late">((resolve) => setTimeout(() => resolve("late"), timeoutMs));
  const answer = await Promise.race([ask, late]);
  return answer === "late" ? null : answer;
}

/**
 * Names for every distinct cell among the points, one lookup at a time,
 * briefly spaced for the geocoder's sake. `onLabel` fires for each cell
 * as it is named (a cell already known fires at once); `onDone` when the
 * pass is over, however it went.
 */
export async function reverseGeocodeCells(
  points: readonly Point[],
  onLabel: (cell: string, label: PlaceLabel | null) => void,
  isAlive: () => boolean,
  onDone?: () => void,
  limit = 60,
): Promise<void> {
  load();
  const cells = new Map<string, Point>();
  for (const p of points) {
    const k = cellKey(p.lat, p.lng);
    if (!cells.has(k)) cells.set(k, p);
  }
  let asked = 0;
  for (const [cell, point] of cells) {
    if (!isAlive()) return;
    if (cache.has(cell)) {
      onLabel(cell, cache.get(cell) ?? null);
      continue;
    }
    if (asked >= limit) break;
    asked += 1;
    const label = await lookup(point, 2500);
    // Remember a real answer — and a real "nothing here" — but not a timeout,
    // so a quieter moment can ask again.
    if (label !== null || Platform.OS === "web") remember(cell, label);
    if (isAlive()) onLabel(cell, label);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (isAlive()) onDone?.();
}

/**
 * Learn the town for one point now — a photograph just posted — so the
 * places view already knows where it goes. Best-effort; never awaited by
 * the publish.
 */
export async function rememberPlace(point: Point): Promise<void> {
  load();
  const cell = cellKey(point.lat, point.lng);
  if (cache.has(cell)) return;
  const label = await lookup(point, 4000);
  if (label !== null || Platform.OS === "web") remember(cell, label);
}
