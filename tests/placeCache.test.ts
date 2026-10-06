import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-location", () => ({ geocodeAsync: async () => [], reverseGeocodeAsync: async () => [] }));
vi.mock("expo-file-system", () => ({ File: class {}, Paths: { document: "" } }));

import { parseStoredLabels } from "@/utils/reverseGeocode";
import { parseStoredPoints } from "@/utils/geocode";

/**
 * The place names and points kept on the phone between launches. A file
 * written by an older build, or a corrupted one, must come back as
 * nothing or as only its sound entries — never as a crash on launch.
 */
describe("the stored place names", () => {
  it("keeps names and remembered blanks, and drops what does not fit", () => {
    const parsed = parseStoredLabels({
      "40.7,-74.0": { city: "New York", region: "NY", country: "United States" },
      "48.8,2.3": { city: "Paris", region: 4, country: null },
      "0,0": null,
      junk: "not a label",
    });
    expect(parsed).toEqual({
      "40.7,-74.0": { city: "New York", region: "NY", country: "United States" },
      "48.8,2.3": { city: "Paris", region: null, country: null },
      "0,0": null,
    });
  });

  it("refuses a file that is not a map of cells", () => {
    expect(parseStoredLabels(null)).toBeNull();
    expect(parseStoredLabels([1, 2])).toBeNull();
    expect(parseStoredLabels("x")).toBeNull();
  });
});

describe("the stored points", () => {
  it("keeps finite points and remembered misses", () => {
    expect(parseStoredPoints({ lisbon: { lat: 38.7, lng: -9.1 }, nowhere: null, bad: { lat: "x", lng: 1 }, worse: { lat: Infinity, lng: 0 } })).toEqual({
      lisbon: { lat: 38.7, lng: -9.1 },
      nowhere: null,
    });
    expect(parseStoredPoints(42)).toBeNull();
  });
});
