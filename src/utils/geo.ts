/**
 * Putting photographs on a map.
 *
 * A profile read as a map shows one pin per place at a glance and one pin
 * per photograph up close, the way a photo library does. The grouping
 * here is deliberately simple: the visible span of the map is cut into a
 * grid a few pins wide, and photographs that fall in the same cell share
 * a pin. Zoom in and the cells shrink, so the pins come apart. Pure,
 * so it can be tested without a map.
 */

export interface Placed {
  id: string;
  lat: number;
  lng: number;
}

export interface Cluster<T extends Placed = Placed> {
  key: string;
  /** Centre of the grouped photographs — where the pin is drawn. */
  lat: number;
  lng: number;
  items: T[];
}

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** How many pins fit across the map before neighbours share one. */
export const CELLS_ACROSS = 5;

export function hasPlace<T extends { lat: number | null; lng: number | null }>(
  post: T,
): post is T & { lat: number; lng: number } {
  return typeof post.lat === "number" && typeof post.lng === "number";
}

/** Group by grid cell for the span on screen. Order is newest-first within a pin when the input is. */
export function clusterForRegion<T extends Placed>(items: readonly T[], region: Region): Cluster<T>[] {
  if (items.length === 0) return [];
  const cellLng = Math.max(region.longitudeDelta / CELLS_ACROSS, 1e-6);
  const cellLat = Math.max(region.latitudeDelta / CELLS_ACROSS, 1e-6);
  const cells = new Map<string, T[]>();
  for (const item of items) {
    const key = `${Math.floor(item.lng / cellLng)}:${Math.floor(item.lat / cellLat)}`;
    const cell = cells.get(key);
    if (cell) cell.push(item);
    else cells.set(key, [item]);
  }
  return [...cells.entries()].map(([key, group]) => ({
    key,
    lat: group.reduce((sum, p) => sum + p.lat, 0) / group.length,
    lng: group.reduce((sum, p) => sum + p.lng, 0) / group.length,
    items: group,
  }));
}

/** A span that shows every point, with a little air around them. */
export function regionFor(points: readonly Placed[], padding = 1.4): Region | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    // A single place still gets a neighbourhood's worth of map, not a pin
    // in a void; the world never wraps past its edges.
    latitudeDelta: Math.min(170, Math.max(0.05, (maxLat - minLat) * padding)),
    longitudeDelta: Math.min(360, Math.max(0.05, (maxLng - minLng) * padding)),
  };
}

/** The whole world, for a profile with nothing placed yet. */
export const WORLD: Region = { latitude: 20, longitude: 0, latitudeDelta: 120, longitudeDelta: 360 };
