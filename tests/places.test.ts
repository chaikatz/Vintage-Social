import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));

const { canSearchPlaces, placeFields, searchPlaces } = await import("@/api/places");

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
