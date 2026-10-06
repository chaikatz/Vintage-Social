import { useEffect } from "react";
import { hasPlace } from "@/utils/geo";
import { geocodeMissing, type Point } from "@/utils/geocode";
import { reverseGeocodeCells } from "@/utils/reverseGeocode";

/**
 * Learn the places of a profile's photographs as soon as they load, in
 * the background, so "Places" opens on the answer instead of on "Placing
 * your photographs…". Older posts with words but no point are given one;
 * every point is given its town. Both are remembered on the phone, so
 * after the first time this costs nothing at all.
 */
export function usePlaceWarmup(posts: readonly { id: string; location: string | null; lat: number | null; lng: number | null }[]): void {
  // Keyed on the posts' places, not the array: a refetch that changes a
  // like count must not start the geocoder over.
  const signature = posts.map((p) => `${p.id}:${p.lat ?? ""}:${p.lng ?? ""}:${p.location ?? ""}`).join("|");
  useEffect(() => {
    if (posts.length === 0) return;
    let alive = true;
    const points: Point[] = posts.filter(hasPlace).map((p) => ({ lat: p.lat, lng: p.lng }));
    (async () => {
      await geocodeMissing(posts, (_id, point) => points.push(point), () => alive);
      if (!alive) return;
      await reverseGeocodeCells(points, () => undefined, () => alive);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [signature]); // posts is read through `signature`
}
