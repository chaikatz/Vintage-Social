import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import type { NativePlace, VintagePlacesModule } from "../../modules/vintage-places";

/**
 * Named places for a post.
 *
 * The provider is Apple Maps, through the local module in
 * `modules/vintage-places`: real restaurants, hotels, landmarks and towns,
 * each with enough address to tell it from another of the same name, and
 * the place's own point. It needs no key or account. Where the module is
 * absent — the browser build, Android for now — `canSearchPlaces` says so
 * and the composer falls back to a typed place with no point.
 */

export type Place = NativePlace;

const native = Platform.OS === "ios" ? requireOptionalNativeModule<VintagePlacesModule>("VintagePlaces") : null;

export function canSearchPlaces(): boolean {
  return native != null;
}

/** Places matching what was typed, best first. Empty for a short or blank query. */
export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  if (!native) return [];
  const results = await native.search(q);
  return results
    .filter((p) => p && p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ ...p, category: p.category || null }));
}

/** What a chosen place writes onto the post: its name, its id, its point. */
export function placeFields(place: Place | null): { location: string | null; place_id: string | null; lat: number | null; lng: number | null } {
  if (!place) return { location: null, place_id: null, lat: null, lng: null };
  return { location: place.name, place_id: place.id, lat: place.lat, lng: place.lng };
}
