import { describe, expect, it } from "vitest";
import {
  CELL_DEGREES,
  SPOTS_SHOWN,
  UNPLACED,
  UNPLACED_TITLE,
  cellKey,
  groupByPlace,
  labelFromAddress,
  titleFor,
  yearSpan,
  type PlaceLabel,
} from "@/utils/placeGroups";

type P = { id: string; location: string | null; taken_at: string | null; created_at: string; lat?: number; lng?: number };

const post = (id: string, location: string | null, taken: string, label?: PlaceLabel): P & { label?: PlaceLabel } => ({
  id,
  location,
  taken_at: taken,
  created_at: "2026-01-01T00:00:00Z",
  label,
});

const NY: PlaceLabel = { city: "New York", region: "New York", country: "United States" };
const LISBON: PlaceLabel = { city: "Lisbon", region: "Lisboa", country: "Portugal" };
const byLabel = (p: { label?: PlaceLabel }) => p.label ?? null;

describe("a profile read as places", () => {
  it("files the spots of one town under the town, and lists them small", () => {
    const groups = groupByPlace(
      [
        post("a", "Bar Pitti", "2024-05-01T00:00:00Z", NY),
        post("b", "The Met", "2023-09-10T00:00:00Z", NY),
        post("c", "Bar Pitti", "2022-06-01T00:00:00Z", NY),
        post("d", "Central Park", "2019-07-04T00:00:00Z", NY),
        post("e", "Alfama", "2024-01-01T00:00:00Z", LISBON),
      ],
      byLabel,
    );
    expect(groups.map((g) => g.title)).toEqual(["New York", "Lisbon"]);
    const ny = groups[0];
    expect(ny.posts.map((p) => p.id)).toEqual(["a", "b", "c", "d"]); // newest first, by the day taken
    expect(ny.subtitle).toBe("United States");
    expect(ny.years).toBe("2019–2024");
    expect(ny.spots).toEqual(["Bar Pitti", "Central Park", "The Met"]); // most photographed first, then A–Z
    expect(ny.more).toBe(0);
    expect(groups[1].subtitle).toBe("Portugal");
    expect(groups[1].years).toBe("2024");
    expect(groups[1].spots).toEqual(["Alfama"]);
  });

  it("names only a few spots and counts the rest", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const groups = groupByPlace(names.map((n, i) => post(n, n, `2024-0${i + 1}-01T00:00:00Z`, NY)), byLabel);
    expect(groups[0].spots).toHaveLength(SPOTS_SHOWN);
    expect(groups[0].more).toBe(names.length - SPOTS_SHOWN);
  });

  it("puts the most photographed place first, then the one visited most recently", () => {
    const groups = groupByPlace(
      [
        post("a", "x", "2020-01-01T00:00:00Z", LISBON),
        post("b", "y", "2025-01-01T00:00:00Z", { city: "Paris", region: null, country: "France" }),
        post("c", "z", "2021-01-01T00:00:00Z", NY),
        post("d", "w", "2022-01-01T00:00:00Z", NY),
      ],
      byLabel,
    );
    expect(groups.map((g) => g.title)).toEqual(["New York", "Paris", "Lisbon"]);
  });

  it("files words with no point under the words, and merges them with the town of the same name", () => {
    const groups = groupByPlace(
      [
        post("a", "Bar Pitti", "2024-05-01T00:00:00Z", NY),
        post("b", "new york", "2023-01-01T00:00:00Z"), // typed, never looked up
        post("c", "The Catskills", "2022-01-01T00:00:00Z"),
      ],
      byLabel,
    );
    expect(groups.map((g) => g.title)).toEqual(["New York", "The Catskills"]);
    expect(groups[0].posts.map((p) => p.id)).toEqual(["a", "b"]);
    expect(groups[0].spots).toEqual(["Bar Pitti"]); // the town's own name is not a spot
    expect(groups[1].subtitle).toBeNull(); // the map said nothing about it
    expect(groups[1].placed).toBe(true);
  });

  it("keeps photographs with no place at all together, last, under no name", () => {
    const groups = groupByPlace(
      [post("a", null, "2025-01-01T00:00:00Z"), post("b", "  ", "2025-02-01T00:00:00Z"), post("c", "Lisbon", "2020-01-01T00:00:00Z", LISBON)],
      byLabel,
    );
    expect(groups.map((g) => g.key)).toEqual(["lisbon", UNPLACED]);
    expect(groups[1].title).toBe(UNPLACED_TITLE);
    expect(groups[1].placed).toBe(false);
    expect(groups[1].posts).toHaveLength(2);
    expect(groups[1].spots).toEqual([]);
  });

  it("falls back to the region or the country when the map names no town", () => {
    expect(titleFor(post("a", "somewhere", "2024-01-01T00:00:00Z"), { city: null, region: "Catskill Mountains", country: "United States" })).toBe(
      "Catskill Mountains",
    );
    expect(titleFor(post("a", "somewhere", "2024-01-01T00:00:00Z"), { city: null, region: null, country: "Iceland" })).toBe("Iceland");
    expect(titleFor(post("a", "somewhere", "2024-01-01T00:00:00Z"), { city: null, region: null, country: null })).toBe("somewhere");
    expect(titleFor(post("a", null, "2024-01-01T00:00:00Z"), null)).toBeNull();
  });

  it("does not repeat the title as its own subtitle", () => {
    const groups = groupByPlace([post("a", "Reykjavík", "2024-01-01T00:00:00Z", { city: null, region: null, country: "Iceland" })], byLabel);
    expect(groups[0].title).toBe("Iceland");
    expect(groups[0].subtitle).toBeNull();
    expect(groups[0].spots).toEqual(["Reykjavík"]);
  });

  it("reads years from the day taken and tolerates a bad date", () => {
    expect(yearSpan([post("a", null, "2021-03-01T00:00:00Z")])).toBe("2021");
    expect(yearSpan([post("a", null, "not a date")])).toBeNull();
    expect(yearSpan([post("a", null, "2019-01-01T00:00:00Z"), post("b", null, "2024-12-31T00:00:00Z")])).toBe("2019–2024");
  });

  it("reduces the geocoder's answer to town, region, country — with a village's fallbacks", () => {
    expect(labelFromAddress({ city: "New York", region: "NY", country: "United States" })).toEqual(NY && { city: "New York", region: "NY", country: "United States" });
    expect(labelFromAddress({ city: null, subregion: "Ulster County", region: "New York", country: "United States" }).city).toBe("Ulster County");
    expect(labelFromAddress({ city: " ", district: "Alfama", region: null, country: "Portugal" }).city).toBe("Alfama");
    expect(labelFromAddress({})).toEqual({ city: null, region: null, country: null });
  });

  it("shares one lookup among nearby points", () => {
    expect(cellKey(40.7359, -73.9911)).toBe(cellKey(40.7359 + CELL_DEGREES / 3, -73.9911 - CELL_DEGREES / 3));
    expect(cellKey(40.7359, -73.9911)).not.toBe(cellKey(38.7223, -9.1393));
  });
});
