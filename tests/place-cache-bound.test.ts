import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** The phone's files, in memory: name to text. */
const files = vi.hoisted(() => new Map<string, string>());

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-location", () => ({
  geocodeAsync: async (place: string) => [{ latitude: place.length % 90, longitude: 1 }],
  reverseGeocodeAsync: async () => [{ city: "Somewhere", region: null, country: "Nowhere" }],
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

import { setBounded, trimOldest } from "@/utils/diskCache";
import { POINTS_KEPT, geocodePlace } from "@/utils/geocode";
import { LABELS_KEPT, reverseGeocodeCells } from "@/utils/reverseGeocode";

describe("a map kept to its newest entries", () => {
  it("lets the oldest go first, and setting one again makes it the newest", () => {
    const m = new Map<string, number>();
    for (const k of ["a", "b", "c"]) setBounded(m, k, 1, 3);
    setBounded(m, "a", 2, 3);
    setBounded(m, "d", 1, 3);
    expect([...m.keys()]).toEqual(["c", "a", "d"]);
    trimOldest(m, 1);
    expect([...m.keys()]).toEqual(["d"]);
  });
});

describe("the places kept on the phone", () => {
  beforeAll(() => vi.useFakeTimers());
  afterAll(() => vi.useRealTimers());

  it("stay at a size that costs nothing to read, however many profiles are looked at", async () => {
    const asked = POINTS_KEPT + 300;
    for (let i = 0; i < asked; i++) await geocodePlace(`Place number ${i}`);
    await vi.advanceTimersByTimeAsync(1500); // the lazy write
    const stored = JSON.parse(files.get("doc/place-points.json") ?? "{}") as Record<string, unknown>;
    const keys = Object.keys(stored);
    expect(keys).toHaveLength(POINTS_KEPT);
    // The newest are the ones kept.
    expect(keys).toContain(`place number ${asked - 1}`);
    expect(keys).not.toContain("place number 0");
  });

  it("and so do the towns", async () => {
    const points = Array.from({ length: LABELS_KEPT + 200 }, (_, i) => ({ lat: (i % 170) - 85, lng: Math.floor(i / 170) * 7 - 170 }));
    // Asked a few hundred at a time, as the profiles on screen ask.
    for (let from = 0; from < points.length; from += 60) {
      const done = reverseGeocodeCells(points.slice(from, from + 60), () => undefined, () => true);
      await vi.runAllTimersAsync();
      await done;
    }
    await vi.advanceTimersByTimeAsync(1500);
    const stored = JSON.parse(files.get("doc/place-names.json") ?? "{}") as Record<string, unknown>;
    expect(Object.keys(stored).length).toBeLessThanOrEqual(LABELS_KEPT);
    expect(Object.keys(stored).length).toBeGreaterThan(LABELS_KEPT - 100);
  });
});
