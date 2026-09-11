import { describe, expect, it } from "vitest";
import { CELLS_ACROSS, WORLD, clusterForRegion, hasPlace, regionFor } from "@/utils/geo";

const at = (id: string, lat: number, lng: number) => ({ id, lat, lng });

describe("photographs on a map", () => {
  it("groups neighbours into one pin when the map is zoomed out", () => {
    const world = clusterForRegion(
      [at("a", 40.71, -74.0), at("b", 40.73, -73.99), at("c", 48.85, 2.35)],
      WORLD,
    );
    expect(world).toHaveLength(2);
    const ny = world.find((c) => c.items.some((i) => i.id === "a"))!;
    expect(ny.items.map((i) => i.id).sort()).toEqual(["a", "b"]);
    expect(ny.lat).toBeCloseTo(40.72, 2);
  });

  it("lets them come apart when zoomed in", () => {
    const close = clusterForRegion(
      [at("a", 40.71, -74.0), at("b", 40.73, -73.99)],
      { latitude: 40.72, longitude: -74, latitudeDelta: 0.02, longitudeDelta: 0.02 },
    );
    expect(close).toHaveLength(2);
  });

  it("never loses a photograph in the grouping", () => {
    const items = Array.from({ length: 50 }, (_, i) => at(String(i), (i * 7) % 90, (i * 13) % 180));
    const clusters = clusterForRegion(items, WORLD);
    expect(clusters.flatMap((c) => c.items).map((i) => i.id).sort()).toEqual(items.map((i) => i.id).sort());
    expect(clusters.length).toBeLessThanOrEqual(items.length);
  });

  it("frames every point with some air, and a single point with a neighbourhood", () => {
    const one = regionFor([at("a", 51.5, -0.12)])!;
    expect(one.latitude).toBe(51.5);
    expect(one.latitudeDelta).toBeGreaterThanOrEqual(0.05);
    const two = regionFor([at("a", 40, -74), at("b", 48, 2)])!;
    expect(two.latitude).toBe(44);
    expect(two.longitude).toBe(-36);
    expect(two.longitudeDelta).toBeGreaterThan(76);
    expect(two.longitudeDelta).toBeLessThanOrEqual(360);
    expect(regionFor([])).toBeNull();
  });

  it("knows which posts have a place at all", () => {
    expect(hasPlace({ lat: 1, lng: 2 })).toBe(true);
    expect(hasPlace({ lat: null, lng: null })).toBe(false);
    expect(hasPlace({ lat: 1, lng: null })).toBe(false);
  });

  it("uses a few cells across, not one pin per photograph", () => {
    expect(CELLS_ACROSS).toBeGreaterThanOrEqual(3);
    expect(CELLS_ACROSS).toBeLessThanOrEqual(8);
  });
});
