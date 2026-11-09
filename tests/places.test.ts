import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));

const { canSearchPlaces, placeFields, searchPlaces } = await import("@/api/places");
const { MAX_LOCATION_LENGTH, clampLocation } = await import("@/utils/validation");

describe("places without the native provider", () => {
  it("says so, and answers with nothing rather than pretending", async () => {
    expect(canSearchPlaces()).toBe(false);
    expect(await searchPlaces("Bar Pitti")).toEqual([]);
  });

  it("writes a chosen place's own name, id and point onto a post — and nothing without one", () => {
    expect(placeFields({ id: "apple:1", name: "Bar Pitti", subtitle: "New York", lat: 40.73, lng: -74.0, category: null })).toEqual({
      location: "Bar Pitti",
      place_id: "apple:1",
      lat: 40.73,
      lng: -74.0,
    });
    expect(placeFields(null)).toEqual({ location: null, place_id: null, lat: null, lng: null });
  });
});

describe("a place's name, as a post can keep it", () => {
  // posts_location_check (0005): char_length(location) <= 80, in characters.
  const chars = (t: string | null) => Array.from(t ?? "").length;

  it("is held to the database's limit, counted as Postgres counts", () => {
    expect(MAX_LOCATION_LENGTH).toBe(80);
    const long = "Hôtel 🌉 ".repeat(20);
    expect(chars(long)).toBeGreaterThan(80);
    const kept = clampLocation(long);
    expect(chars(kept)).toBeLessThanOrEqual(80);
    expect(long.startsWith(kept!)).toBe(true);
    // No character cut in half: every one of the kept is whole.
    expect(kept).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    // Eighty characters that are more than eighty UTF-16 units are kept whole.
    const emoji = "🌉".repeat(80);
    expect(emoji.length).toBe(160);
    expect(clampLocation(emoji)).toBe(emoji);
    expect(clampLocation(emoji + "🌉")).toBe(emoji);
  });

  it("is trimmed, and nothing at all is no place", () => {
    expect(clampLocation("  Leith  ")).toBe("Leith");
    expect(clampLocation("   ")).toBeNull();
    expect(clampLocation(null)).toBeNull();
    expect(clampLocation(undefined)).toBeNull();
    expect(clampLocation("a".repeat(80))).toBe("a".repeat(80));
    expect(clampLocation(`${"a".repeat(79)} b`)).toBe("a".repeat(79));
  });

  it("is what a place chosen from the map writes, with its id whole", () => {
    const name = "The Grand Old Harbour Hotel by the Water, with Its Gardens, Terrace Bar and Long Pier";
    const id = `apple:${"x".repeat(150)}`;
    const fields = placeFields({ id, name, subtitle: "Leith", lat: 55.97, lng: -3.17, category: null });
    expect(chars(fields.location)).toBe(80);
    expect(name.startsWith(fields.location!)).toBe(true);
    expect(fields.place_id).toBe(id);
  });
});
