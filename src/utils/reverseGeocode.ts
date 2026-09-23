import { Platform } from "react-native";
import * as Location from "expo-location";
import { cellKey, labelFromAddress, type PlaceLabel } from "./placeGroups";

/**
 * From a point back to the name of the town.
 *
 * The places view files photographs under the town they were taken in.
 * A post carries the point of the spot its author chose ("Bar Pitti"),
 * not the town, so the town is asked of the system geocoder — Apple's on
 * iOS, no permission needed — once per five-kilometre cell and remembered
 * for the session. Nothing is written back. Where there is no geocoder
 * (the browser) every cell answers with nothing and the words on the
 * post stand in for the town.
 */

export interface Point {
  lat: number;
  lng: number;
}

const cache = new Map<string, PlaceLabel | null>();

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
    if (label !== null || Platform.OS === "web") cache.set(cell, label);
    if (isAlive()) onLabel(cell, label);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (isAlive()) onDone?.();
}
