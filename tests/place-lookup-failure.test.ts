import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** The phone's files, in memory: name to text. */
const files = vi.hoisted(() => new Map<string, string>());
/** The system geocoder: whether it can be reached, and how often it was asked. */
const geocoder = vi.hoisted(() => ({ reachable: false, asked: [] as string[] }));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-location", () => ({
  geocodeAsync: async (place: string) => {
    geocoder.asked.push(place);
    // How expo-location says it on iOS: no signal (or the geocoder holding
    // back) throws; a place that does not exist is no results.
    if (!geocoder.reachable) throw new Error("Geocoding failed: network error");
    return place === "Atlantis" ? [] : [{ latitude: 38.72, longitude: -9.14 }];
  },
  reverseGeocodeAsync: async () => [],
}));
vi.mock("expo-file-system", () => ({
  Paths: { document: "doc", cache: "cache" },
  File: class {
    name: string;
    constructor(dir: string, name: string) {
      this.name = `${dir}/${name}`;
    }
    get exists() {
      return files.has(this.name);
    }
    create() {
      files.set(this.name, "");
    }
    write(text: string) {
      files.set(this.name, text);
    }
    textSync() {
      return files.get(this.name) ?? "";
    }
    delete() {
      files.delete(this.name);
    }
  },
}));

import { geocodePlace } from "@/utils/geocode";

describe("a place looked up with no signal", () => {
  beforeAll(() => vi.useFakeTimers());
  afterAll(() => vi.useRealTimers());

  it("is not remembered as nowhere: it is asked again once the signal is back", async () => {
    geocoder.reachable = false;
    expect(await geocodePlace("Lisbon")).toBeNull();
    await vi.advanceTimersByTimeAsync(1500); // the lazy write, had there been one
    const stored = JSON.parse(files.get("doc/place-points.json") ?? "{}") as Record<string, unknown>;
    expect("lisbon" in stored).toBe(false);

    geocoder.reachable = true;
    expect(await geocodePlace("Lisbon")).toEqual({ lat: 38.72, lng: -9.14 });
    expect(geocoder.asked.filter((p) => p === "Lisbon")).toHaveLength(2);
  });

  it("while a place that does not exist is remembered as such, and not asked again", async () => {
    geocoder.reachable = true;
    expect(await geocodePlace("Atlantis")).toBeNull();
    expect(await geocodePlace("Atlantis")).toBeNull();
    expect(geocoder.asked.filter((p) => p === "Atlantis")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
    const stored = JSON.parse(files.get("doc/place-points.json") ?? "{}") as Record<string, unknown>;
    expect(stored.atlantis).toBeNull();
    expect(stored.lisbon).toEqual({ lat: 38.72, lng: -9.14 });
  });
});
