import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default } }));
// What a visit reads besides the library: the phone's own stores, faked in memory.
vi.mock("@/darkroom/develop", () => ({ stillInLibrary: async () => null }));
vi.mock("@/darkroom/history", () => ({ developedRecently: () => false, localDay: () => "2026-11-23", seenWithin: () => false }));
vi.mock("@/darkroom/session", () => ({ keepChapter: () => undefined, recallChapter: () => null }));
vi.mock("@/darkroom/setAside", () => ({ isSetAside: () => false, setAsidePrints: () => [] }));

import {
  coverOf,
  FIRST_STRETCH_MS,
  HELD_PRINTS,
  kmBetween,
  lately,
  latelySpans,
  NIGHT_ENDS_HOUR,
  OCCASION_DAY_MIN,
  OCCASION_GAP_DAYS,
  OCCASION_MAX_DAYS,
  OCCASION_MIN,
  occasionDay,
  occasionHead,
  Occasions,
  occasionSpan,
  occasionsIn,
  occasionTitle,
  OCCASIONS_PER_READ,
  PAGES_PER_READ,
  PLACE_APART_KM,
  readSpan,
  spanKey,
} from "@/darkroom/occasions";
import { choiceOf, endingOf, type Chapter } from "@/components/darkroom/chapter";
import { Visit } from "@/components/darkroom/visit";
import {
  chapterAnnouncement,
  chapterName,
  CONTENTS_LATELY,
  CONTENTS_OCCASIONS,
  dayYearLabel,
  emptyPage,
  endPage,
  spanEnd,
  spanLabel,
  titleCardWords,
  yearsOfDay,
} from "@/components/darkroom/words";
import { captionFor } from "@/darkroom/labels";
import type { LibrarySource, Page, PageRequest, Print, Span, TimeRange } from "@/darkroom/types";

/**
 * Lately and the occasions of a library: found on the phone from the
 * dates alone, named plainly, read newest first a bounded page at a time,
 * and kept for the session.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min).getTime();

let n = 0;
function print(takenAt: number, over: Partial<Print> = {}): Print {
  n += 1;
  return { id: `o${n}`, uri: `ph://o${n}`, width: 4032, height: 3024, takenAt, subtypes: [], ...over };
}
/** `count` photographs from `from`, `step` apart. */
const run = (from: number, count: number, step = 10 * MIN, over: Partial<Print> = {}) =>
  Array.from({ length: count }, (_, i) => print(from + i * step, over));

/** A library that answers in capture order, and writes down every page it is asked for. */
class FakeLibrary implements LibrarySource {
  readonly prints: Print[];
  readonly pages: PageRequest[] = [];
  oldestAsked = 0;
  constructor(prints: readonly Print[]) {
    this.prints = [...prints].sort((a, b) => a.takenAt - b.takenAt || (a.id < b.id ? -1 : 1));
  }
  private within(r: TimeRange) {
    return this.prints.filter((p) => p.takenAt >= r.from && p.takenAt < r.to);
  }
  async count(range: TimeRange) {
    return this.within(range).length;
  }
  async page(request: PageRequest): Promise<Page> {
    this.pages.push(request);
    let list = this.within(request.range);
    if (request.order === "desc") list = list.reverse();
    return { prints: list.slice(0, request.first), hasNextPage: list.length > request.first };
  }
  async oldest() {
    this.oldestAsked += 1;
    return this.prints[0]?.takenAt ?? null;
  }
}

const dates = (o: { prints: Print[] }) => o.prints.map((p) => new Date(p.takenAt).getDate());

// ---------------------------------------------------------------------------

describe("an occasion", () => {
  it("is busy days no more than one quiet day apart, every photograph of them, the quiet day too", () => {
    const trip = [...run(at(2024, 5, 12, 9), 8), ...run(at(2024, 5, 13, 9), 6), print(at(2024, 5, 14, 12)), ...run(at(2024, 5, 15, 9), 7)];
    const found = occasionsIn(trip);
    expect(found).toHaveLength(1);
    expect(found[0].prints).toHaveLength(trip.length);
    expect(new Set(dates(found[0]))).toEqual(new Set([12, 13, 14, 15]));
    expect(found[0].last - found[0].first).toBe(3);
  });

  it("is two occasions when two quiet days fall between", () => {
    const found = occasionsIn([...run(at(2024, 5, 10, 9), 12), ...run(at(2024, 5, 13, 9), 12)]);
    expect(found).toHaveLength(2);
    // Newest first.
    expect(dates(found[0])[0]).toBe(13);
    expect(dates(found[1])[0]).toBe(10);
    expect(OCCASION_GAP_DAYS).toBe(2);
  });

  it("needs busy days, and enough photographs in all", () => {
    expect(OCCASION_DAY_MIN).toBe(5);
    expect(OCCASION_MIN).toBe(12);
    // Four a day for a week is a habit, not an occasion.
    const habit: Print[] = [];
    for (let d = 1; d <= 7; d++) habit.push(...run(at(2024, 2, d, 9), 4));
    expect(occasionsIn(habit)).toEqual([]);
    // One busy evening of eleven is not one yet; of twelve it is.
    expect(occasionsIn(run(at(2024, 2, 9, 19), 11))).toEqual([]);
    expect(occasionsIn(run(at(2024, 2, 9, 19), 12))).toHaveLength(1);
  });

  it("keeps a night out on the day it began, to four in the morning", () => {
    expect(NIGHT_ENDS_HOUR).toBe(4);
    expect(occasionDay(at(2024, 5, 15, 2))).toBe(occasionDay(at(2024, 5, 14, 22)));
    expect(occasionDay(at(2024, 5, 15, 5))).toBe(occasionDay(at(2024, 5, 14, 22)) + 1);
    // 21:00 to 03:00: one day of twelve, not two of six.
    const night = run(at(2024, 5, 14, 21), 13, 30 * MIN);
    const found = occasionsIn(night);
    expect(found).toHaveLength(1);
    expect(found[0].first).toBe(found[0].last);
    expect(occasionTitle(found[0].first, found[0].last)).toBe("June 14, 2024");
  });

  it("is never longer than a fortnight: a long run is read as several, from its newest day", () => {
    expect(OCCASION_MAX_DAYS).toBe(14);
    const month: Print[] = [];
    for (let d = 1; d <= 20; d++) month.push(...run(at(2024, 6, d, 9), 6));
    const found = occasionsIn(month);
    expect(found).toHaveLength(2);
    expect(found[0].last - found[0].first + 1).toBe(14);
    expect(dates(found[0])[0]).toBe(7);
    expect(found[1].last - found[1].first + 1).toBe(6);
    // Reading further back never changes the newest: with ten more days before, it is the same.
    const longer: Print[] = [...month];
    for (let d = 21; d <= 30; d++) longer.push(...run(at(2024, 5, d, 9), 6));
    expect(occasionsIn(longer)[0].prints.map((p) => p.id)).toEqual(found[0].prints.map((p) => p.id));
  });

  it("is two occasions where the places are known and far apart, and one where they are not", () => {
    const home = run(at(2024, 7, 2, 9), 12);
    const away = run(at(2024, 7, 3, 9), 12);
    const lisbon = { lat: 38.72, lng: -9.14 };
    const porto = { lat: 41.15, lng: -8.61 };
    expect(kmBetween(lisbon, porto)).toBeGreaterThan(PLACE_APART_KM);
    const places = new Map<string, { lat: number; lng: number }>([...home.map((p) => [p.id, lisbon] as const), ...away.map((p) => [p.id, porto] as const)]);
    expect(occasionsIn([...home, ...away], (p) => places.get(p.id) ?? null)).toHaveLength(2);
    // Where no place is known, the dates alone decide: one occasion.
    expect(occasionsIn([...home, ...away], () => null)).toHaveLength(1);
    expect(occasionsIn([...home, ...away])).toHaveLength(1);
    // Close by, still one.
    const sintra = { lat: 38.8, lng: -9.39 };
    expect(occasionsIn([...home, ...away], (p) => (home.includes(p) ? lisbon : sintra))).toHaveLength(1);
  });

  it("is named plainly by its dates, or by its place and month where the place is known", () => {
    const day = (y: number, m: number, d: number) => occasionDay(at(y, m, d));
    expect(occasionTitle(day(2024, 5, 14), day(2024, 5, 14))).toBe("June 14, 2024");
    expect(occasionTitle(day(2024, 5, 12), day(2024, 5, 15))).toBe("June 12–15, 2024");
    expect(occasionTitle(day(2024, 5, 30), day(2024, 6, 2))).toBe("June 30 – July 2, 2024");
    expect(occasionTitle(day(2023, 11, 28), day(2024, 0, 2))).toBe("December 28, 2023 – January 2, 2024");
    expect(occasionTitle(day(2024, 5, 12), day(2024, 5, 15), "Lisbon")).toBe("Lisbon · June 2024");
    expect(occasionTitle(day(2024, 5, 30), day(2024, 6, 2), "Lisbon")).toBe("Lisbon · June–July 2024");
    expect(occasionTitle(day(2023, 11, 28), day(2024, 0, 2), "Lisbon")).toBe("Lisbon · December 2023 – January 2024");
    // Never an exclamation, never an emoji: only words, figures, the dash and the middle dot.
    for (const t of [occasionTitle(day(2024, 1, 29), day(2024, 2, 1)), occasionTitle(day(2024, 1, 29), day(2024, 1, 29), "Porto")]) {
      expect(t).toMatch(/^[A-Za-z0-9 ,·–]+$/);
    }
    // The leap day is a day like any other.
    expect(occasionTitle(day(2024, 1, 28), day(2024, 2, 1))).toBe("February 28 – March 1, 2024");
    // The running head keeps a title that fits, and otherwise the place, or the month it began.
    expect(occasionHead("June 12–15, 2024", day(2024, 5, 12))).toBe("June 12–15, 2024");
    expect(occasionHead("December 28, 2023 – January 2, 2024", day(2023, 11, 28))).toBe("December 2023");
    expect(occasionHead("Lisbon · December 2023 – January 2024", day(2023, 11, 28), "Lisbon")).toBe("Lisbon");
  });

  it("opens as a stretch from four in the morning of its first day to four after its last, with its count and a cover", () => {
    const busiest = run(at(2024, 5, 13, 9), 9);
    const found = occasionsIn([...run(at(2024, 5, 12, 20), 6), ...busiest, ...run(at(2024, 5, 14, 23), 5, 40 * MIN)]);
    expect(found).toHaveLength(1);
    const span = occasionSpan(found[0]);
    expect(span.kind).toBe("occasion");
    expect(span.from).toBe(at(2024, 5, 12, 4));
    expect(span.to).toBe(at(2024, 5, 15, 4));
    // Every photograph lies inside it, the last night's too.
    for (const p of found[0].prints) expect(p.takenAt >= span.from && p.takenAt < span.to).toBe(true);
    expect(span.count).toBe(20);
    expect(span.title).toBe("June 12–14, 2024");
    expect(busiest.map((p) => p.id)).toContain(span.cover?.id);
    expect(spanKey(span)).toBe(`${span.from}:${span.to}`);
  });

  it("is covered by the weightiest photograph of its busiest day, nearest the middle", () => {
    const day = run(at(2024, 5, 13, 9), 7);
    expect(coverOf(day)?.id).toBe(day[3].id);
    // A copy sent back through a messaging app weighs less.
    const copies = run(at(2024, 5, 13, 9), 5, 10 * MIN, { filename: "IMG-20240613-WA0001.jpg" });
    const own = print(at(2024, 5, 13, 14), { filename: "IMG_0412.HEIC" });
    expect(coverOf([...copies, own])?.id).toBe(own.id);
    expect(coverOf([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("lately", () => {
  const zoneWas = process.env.TZ;
  afterEach(() => {
    if (zoneWas === undefined) delete process.env.TZ;
    else process.env.TZ = zoneWas;
  });

  const parts = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")} ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]}`;
  };
  const windows = (now: number, weekStartsOn?: number) =>
    Object.fromEntries(lately(now, weekStartsOn).map((w) => [w.kind, [parts(w.from), parts(w.to)]]));

  it("starts the week on a Monday, runs it to the end of today, and takes the last weekend that is over", () => {
    // Monday 23 November 2026.
    expect(windows(at(2026, 10, 23, 9))).toEqual({
      week: ["2026-11-23 0:00 Mon", "2026-11-24 0:00 Tue"],
      weekend: ["2026-11-21 0:00 Sat", "2026-11-23 0:00 Mon"],
      month: ["2026-11-1 0:00 Sun", "2026-11-24 0:00 Tue"],
    });
    // Sunday: the week is all of it, and this weekend is not over, so the last one is the one before.
    expect(windows(at(2026, 10, 29, 23, 59))).toEqual({
      week: ["2026-11-23 0:00 Mon", "2026-11-30 0:00 Mon"],
      weekend: ["2026-11-21 0:00 Sat", "2026-11-23 0:00 Mon"],
      month: ["2026-11-1 0:00 Sun", "2026-11-30 0:00 Mon"],
    });
    // A Saturday: the weekend before is last weekend.
    expect(windows(at(2026, 10, 28, 0, 1)).weekend).toEqual(["2026-11-21 0:00 Sat", "2026-11-23 0:00 Mon"]);
    // A week that began last month, and a month that began this week.
    expect(windows(at(2026, 11, 2, 12))).toMatchObject({
      week: ["2026-11-30 0:00 Mon", "2026-12-3 0:00 Thu"],
      month: ["2026-12-1 0:00 Tue", "2026-12-3 0:00 Thu"],
    });
    // A week that starts on a Sunday, where that is the custom.
    expect(windows(at(2026, 10, 25, 12), 0).week).toEqual(["2026-11-22 0:00 Sun", "2026-11-26 0:00 Thu"]);
  });

  it("knows the leap day, and the turn of the year", () => {
    expect(windows(at(2024, 1, 29, 12))).toEqual({
      week: ["2024-2-26 0:00 Mon", "2024-3-1 0:00 Fri"],
      weekend: ["2024-2-24 0:00 Sat", "2024-2-26 0:00 Mon"],
      month: ["2024-2-1 0:00 Thu", "2024-3-1 0:00 Fri"],
    });
    expect(windows(at(2027, 0, 1, 12))).toEqual({
      week: ["2026-12-28 0:00 Mon", "2027-1-2 0:00 Sat"],
      weekend: ["2026-12-26 0:00 Sat", "2026-12-28 0:00 Mon"],
      month: ["2027-1-1 0:00 Fri", "2027-1-2 0:00 Sat"],
    });
  });

  it("keeps every edge on a local midnight through a change of the clocks, in any zone", () => {
    for (const zone of ["Europe/Lisbon", "America/New_York", "Australia/Sydney", "Asia/Kolkata", "Pacific/Chatham"]) {
      process.env.TZ = zone;
      // The weeks either side of the spring and autumn changes, north and south.
      for (const now of [at(2024, 2, 31, 12), at(2024, 3, 2, 12), at(2024, 9, 27, 12), at(2024, 9, 29, 12), at(2024, 3, 7, 12)]) {
        for (const w of lately(now)) {
          const from = new Date(w.from);
          const to = new Date(w.to);
          expect([from.getHours(), from.getMinutes(), to.getHours(), to.getMinutes()], `${zone} ${w.kind}`).toEqual([0, 0, 0, 0]);
          expect(w.to).toBeGreaterThan(w.from);
        }
        const week = lately(now).find((w) => w.kind === "week")!;
        expect(new Date(week.from).getDay(), zone).toBe(1);
        expect(week.to - DAY - 2 * HOUR).toBeLessThanOrEqual(now);
        expect(week.to).toBeGreaterThan(now);
        const weekend = lately(now).find((w) => w.kind === "weekend")!;
        expect(new Date(weekend.from).getDay(), zone).toBe(6);
        expect(weekend.to).toBeLessThanOrEqual(now);
      }
    }
  });

  it("puts a photograph on its day by the clock on the wall, whatever the zone", () => {
    for (const zone of ["Europe/Lisbon", "America/Los_Angeles", "Pacific/Auckland"]) {
      process.env.TZ = zone;
      // The night the clocks went forward in Lisbon, and back in Auckland: 03:30 is still the night before.
      expect(occasionDay(at(2024, 2, 31, 3, 30)), zone).toBe(occasionDay(at(2024, 2, 30, 23)));
      expect(occasionDay(at(2024, 3, 7, 3, 30)), zone).toBe(occasionDay(at(2024, 3, 6, 23)));
      expect(occasionDay(at(2024, 3, 7, 4, 30)), zone).toBe(occasionDay(at(2024, 3, 6, 23)) + 1);
    }
  });

  it("counts what each stretch holds, leaves out an empty one, and one that holds just what another does", () => {
    const now = at(2026, 11, 2, 12); // Wednesday 2 December: this month began this week.
    const read = [
      ...run(at(2026, 11, 1, 9), 3),
      ...run(at(2026, 10, 30, 9), 4), // Monday, this week but last month
      ...run(at(2026, 10, 28, 9), 5), // last weekend
    ];
    const found = latelySpans(now, read);
    expect(found.map((f) => [f.span.title, f.span.count])).toEqual([
      ["This week", 7],
      ["Last weekend", 5],
      ["This month", 3],
    ]);
    // Only this month's three: it holds just what this week holds, from the 1st, so it is left out.
    const quiet = latelySpans(now, run(at(2026, 11, 1, 9), 3));
    expect(quiet.map((f) => f.span.title)).toEqual(["This week"]);
    expect(latelySpans(now, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("reading for occasions", () => {
  const NOW = at(2026, 10, 23, 12);

  /** A library of `years` years: an occasion every few weeks, a few photographs on most other days, screenshots among them. */
  function library(years = 3): Print[] {
    const out: Print[] = [];
    const start = new Date(2026 - years, 10, 23).getTime();
    let k = 0;
    for (let t = start; t < NOW - DAY; t += DAY) {
      k += 1;
      const d = new Date(t);
      if (k % 23 === 0) {
        // A weekend away: two busy days.
        out.push(...run(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10).getTime(), 9, 30 * MIN));
        out.push(...run(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 10).getTime(), 8, 30 * MIN));
      } else if (k % 3 === 0) {
        out.push(print(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18).getTime()));
        out.push(print(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 5).getTime(), { subtypes: ["screenshot"] }));
      }
    }
    // This week and last weekend.
    out.push(...run(at(2026, 10, 21, 11), 6), ...run(at(2026, 10, 23, 8), 2));
    return out;
  }

  it("finds this week, last weekend and this month, and the first occasions newest first, in a bounded read", async () => {
    const lib = new FakeLibrary(library());
    const reader = new Occasions(lib, NOW, lib.prints[0].takenAt);
    const view = await reader.first();
    expect(view.lately?.map((s) => s.title)).toEqual(["This week", "Last weekend", "This month"]);
    // Screenshots are never counted.
    const month = view.lately!.find((s) => s.kind === "month")!;
    const inMonth = lib.prints.filter((p) => p.takenAt >= month.from && p.takenAt < month.to && !p.subtypes.includes("screenshot"));
    expect(month.count).toBe(inMonth.length);
    expect(reader.printsOf(month)).toHaveLength(inMonth.length);
    expect(view.occasions.length).toBeGreaterThanOrEqual(OCCASIONS_PER_READ);
    // Newest first, none twice.
    const froms = view.occasions.map((s) => s.from);
    expect(froms).toEqual([...froms].sort((a, b) => b - a));
    expect(new Set(view.occasions.map(spanKey)).size).toBe(view.occasions.length);
    // Bounded: never more than a read's pages, never a page longer than 150, never the whole library.
    expect(lib.pages.length).toBeLessThanOrEqual(PAGES_PER_READ);
    expect(lib.pages.every((r) => r.first <= 150 && r.order === "desc")).toBe(true);
    expect(lib.pages.every((r) => r.range.to - r.range.from <= FIRST_STRETCH_MS * 16)).toBe(true);
    expect(view.more).toBe(true);
    // Asked again, nothing more is read.
    const asked = lib.pages.length;
    await reader.first();
    expect(lib.pages.length).toBe(asked);
  });

  it("reads each stretch once, back from the last, and holds every photograph of every occasion it settles", async () => {
    const lib = new FakeLibrary(library());
    const reader = new Occasions(lib, NOW, lib.prints[0].takenAt);
    let view = await reader.first();
    while (view.more) view = await reader.more();
    // The stretches read run back without a gap and without reading anything twice.
    for (let i = 1; i < lib.pages.length; i++) expect(lib.pages[i].range.to).toBeLessThanOrEqual(lib.pages[i - 1].range.to);
    // Every weekend away was found, whole.
    const expected = occasionsIn(lib.prints.filter((p) => !p.subtypes.includes("screenshot")));
    expect(view.occasions.map((s) => s.count)).toEqual(expected.map((o) => o.prints.length));
    for (const s of view.occasions) {
      const held = reader.printsOf(s)!;
      expect(held).toHaveLength(s.count);
      for (const p of held) expect(p.takenAt >= s.from && p.takenAt < s.to).toBe(true);
    }
    expect(view.more).toBe(false);
  });

  it("finds an occasion whole that the edge of a stretch, or of a page, falls across", async () => {
    // A trip across the first stretch's edge, 31 days back, with more photographs a day than a page holds.
    const edge = NOW - FIRST_STRETCH_MS;
    const trip: Print[] = [];
    for (let d = -2; d <= 2; d++) trip.push(...run(new Date(edge + d * DAY).setHours(9, 0, 0, 0), 70, 5 * MIN));
    const lib = new FakeLibrary([print(at(2020, 0, 1)), ...trip]);
    const reader = new Occasions(lib, NOW, at(2020, 0, 1));
    const view = await reader.first();
    expect(view.occasions).toHaveLength(1);
    expect(view.occasions[0].count).toBe(trip.length);
  });

  it("reads one at a time: asked twice while reading, the same read is waited for", async () => {
    const lib = new FakeLibrary(library(1));
    const reader = new Occasions(lib, NOW, lib.prints[0].takenAt);
    const [a, b] = await Promise.all([reader.first(), reader.first()]);
    expect(a).toEqual(b);
    const once = lib.pages.length;
    const again = new FakeLibrary(library(1));
    await new Occasions(again, NOW, again.prints[0].takenAt).first();
    expect(once).toBe(again.pages.length);
  });

  it("asks again, from where it got to, after a first read the library would not answer", async () => {
    const lib = new FakeLibrary(library(1));
    let failing = true;
    const flaky: LibrarySource = {
      count: (r) => lib.count(r),
      oldest: () => lib.oldest(),
      page: (r) => (failing && lib.pages.length >= 2 ? Promise.reject(new Error("no")) : lib.page(r)),
    };
    const reader = new Occasions(flaky, NOW, lib.prints[0].takenAt);
    await expect(reader.first()).rejects.toThrow();
    expect(reader.ready).toBe(false);
    failing = false;
    const view = await reader.first();
    expect(reader.ready).toBe(true);
    expect(view.lately?.length).toBeGreaterThan(0);
    expect(view.occasions.length).toBeGreaterThan(0);
  });

  it("keeps no more than a bounded number of photographs: further back, an occasion is listed and read again when opened", async () => {
    // Forty weekends of 300 photographs: far more than the session keeps.
    const prints: Print[] = [];
    for (let w = 0; w < 40; w++) {
      const sat = new Date(2026, 9, 31 - w * 7, 9).getTime();
      prints.push(...run(sat, 150, 3 * MIN), ...run(sat + DAY, 150, 3 * MIN));
    }
    const lib = new FakeLibrary(prints);
    const reader = new Occasions(lib, NOW, lib.prints[0].takenAt);
    let view = await reader.first();
    while (view.more) view = await reader.more();
    expect(view.occasions).toHaveLength(40);
    const held = view.occasions.filter((s) => reader.printsOf(s) != null);
    expect(held.reduce((n, s) => n + s.count, 0)).toBeLessThanOrEqual(HELD_PRINTS);
    // The newest are the ones kept; one further back is still listed, whole.
    expect(reader.printsOf(view.occasions[0])).toHaveLength(300);
    const far = view.occasions[view.occasions.length - 1];
    expect(reader.printsOf(far)).toBeNull();
    expect(far.count).toBe(300);
    expect(await readSpan(lib, far)).toHaveLength(300);
  });

  it("asks an empty library nothing, and says so", async () => {
    const lib = new FakeLibrary([]);
    const reader = new Occasions(lib, NOW, null);
    expect(await reader.first()).toEqual({ lately: [], occasions: [], more: false });
    expect(lib.pages).toHaveLength(0);
  });

  it("is kept for the session by the room: Contents opened again reads nothing, and a changed library is read afresh", async () => {
    const lib = new FakeLibrary(library(1));
    const visit = new Visit(lib);
    expect(visit.knownOccasions()).toBeNull();
    const first = await visit.occasions();
    const pages = lib.pages.length;
    const second = new Visit(lib);
    expect(second.knownOccasions()?.occasions.length).toBe(first.occasions.length);
    await second.occasions();
    expect(lib.pages.length).toBe(pages);
    // A stretch it found opens on its own photographs, without asking the library.
    const span = first.occasions[0];
    expect(await second.spanPrints(span)).toHaveLength(span.count);
    expect(lib.pages.length).toBe(pages);
    // The library changed: let go, and a stretch no longer held is read again, every photograph of it.
    second.libraryChanged(false);
    expect(second.knownOccasions()).toBeNull();
    const again = await second.spanPrints(span);
    expect(again.map((p) => p.id).sort()).toEqual((await visit.spanPrints(span)).map((p) => p.id).sort());
    expect(again).toHaveLength(span.count);
  });
});

// ---------------------------------------------------------------------------

describe("a stretch as a chapter", () => {
  const NOW = at(2026, 10, 23, 12);
  const span = (over: Partial<Span> = {}): Span => ({
    kind: "occasion",
    from: at(2024, 5, 12, 4),
    to: at(2024, 5, 16, 4),
    title: "June 12–15, 2024",
    head: "June 12–15, 2024",
    count: 86,
    cover: null,
    ...over,
  });

  it("is chosen in Contents as its own chapter, and choosing the one open leaves it be", () => {
    const s = span();
    const none = { showing: false, where: null, chapter: null };
    expect(choiceOf(none, "span", null, null, s)).toEqual({ mode: "span", year: null, month: 0, span: s, jump: false });
    const open = { showing: true, where: { mode: "span" as const, year: null, month: 0, span: s }, chapter: null };
    expect(choiceOf(open, "span", null, null, { ...s })).toBeNull();
    expect(choiceOf(open, "span", null, null, span({ from: s.from - DAY }))).not.toBeNull();
    // A stretch with no stretch is nothing to open.
    expect(choiceOf(none, "span", null, null, null)).toBeNull();
  });

  it("opens On this day at a year, and jumps to that year inside the day already open", () => {
    const prints = [print(at(2024, 10, 23, 9)), print(at(2021, 10, 23, 9)), print(at(2021, 10, 23, 10))];
    const where = { mode: "on-this-day" as const, year: null, month: 0 };
    const showing = { showing: true, where, chapter: { prints, index: 0 } };
    expect(choiceOf(showing, "on-this-day", 2021, null)).toEqual({ mode: "on-this-day", year: null, month: 0, startYear: 2021, jump: true });
    // The year in view: nothing to do.
    expect(choiceOf(showing, "on-this-day", 2024, null)).toBeNull();
    // From another chapter, a cut to the day at that year.
    const elsewhere = { showing: true, where: { mode: "surprise" as const, year: null, month: 0 }, chapter: { prints, index: 0 } };
    expect(choiceOf(elsewhere, "on-this-day", 2021, null)).toEqual({ mode: "on-this-day", year: null, month: 0, startYear: 2021, jump: false });
    // The line itself, with no year, leaves the day open as it is.
    expect(choiceOf(showing, "on-this-day", null, null)).toBeNull();
  });

  it("is named in the running head and on its card, and ends on its own end page", () => {
    const s = span();
    expect(chapterName("span", null, s)).toBe("June 12–15, 2024");
    expect(chapterAnnouncement("span", null, NOW, s)).toBe("June 12–15, 2024");
    expect(titleCardWords("span", null, 0, NOW, s)).toEqual({ eyebrow: CONTENTS_OCCASIONS, title: "June 12–15, 2024", year: false });
    const week = span({ kind: "week", title: "This week", head: "This week" });
    expect(titleCardWords("span", null, 0, NOW, week)?.eyebrow).toBe(CONTENTS_LATELY);
    const ch = { mode: "span", span: s, failed: false } as unknown as Chapter;
    expect(endingOf(ch, null)).toEqual({ kind: "span", span: s });
    const page = endPage({ kind: "span", span: s }, { now: NOW, limited: false, years: null });
    expect(page.title).toBe("That is everything from June 12–15, 2024.");
    expect(page.words.map((w) => w.act)).toEqual(["contents", "surprise", "library"]);
    expect(spanEnd(week)).toBe("That is everything from this week.");
    expect(spanEnd(span({ kind: "weekend", title: "Last weekend" }))).toBe("That is everything from last weekend.");
    expect(emptyPage("span", { now: NOW, limited: false }).words[0].act).toBe("contents");
    expect(spanLabel(s)).toBe("June 12–15, 2024, 86 photographs");
    expect(dayYearLabel(2021, 1)).toBe("2021, On this day, 1 photograph");
    expect(yearsOfDay(NOW)).toBe("November 23 in other years");
  });

  it("captions its prints as a year does: the date, and the day of the week", () => {
    const t = at(2024, 5, 15, 21);
    expect(captionFor(t, NOW, "span", null, null)).toEqual(captionFor(t, NOW, "year", null, null));
    expect(captionFor(t, NOW, "span", null, null).line).toBe("A Saturday");
  });
});

// ---------------------------------------------------------------------------

describe("the room's surfaces for them", () => {
  const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");

  it("lists LATELY and OCCASIONS in Contents, with a small cover kept by its own view", () => {
    const contents = read("src/components/darkroom/Contents.tsx");
    expect(contents).toMatch(/<Section title=\{CONTENTS_LATELY\}/);
    expect(contents).toMatch(/<Section title=\{CONTENTS_OCCASIONS\} aside=\{CONTENTS_NEWEST\}/);
    expect(contents).toMatch(/onPress=\{\(\) => onChoose\("span", null, null, span\)\}/);
    expect(contents).toMatch(/<Word label=\{EARLIER_OCCASIONS\} onPress=\{onEarlier\}/);
    // The cover: never in the image memory the app shares, never on disk.
    const cover = contents.slice(contents.indexOf("{cover !== undefined ? ("), contents.indexOf("<View style={stacked ? styles.lineStacked"));
    expect(cover).toMatch(/cachePolicy="none"/);
    expect(cover).not.toMatch(/memory-disk|cachePolicy="memory"|cachePolicy="disk"/);
    // The years of the day under On this day, each opening the day at that year.
    expect(contents).toMatch(/onPress=\{\(\) => onChoose\("on-this-day", y\.year\)\}/);
    // Still read on this iPhone, and said so.
    expect(contents).toMatch(/Everything here is read on this iPhone\. Nothing is sent\./);
  });

  it("reads them in the background line, once a session, after the first print and as Contents opens", () => {
    const visit = read("src/components/darkroom/visit.ts");
    expect(visit).toMatch(/new Occasions\(inBackground\(this\.source\), Date\.now\(\), oldest\)/);
    const room = read("src/darkroom/useDarkroom.ts");
    expect(room).toMatch(/\/\/ Lately and the first occasions, so Contents has them when it opens: once a session\.\s*void loadOccasions\(\);/);
    expect(read("src/components/darkroom/useContentsSheet.ts")).toMatch(/void room\.loadOccasions\(\);/);
    // Nothing of a stretch is written to the place on disk: it is found afresh each session.
    expect(read("src/darkroom/session.ts")).toMatch(/if \(p\.mode === "span"\) return;/);
  });

  it("never sends anything: the occasions are read from the library and nothing else", () => {
    const source = read("src/darkroom/occasions.ts");
    expect(source).not.toMatch(/fetch\(|supabase|expo-location|reverseGeocode|XMLHttpRequest/);
  });
});
