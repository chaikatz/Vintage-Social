import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnswerBatch,
  cellKey,
  groupByPlace,
  placeLines,
  withAnswers,
  type PlaceLabel,
  type PlaceLine,
} from "@/utils/placeGroups";

/**
 * Places, drawn as the grid is: the lines of a list that draws only the
 * screens about the reader (`placeLines`), each line drawn again only when
 * what it shows changes, and the map's answers handed to the page together
 * (`AnswerBatch`) rather than one regrouping of every photograph per
 * answer. The list itself runs on the phone; its rules run here, on an
 * account shaped like the largest on the club today (163 photographs, 103
 * with a point over 42 cells, the rest words only).
 */

type P = { id: string; location: string | null; taken_at: string | null; created_at: string; lat: number | null; lng: number | null };

const posts: P[] = [];
for (let i = 0; i < 163; i++) {
  const cell = i % 42;
  const hasPoint = i < 103;
  posts.push({
    id: `p${i}`,
    location: `Spot ${i % 60}`,
    taken_at: null,
    created_at: new Date(Date.UTC(2020 + (i % 6), i % 12, 1 + (i % 27))).toISOString(),
    lat: hasPoint ? 40 + cell * 0.2 : null,
    lng: hasPoint ? -70 - (cell % 5) * 0.2 : null,
  });
}
const cellOf = (c: number) => cellKey(40 + c * 0.2, -70 - (c % 5) * 0.2);
const labelFor = (labels: Record<string, PlaceLabel | null>) => (p: P) =>
  p.lat != null && p.lng != null ? labels[cellKey(p.lat, p.lng)] ?? null : null;

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

afterEach(() => {
  vi.useRealTimers();
});

describe("the places as lines of a list", () => {
  it("are each place's heading and then its photographs three to a row, every photograph once", () => {
    const groups = groupByPlace(posts, () => null);
    const lines = placeLines(groups, 3);
    const rows = lines.filter((l) => l.kind === "row");
    const ids = rows.flatMap((l) => (l.kind === "row" ? l.posts.map((p) => p.id) : []));
    expect(ids).toHaveLength(posts.length);
    expect(new Set(ids).size).toBe(posts.length);
    for (const l of rows) if (l.kind === "row") expect(l.posts.length).toBeLessThanOrEqual(3);
    expect(lines.filter((l) => l.kind === "head")).toHaveLength(groups.length);
    // Keys are unique, so the list never warns or mixes two lines up.
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
    // Each place starts with its heading, then a first row with no gap above it.
    let previous: PlaceLine<P> | null = null;
    for (const l of lines) {
      if (l.kind === "row") expect(l.first).toBe(previous?.kind === "head");
      previous = l;
    }
  });

  it("say on each heading what the heading always said", () => {
    const NY: PlaceLabel = { city: "New York", region: "New York", country: "United States" };
    const shot = (id: string, location: string, taken: string) => ({ id, location, taken_at: taken, created_at: taken, lat: 40.7, lng: -74 });
    const groups = groupByPlace(
      [
        shot("a", "Bar Pitti", "2024-05-01T00:00:00Z"),
        shot("b", "The Met", "2019-09-10T00:00:00Z"),
        shot("c", "Central Park", "2020-06-01T00:00:00Z"),
        shot("d", "Katz's", "2021-06-01T00:00:00Z"),
        shot("e", "The High Line", "2022-06-01T00:00:00Z"),
      ],
      () => NY,
    );
    const [head] = placeLines(groups, 3);
    expect(head).toMatchObject({ kind: "head", key: "h|new york", title: "New York", placed: true, count: 5, meta: "UNITED STATES  ·  2019–2024" });
    expect(head.kind === "head" && head.spots).toMatch(/^[A-Z' ]+  ·  [A-Z' ]+  ·  [A-Z' ]+  ·  \+2$/);
    // No place at all: a quiet title, and nothing beneath it to say.
    const [none] = placeLines(groupByPlace([{ id: "x", location: null, taken_at: null, created_at: "bad", lat: null, lng: null }], () => null), 3);
    expect(none).toMatchObject({ kind: "head", placed: false, meta: "", spots: "" });
  });

  it("leave every row of a place the new name does not touch as it was, keyed and filled the same, as each name arrives", () => {
    const labels: Record<string, PlaceLabel | null> = {};
    let before = placeLines(groupByPlace(posts, labelFor(labels)), 3);
    let kept = 0;
    let redrawn = 0;
    for (let c = 0; c < 42; c++) {
      labels[cellOf(c)] = { city: `City ${c % 15}`, region: null, country: "X" };
      const after = placeLines(groupByPlace(posts, labelFor(labels)), 3);
      const was = new Map(before.map((l) => [l.key, l]));
      // The posts this name moved, and the places they left and joined.
      const moved = new Set(posts.filter((p) => p.lat != null && cellKey(p.lat, p.lng!) === cellOf(c)).map((p) => p.id));
      for (const line of after) {
        if (line.kind !== "row") continue;
        const old = was.get(line.key);
        const same = old?.kind === "row" && old.first === line.first && old.posts.length === line.posts.length && old.posts.every((p, i) => p === line.posts[i]);
        if (same) kept += 1;
        else redrawn += 1;
        // A row with none of the moved photographs in its place is never drawn again.
        const place = line.key.split("|")[1];
        const touched = after.some((l) => l.kind === "row" && l.key.split("|")[1] === place && l.posts.some((p) => moved.has(p.id)));
        const wasTouched = before.some((l) => l.kind === "row" && l.key.split("|")[1] === place && l.posts.some((p) => moved.has(p.id)));
        if (!touched && !wasTouched) expect(same, line.key).toBe(true);
      }
      before = after;
    }
    // Most rows are left alone as the names come in.
    expect(kept).toBeGreaterThan(redrawn * 4);
  });
});

describe("the map's answers, handed on together", () => {
  it("are the same record when they say nothing new, and a new one when they do", () => {
    const record: Record<string, PlaceLabel | null> = { a: null };
    expect(withAnswers(record, new Map<string, PlaceLabel | null>([["a", null]]))).toBe(record);
    const lisbon: PlaceLabel = { city: "Lisbon", region: null, country: "Portugal" };
    const next = withAnswers(record, new Map<string, PlaceLabel | null>([["a", null], ["b", lisbon]]));
    expect(next).not.toBe(record);
    expect(next).toEqual({ a: null, b: lisbon });
    expect(record).toEqual({ a: null });
  });

  it("reach the page at most once a second as a profile's places are named one by one, and at once when the pass ends", () => {
    vi.useFakeTimers();
    const applied: number[] = [];
    let labels: Record<string, PlaceLabel | null> = {};
    const batch = new AnswerBatch<PlaceLabel | null>((answers) => {
      applied.push(answers.size);
      labels = withAnswers(labels, answers);
    }, 1000);
    // Forty-two cells, each looked up in up to a few hundred ms and spaced 120 ms, as reverseGeocodeCells does.
    let t = 0;
    for (let c = 0; c < 42; c++) {
      const step = 120 + ((c * 37) % 300);
      vi.advanceTimersByTime(step);
      t += step;
      batch.add(cellOf(c), { city: `City ${c}`, region: null, country: "X" });
    }
    batch.flush();
    // Before, a regrouping of every photograph per answer: 42. Now one a second, and the last at the end.
    expect(applied.length).toBeLessThanOrEqual(Math.ceil(t / 1000) + 1);
    expect(applied.length).toBeLessThan(42 / 2);
    expect(applied.reduce((a, b) => a + b, 0)).toBe(42);
    expect(Object.keys(labels)).toHaveLength(42);
  });

  it("are handed on once their second is up, and never after the page has gone", () => {
    vi.useFakeTimers();
    const applied: string[][] = [];
    const batch = new AnswerBatch<number>((answers) => applied.push([...answers.keys()]), 1000);
    batch.add("a", 1);
    batch.add("b", 2);
    vi.advanceTimersByTime(999);
    expect(applied).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(applied).toEqual([["a", "b"]]);
    batch.flush();
    expect(applied).toHaveLength(1);
    batch.add("c", 3);
    batch.stop();
    vi.advanceTimersByTime(5000);
    expect(applied).toHaveLength(1);
  });
});

describe("the Places view", () => {
  const places = read("src/components/PlaceGroups.tsx")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("is a list that draws the screens about the reader, as the grid is, and not every photograph at once", () => {
    expect(places).not.toMatch(/<ScrollView\b|\bScrollView\b/);
    expect(places).toMatch(/<FlatList\s/);
    expect(places).toMatch(/windowSize=\{GRID_SCREENS\}/);
    expect(read("src/components/PhotoGrid.tsx")).toMatch(/export const GRID_SCREENS = 7;/);
    expect(places).toMatch(/keyExtractor=\{lineKey\}/);
    expect(places).toMatch(/const lines = useMemo\(\(\) => placeLines\(groups, ACROSS\), \[groups\]\);/);
    expect(places).toMatch(/data=\{posts\.length === 0 \|\| !settled \? NO_LINES : lines\}/);
    expect(places).not.toMatch(/groups\.map\(/);
  });

  it("draws a heading or a row again only when what it shows changes, with one press for every square", () => {
    expect(places).toMatch(/const PlaceHead = memo\(function PlaceHead\(/);
    expect(places).toMatch(/const PlaceRow = memo\(\s*function PlaceRow\(/);
    expect(places).toMatch(/a\.posts\.every\(\(post, i\) => post === b\.posts\[i\]\)/);
    expect(places).toMatch(/const openPost = useCallback\(\(post: GridPost\) => latestOpen\.current\(post\), \[\]\);/);
    expect(places).toMatch(/const renderLine = useCallback\([\s\S]*?\[size, openPost\],\s*\);/);
    expect(places).not.toMatch(/key=\{i\}/);
  });

  it("takes the map's answers through a batch, and shows the last of them with the page", () => {
    expect(places).toMatch(/geocodeMissing\(posts, \(id, point\) => pointBatch\.add\(id, point\), \(\) => alive\);/);
    expect(places).toMatch(/\(cell, label\) => labelBatch\.add\(cell, label\),/);
    expect(places).toMatch(/\(\) => \{\s*labelBatch\.flush\(\);\s*setSettled\(true\);\s*\},/);
    expect(places.match(/setLabels\(/g)).toHaveLength(1);
    expect(places.match(/setFound\(/g)).toHaveLength(1);
    expect(places).toMatch(/pointBatch\.stop\(\);\s*labelBatch\.stop\(\);/);
    expect(places).toMatch(/const ANSWERS_EVERY_MS = 1000;/);
  });
});

describe("an era being arranged", () => {
  const list = read("src/components/EraList.tsx");
  const grid = read("src/components/PhotoGrid.tsx");

  it("lays every print out, but asks for the pictures of an era only as it comes near, beyond what it shows anyway", () => {
    expect(list).toMatch(/const strip = eraStrip\(era, expanded \|\| arranging\);/);
    expect(list).toMatch(/const drawnStrip = arranging && !near \? eraStrip\(era, expanded\)\.length : strip\.length;/);
    expect(list).toMatch(/bare=\{i \* ERA_STRIP \+ j >= drawnStrip\}/);
    // The print hands it to its tile, which stands as its paper, at its size, with no picture asked for.
    expect(list).toMatch(/full=\{full\}\s*bare=\{bare\}/);
    expect(grid).toMatch(/\{bare \? \(\s*<View style=\{styles\.cell\} \/>\s*\) : url \? \(\s*<Image/);
    expect(grid).toMatch(/style=\{\{ width: size, height: height \?\? size \}\}/);
  });
});
