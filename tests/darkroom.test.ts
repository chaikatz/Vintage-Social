import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" }, Linking: { openSettings: async () => undefined } }));
vi.mock("expo-media-library", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
// The bundled photographs are images Metro resolves; here only their names matter.
vi.mock("@/demo/photoAssets", () => ({
  PHOTOS: new Proxy({}, { has: (_t, key) => typeof key === "string" && !key.startsWith("http"), get: () => 1 }),
}));

import { condense, isEligible, quality, READ_FAR_MS, REDISCOVERY_AGE_DAYS, representative, sameMoment } from "@/darkroom/eligibility";
import { mulberry32 } from "@/utils/shuffle";
import {
  anniversary,
  editSize,
  monthIndex,
  monthSlots,
  onThisDay,
  opensOnThisDay,
  ROLL_LENGTH,
  Surprise,
  yearIndex,
  YearEdit,
  yearRange,
  type SurpriseOptions,
  type YearCount,
} from "@/darkroom/discovery";
import {
  captionFor,
  countLabel,
  fullDate,
  MONTH_INITIALS,
  monthDay,
  monthName,
  monthYear,
  monthYearWords,
  shortDay,
  weekday,
  yearsInWords,
} from "@/darkroom/labels";
import { accessFrom } from "@/darkroom/access";
import { demoSourceAt } from "@/darkroom/demoSource";
import type { LibrarySource, Page, PageRequest, Print, TimeRange } from "@/darkroom/types";

// ---------------------------------------------------------------------------
// A fake library that writes down every question it is asked
// ---------------------------------------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Local time, the way the Darkroom reads dates. */
const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0) => new Date(y, m, d, h, min, s).getTime();
const NOW = at(2026, 9, 22, 12);

let n = 0;
function print(takenAt: number, over: Partial<Print> = {}): Print {
  n += 1;
  return { id: `p${n}`, uri: `ph://p${n}`, width: 4032, height: 3024, takenAt, subtypes: [], ...over };
}

class FakeLibrary implements LibrarySource {
  readonly prints: Print[];
  readonly calls = { count: [] as { range: TimeRange; subtype?: string }[], page: [] as PageRequest[], oldest: 0 };
  /** For each page asked for, how many photographs its range held: what Photos gathers before it hands back the first few. */
  readonly matched: number[] = [];
  inFlight = 0;
  maxInFlight = 0;
  private readonly times: number[];

  constructor(prints: readonly Print[]) {
    this.prints = [...prints].sort((a, b) => a.takenAt - b.takenAt);
    this.times = this.prints.map((p) => p.takenAt);
  }

  private async answer<T>(value: () => T): Promise<T> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await null;
    await null;
    try {
      return value();
    } finally {
      this.inFlight -= 1;
    }
  }

  /** The first photograph taken at or after `t`, by binary search, so a library of tens of thousands stays quick. */
  private index(t: number): number {
    let lo = 0;
    let hi = this.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private within(range: TimeRange) {
    return this.prints.slice(this.index(range.from), Math.max(this.index(range.from), this.index(range.to)));
  }

  count(range: TimeRange, subtype?: "screenshot") {
    this.calls.count.push({ range, subtype });
    return this.answer(() => this.within(range).filter((p) => !subtype || p.subtypes.includes(subtype)).length);
  }

  page(request: PageRequest): Promise<Page> {
    this.calls.page.push(request);
    return this.answer(() => {
      let list = this.within(request.range);
      this.matched.push(list.length);
      if (request.order === "desc") list = list.reverse();
      return { prints: list.slice(0, request.first), hasNextPage: list.length > request.first };
    });
  }

  oldest() {
    this.calls.oldest += 1;
    return this.answer(() => this.prints[0]?.takenAt ?? null);
  }
}

const yearOf = (p: Print) => new Date(p.takenAt).getFullYear();
const never = () => false;

function surprise(lib: LibrarySource, over: Partial<SurpriseOptions> = {}) {
  return new Surprise(lib, { now: NOW, seed: 7, oldest: null, seenWithin: never, held: never, ...over });
}

/** Photographs every `step` from `from`, `count` of them. */
function series(from: number, count: number, step: number, over: Partial<Print> = {}): Print[] {
  return Array.from({ length: count }, (_, i) => print(from + i * step, over));
}

/** A photograph on each of `days` days of a year, at noon, starting on the 3rd of January. */
function yearOfDays(year: number, days: number, over: Partial<Print> = {}): Print[] {
  return Array.from({ length: days }, (_, i) => print(at(year, 0, 3 + i, 12), over));
}

/**
 * A library that is mostly screenshots: up to two dozen a day from 2021,
 * and on one day in twenty-five an outing of five to thirty-four camera
 * frames, three minutes apart. About 24,000 items, 2,000 of them
 * photographs. Forty frames either side of a moment cover a day or two of
 * screenshots, so most reads find nothing that may be shown.
 */
function screenshotHeavy(): FakeLibrary {
  const rand = mulberry32(5);
  const prints: Print[] = [];
  for (let t = at(2021, 0, 1, 0); t < at(2026, 5, 1, 0); t += DAY) {
    const shots = Math.floor(rand() * 24);
    for (let i = 0; i < shots; i++) {
      prints.push(print(t + 8 * HOUR + rand() * 14 * HOUR, { subtypes: ["screenshot"], width: 1179, height: 2556 }));
    }
    if (rand() < 0.04) {
      const frames = 5 + Math.floor(rand() * 30);
      prints.push(...series(t + 10 * HOUR + rand() * 8 * HOUR, frames, 3 * MIN));
    }
  }
  return new FakeLibrary(prints);
}

/** A few photographs most days from 2012, and one more photograph at `stray`, alone at the far end of the library. */
function withStray(stray: number): FakeLibrary {
  const rand = mulberry32(5);
  const prints = [print(stray)];
  for (let t = at(2012, 0, 1); t < at(2026, 5, 1); t += DAY) {
    const k = Math.floor(rand() * 8);
    for (let i = 0; i < k; i++) prints.push(print(t + 9 * HOUR + rand() * 10 * HOUR));
  }
  return new FakeLibrary(prints);
}

beforeEach(() => {
  n = 0;
});

// ---------------------------------------------------------------------------
// Eligibility and quality
// ---------------------------------------------------------------------------

describe("what may be shown", () => {
  const t = at(2016, 4, 3);

  it("passes a camera's frame either way up", () => {
    expect(isEligible(print(t))).toBe(true);
    expect(isEligible(print(t, { width: 3024, height: 4032 }))).toBe(true);
  });

  it("leaves out screenshots, by subtype and by size", () => {
    expect(isEligible(print(t, { subtypes: ["screenshot"] }))).toBe(false);
    const screens = [
      [640, 1136], [750, 1334], [828, 1792], [1080, 1920], [1125, 2436], [1170, 2532], [1179, 2556],
      [1206, 2622], [1242, 2208], [1242, 2688], [1284, 2778], [1290, 2796], [1320, 2868],
    ];
    for (const [w, h] of screens) {
      expect(isEligible(print(t, { width: w, height: h }))).toBe(false);
      expect(isEligible(print(t, { width: h, height: w }))).toBe(false);
    }
    // A 16:9 camera frame that is not a screen's exact size is a photograph.
    expect(isEligible(print(t, { width: 1080, height: 1921 }))).toBe(true);
  });

  it("leaves out what a camera never writes: PNG, GIF, WebP", () => {
    expect(isEligible(print(t, { filename: "IMG_0412.HEIC" }))).toBe(true);
    expect(isEligible(print(t, { filename: "IMG_0413.JPG" }))).toBe(true);
    expect(isEligible(print(t, { filename: "meme.PNG" }))).toBe(false);
    expect(isEligible(print(t, { filename: "reaction.gif" }))).toBe(false);
    expect(isEligible(print(t, { filename: "sticker.webp" }))).toBe(false);
  });

  it("needs 320 pixels on the short side, and a shape no narrower than 1:2 unless it is a panorama", () => {
    expect(isEligible(print(t, { width: 320, height: 427 }))).toBe(true);
    expect(isEligible(print(t, { width: 319, height: 427 }))).toBe(false);
    expect(isEligible(print(t, { width: 4000, height: 2000 }))).toBe(true);
    expect(isEligible(print(t, { width: 4000, height: 1999 }))).toBe(false);
    expect(isEligible(print(t, { width: 12000, height: 3000, subtypes: ["panorama"] }))).toBe(true);
    expect(isEligible(print(t, { width: 0, height: 0 }))).toBe(false);
  });

  it("keeps photographs from before 1970, and refuses dates that only say the date was lost", () => {
    expect(isEligible(print(at(1962, 6, 14)))).toBe(true);
    expect(isEligible(print(at(1900, 0, 1, 0)))).toBe(true);
    expect(isEligible(print(at(1899, 11, 31)))).toBe(false);
    expect(isEligible(print(0))).toBe(false);
    expect(isEligible(print(35 * HOUR))).toBe(false);
    expect(isEligible(print(-35 * HOUR))).toBe(false);
    expect(isEligible(print(37 * HOUR))).toBe(true);
    expect(isEligible(print(-37 * HOUR))).toBe(true);
    expect(isEligible(print(Date.UTC(2001, 0, 1)))).toBe(false);
    expect(isEligible(print(Date.UTC(2001, 0, 1) + 1000))).toBe(true);
    expect(isEligible(print(Number.NaN))).toBe(false);
  });

  it("keeps to photographs older than 90 days when told the time, except where recent ones are allowed", () => {
    const recent = print(NOW - 89 * DAY);
    const old = print(NOW - REDISCOVERY_AGE_DAYS * DAY);
    expect(isEligible(recent)).toBe(true);
    expect(isEligible(recent, { now: NOW })).toBe(false);
    expect(isEligible(recent, { now: NOW, allowRecent: true })).toBe(true);
    expect(isEligible(old, { now: NOW })).toBe(true);
  });
});

describe("how much a photograph weighs", () => {
  it("is 1 for a camera's own frame", () => {
    expect(quality(print(at(2016, 4, 3), { filename: "IMG_2041.HEIC" }))).toBe(1);
  });

  it("weighs a copy that came back through an app at 0.35", () => {
    const t = at(2016, 4, 3);
    expect(quality(print(t, { filename: "IMG-20160503-WA0007.jpg" }))).toBeCloseTo(0.35);
    expect(quality(print(t, { filename: "3F2504E0-4F89-11D3-9A0C-0305E82C3301.jpg" }))).toBeCloseTo(0.35);
    expect(quality(print(t, { filename: "image.jpeg" }))).toBeCloseTo(0.35);
    expect(quality(print(t, { filename: "IMAGE.HEIC" }))).toBeCloseTo(0.35);
  });

  it("halves one too small for its era, with no floor before 2008", () => {
    expect(quality(print(at(2006, 1, 1), { width: 640, height: 480 }))).toBe(1);
    expect(quality(print(at(2010, 1, 1), { width: 960, height: 720 }))).toBeCloseTo(0.5); // 0.69 MP
    expect(quality(print(at(2010, 1, 1), { width: 1200, height: 800 }))).toBe(1); // 0.96 MP
    expect(quality(print(at(2015, 1, 1), { width: 1400, height: 1000 }))).toBeCloseTo(0.5); // 1.4 MP
    expect(quality(print(at(2015, 1, 1), { width: 1600, height: 1000 }))).toBe(1); // 1.6 MP
  });

  it("weighs a panorama, or anything longer than 3:1, at 0.6, and multiplies the factors", () => {
    expect(quality(print(at(2016, 1, 1), { width: 12000, height: 3000, subtypes: ["panorama"] }))).toBeCloseTo(0.6);
    expect(quality(print(at(2016, 1, 1), { width: 2000, height: 2000, subtypes: ["panorama"] }))).toBeCloseTo(0.6);
    expect(quality(print(at(2016, 1, 1), { width: 3100, height: 1000 }))).toBeCloseTo(0.6);
    expect(quality(print(at(2016, 1, 1), { width: 3000, height: 1000 }))).toBe(1);
    expect(
      quality(print(at(2016, 1, 1), { width: 1300, height: 400, filename: "IMG-20160101-WA0001.jpg" })),
    ).toBeCloseTo(0.35 * 0.5 * 0.6);
  });
});

// ---------------------------------------------------------------------------
// Moments
// ---------------------------------------------------------------------------

describe("moments", () => {
  it("fold a burst into its largest frame, and of equals the later one", () => {
    const t = at(2015, 6, 4, 20);
    const burst = [print(t), print(t + 5_000), print(t + 40_000, { width: 4000, height: 3000 })];
    expect(representative(burst).id).toBe(burst[1].id);
    const apart = print(t + 40_000 + 91_000);
    expect(condense([apart, ...burst]).map((p) => p.id)).toEqual([burst[1].id, apart.id]);
  });

  it("last no longer than five minutes, so a concert shot every minute is many moments, not one", () => {
    const concert = series(at(2018, 5, 1, 20), 200, 60_000);
    const moments = condense(concert);
    // Six frames to a moment (0, 1, … 5 minutes), so 200 frames are 34 moments.
    expect(moments).toHaveLength(34);
    for (let i = 1; i < moments.length; i++) expect(moments[i].takenAt).toBeGreaterThan(moments[i - 1].takenAt);
  });

  it("read an import pile as one occasion and keep at most two of it", () => {
    const t = at(2011, 2, 1, 9);
    const pile = Array.from({ length: 25 }, (_, i) =>
      print(t + (i % 7) * 100, { filename: i === 3 || i === 9 ? "scan.jpg" : "IMG-20110301-WA0001.jpg" }),
    );
    const later = print(t + 2 * MIN);
    const moments = condense([...pile, later]);
    expect(moments).toHaveLength(3);
    // The pile's two are its weightiest frames.
    expect(moments.slice(0, 2).map((p) => p.id).sort()).toEqual([pile[3].id, pile[9].id].sort());
    expect(moments[2].id).toBe(later.id);
    // Nineteen frames in one second are a burst: one moment.
    expect(condense(Array.from({ length: 19 }, () => print(t)))).toHaveLength(1);
  });

  it("count a frame read twice once", () => {
    const a = print(at(2012, 1, 1, 9));
    const b = print(at(2012, 1, 1, 15));
    expect(condense([a, b, a, b])).toHaveLength(2);
  });

  it("know a shown frame's moment by the frame itself, wherever a page or a slice cut it", () => {
    const t = at(2016, 4, 3, 10);
    // A frame a minute for ten minutes, then one two minutes after.
    const run = series(t, 11, MIN);
    const apart = print(t + 12 * MIN);
    const all = [...run, apart];
    // From the first frame, five minutes' worth: no further than a moment lasts.
    expect([...sameMoment(all, (p) => p.id === run[0].id)].sort()).toEqual(run.slice(0, 6).map((p) => p.id).sort());
    // From the middle, five minutes either way; not the frame after the gap.
    const middle = sameMoment(all, (p) => p.id === run[5].id);
    expect(middle.size).toBe(11);
    expect(middle.has(apart.id)).toBe(false);
    expect(sameMoment(all, () => false).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Contents
// ---------------------------------------------------------------------------

describe("the year index", () => {
  it("counts each year without its screenshots, oldest first, and leaves out empty years", async () => {
    const lib = new FakeLibrary([
      print(at(2011, 3, 1)),
      print(at(2011, 7, 1)),
      print(at(2013, 1, 1)),
      print(at(2013, 1, 2), { subtypes: ["screenshot"] }),
      print(at(2014, 5, 1), { subtypes: ["screenshot"] }),
    ]);
    expect(await yearIndex(lib, NOW)).toEqual([
      { year: 2011, count: 2 },
      { year: 2013, count: 1 },
    ]);
    expect(lib.calls.page).toHaveLength(0);
  });

  it("opens only the decades that hold photographs, and counts years before 1970", async () => {
    const lib = new FakeLibrary([print(at(1962, 5, 1)), print(at(2019, 5, 1))]);
    const years = await yearIndex(lib, NOW);
    expect(years.map((y) => y.year)).toEqual([1962, 2019]);
    // Seven decades counted once each, and the lost dates in the three that touch
    // one (the turn of 1970 falls in the 1960s and the 1970s, Photos' reference
    // date in the 2000s); then the eighteen years of the two filled decades
    // (1962–69, 2010–19) twice each — all, and screenshots — not 65 years; and
    // 1969 once more, for the lost dates at the turn of 1970.
    expect(lib.calls.count).toHaveLength(7 + 3 + 18 * 2 + 1);
    expect(lib.maxInFlight).toBeLessThanOrEqual(4);
  });

  it("is empty for an empty library", async () => {
    expect(await yearIndex(new FakeLibrary([]), NOW)).toEqual([]);
  });

  it("does not open a decade whose only photograph is a lost date", async () => {
    const lib = new FakeLibrary([print(0), print(at(2015, 3, 1)), print(at(2016, 3, 1))]);
    expect(await yearIndex(lib, NOW)).toEqual([
      { year: 2015, count: 1 },
      { year: 2016, count: 1 },
    ]);
    // The years counted one by one are those of the 2010s, the one decade that holds a real photograph; not one of the 1970s.
    const counted = lib.calls.count
      .map((c) => c.range)
      .filter((r) => {
        const year = yearRange(new Date(r.from).getFullYear());
        return r.from === year.from && r.to === year.to;
      })
      .map((r) => new Date(r.from).getFullYear());
    expect(new Set(counted)).toEqual(new Set(Array.from({ length: 10 }, (_, i) => 2010 + i)));
  });

  it("does not offer a year whose only photographs carry a lost date", async () => {
    const lib = new FakeLibrary([
      print(0),
      print(20 * HOUR),
      print(Date.UTC(2001, 0, 1)),
      print(Date.UTC(2001, 0, 1) + DAY),
      print(at(2015, 3, 1)),
    ]);
    const years = await yearIndex(lib, NOW);
    expect(years.map((y) => y.year)).toEqual([new Date(Date.UTC(2001, 0, 1) + DAY).getFullYear(), 2015]);
    expect(years[0].count).toBe(1);
  });

  it("counts a year's months, January first, without screenshots", async () => {
    const lib = new FakeLibrary([
      print(at(2016, 0, 3)),
      print(at(2016, 5, 3, 9)),
      print(at(2016, 5, 3, 18)),
      print(at(2016, 5, 4), { subtypes: ["screenshot"] }),
      print(at(2016, 10, 1)),
    ]);
    expect(await monthIndex(lib, 2016)).toEqual([1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0]);
    expect(lib.calls.count).toHaveLength(24);
    expect(lib.maxInFlight).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// On this day
// ---------------------------------------------------------------------------

describe("on this day", () => {
  it("sweeps the years oldest first: each year's middle moment, then the rest of each year in time order", async () => {
    const lib = new FakeLibrary([
      print(at(2012, 9, 22, 9)),
      print(at(2012, 9, 22, 13)),
      print(at(2012, 9, 22, 18)),
      print(at(2019, 9, 22, 11)),
      print(at(2023, 9, 22, 8)),
      print(at(2023, 9, 22, 21)),
      print(at(2026, 9, 22, 8)), // today itself is not a memory
      print(at(2019, 9, 23, 8)), // the next day is not the day
    ]);
    const day = await onThisDay(lib, { now: NOW });
    expect(day.reach).toBe("day");
    const hours = day.prints.map((p) => `${yearOf(p)} ${new Date(p.takenAt).getHours()}`);
    expect(hours).toEqual(["2012 13", "2019 11", "2023 8", "2012 9", "2012 18", "2023 21"]);
  });

  it("finds its years from the oldest photograph alone, without counting anything", async () => {
    const lib = new FakeLibrary([print(at(2009, 2, 1)), print(at(2014, 9, 22, 9)), print(at(2017, 9, 22, 9)), print(at(2020, 9, 22, 9))]);
    const day = await onThisDay(lib, { now: NOW });
    expect(day.prints.map(yearOf)).toEqual([2014, 2017, 2020]);
    expect(lib.calls.count).toHaveLength(0);
    expect(lib.calls.oldest).toBe(1);
    // One day page for each year from 2009 to 2025.
    expect(lib.calls.page).toHaveLength(17);
  });

  it("counts decades first when the oldest photograph is a century back, and finds that one too", async () => {
    const lib = new FakeLibrary([print(at(1904, 9, 22, 10)), print(at(2016, 9, 22, 9)), print(at(2021, 9, 22, 9))]);
    const day = await onThisDay(lib, { now: NOW });
    expect(day.prints.map(yearOf)).toEqual([1904, 2016, 2021]);
    // 1900s … 2020s, and the lost dates in the 1960s, 1970s and 2000s.
    expect(lib.calls.count).toHaveLength(13 + 3);
    expect(lib.calls.page).toHaveLength(6 + 10 + 6); // 1904–09, the 2010s and 2020–25
  });

  it("uses an oldest date it is given instead of asking the library again", async () => {
    const lib = new FakeLibrary([print(at(2009, 2, 1)), print(at(2014, 9, 22, 9)), print(at(2017, 9, 22, 9)), print(at(2020, 9, 22, 9))]);
    const day = await onThisDay(lib, { now: NOW, oldest: lib.prints[0].takenAt });
    expect(day.prints.map(yearOf)).toEqual([2014, 2017, 2020]);
    expect(lib.calls.oldest).toBe(0);
    expect(lib.calls.page).toHaveLength(17);
    // The year index takes it too.
    expect(await yearIndex(lib, NOW, lib.prints[0].takenAt)).toEqual(await yearIndex(new FakeLibrary(lib.prints), NOW));
    expect(lib.calls.oldest).toBe(0);
    // A library already known to be empty is not asked anything at all.
    const empty = new FakeLibrary([]);
    expect(await onThisDay(empty, { now: NOW, oldest: null })).toEqual({ reach: "season", prints: [] });
    expect(await yearIndex(empty, NOW, null)).toEqual([]);
    expect(empty.calls).toEqual({ count: [], page: [], oldest: 0 });
  });

  it("does not read the anniversaries of a decade only a lost date opened", async () => {
    // The turn of 1970 opened the 1970s, and Photos' reference date the 2000s.
    for (const lost of [0, Date.UTC(2001, 0, 1)]) {
      const lib = new FakeLibrary([print(lost), print(at(2012, 9, 22, 9)), print(at(2016, 9, 22, 9)), print(at(2020, 9, 22, 9))]);
      const day = await onThisDay(lib, { now: NOW });
      expect(day.prints.map(yearOf)).toEqual([2012, 2016, 2020]);
      // Only the decades the real photographs are in: 2010 to last year.
      const read = new Set(lib.calls.page.map((r) => new Date(r.range.from).getFullYear()));
      expect([...read].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => 2010 + i));
    }
  });

  it("uses the years it is given, leaving out this year and impossible ones", async () => {
    const lib = new FakeLibrary([print(at(2014, 9, 22, 9)), print(at(2017, 9, 22, 9)), print(at(2020, 9, 22, 9))]);
    const day = await onThisDay(lib, { now: NOW, years: [2020, 2014, 2017, 2026, 1850, 2014] });
    expect(day.prints.map(yearOf)).toEqual([2014, 2017, 2020]);
    expect(lib.calls.oldest).toBe(0);
    expect(lib.calls.page).toHaveLength(3);
  });

  it("stays at the day when it holds three moments, so the room can open on it", async () => {
    const lib = new FakeLibrary([print(at(2015, 9, 22, 9)), print(at(2018, 9, 22, 9)), print(at(2021, 9, 22, 9)), print(at(2019, 9, 24))]);
    const day = await onThisDay(lib, { now: NOW });
    expect(day.reach).toBe("day");
    expect(day.prints).toHaveLength(3);
    expect(opensOnThisDay(day)).toBe(true);
    // Nothing wider than a day was read.
    for (const r of lib.calls.page) expect(r.range.to - r.range.from).toBeLessThanOrEqual(DAY + HOUR);
  });

  it("reaches to the week, keeping the anniversary's own photographs even beside a heavy trip", async () => {
    const trip: Print[] = [];
    for (let d = 19; d <= 21; d++) trip.push(...series(at(2015, 9, d, 8), 120, 5 * MIN));
    const onTheDay = [print(at(2015, 9, 22, 10)), print(at(2015, 9, 22, 19))];
    const lib = new FakeLibrary([...trip, ...onTheDay]);
    const day = await onThisDay(lib, { now: NOW });
    expect(day.reach).toBe("week");
    const ids = day.prints.map((p) => p.id);
    for (const p of onTheDay) expect(ids).toContain(p.id);
    expect(day.prints).toHaveLength(4);
  });

  it("reaches to the time of year when the week is thin too", async () => {
    const lib = new FakeLibrary([print(at(2014, 9, 22, 9)), print(at(2015, 10, 1, 9)), print(at(2019, 9, 10, 9))]);
    const day = await onThisDay(lib, { now: NOW });
    expect(day.reach).toBe("season");
    expect(day.prints.map(yearOf)).toEqual([2014, 2015, 2019]);
  });

  it("stops at the day when asked to, whatever it found", async () => {
    const lib = new FakeLibrary([print(at(2014, 9, 22, 9)), print(at(2015, 9, 21, 9))]);
    const day = await onThisDay(lib, { now: NOW, maxReach: "day" });
    expect(day).toMatchObject({ reach: "day" });
    expect(day.prints).toHaveLength(1);
    expect(opensOnThisDay(day)).toBe(false);
    for (const r of lib.calls.page) expect(r.range.to - r.range.from).toBeLessThanOrEqual(DAY + HOUR);
  });

  it("finds nothing, honestly, when there is nothing near the date", async () => {
    const lib = new FakeLibrary([print(at(2015, 2, 1))]);
    const day = await onThisDay(lib, { now: NOW });
    expect(day.prints).toEqual([]);
    expect(opensOnThisDay(day)).toBe(false);
  });

  it("takes at most four from a year, at least 45 minutes apart", async () => {
    const lib = new FakeLibrary(series(at(2016, 9, 22, 8), 50, 10 * MIN));
    const day = await onThisDay(lib, { now: NOW });
    expect(day.prints).toHaveLength(4);
    const times = day.prints.map((p) => p.takenAt).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(45 * MIN);
    // A morning burst of three minutes is one moment, so it gives one print.
    const burst = new FakeLibrary([...series(at(2016, 9, 22, 8), 4, MIN), ...series(at(2018, 9, 22, 9), 1, 0), ...series(at(2020, 9, 22, 9), 1, 0)]);
    expect((await onThisDay(burst, { now: NOW })).prints).toHaveLength(3);
  });

  it("does not lose a heavy day's afternoon to its morning", async () => {
    // A wedding: 500 frames, one every 100 seconds, from 08:00 to 21:51.
    const lib = new FakeLibrary(series(at(2017, 9, 22, 8), 500, 100_000));
    const day = await onThisDay(lib, { now: NOW });
    const hours = day.prints.map((p) => new Date(p.takenAt).getHours());
    expect(day.prints).toHaveLength(4);
    expect(hours.some((h) => h >= 14 && h < 18)).toBe(true);
    expect(hours.some((h) => h >= 20)).toBe(true);
    expect(lib.calls.page.every((r) => r.first <= 150)).toBe(true);
  });

  it("gives the 29th of February to the 28th in a common year", async () => {
    expect(anniversary(2023, 1, 29).getDate()).toBe(28);
    expect(anniversary(2024, 1, 29).getDate()).toBe(29);
    expect(anniversary(2023, 9, 22).getDate()).toBe(22);
    const leapDay = at(2028, 1, 29, 12);
    const lib = new FakeLibrary([print(at(2027, 1, 28, 9)), print(at(2024, 1, 29, 9)), print(at(2025, 1, 28, 9)), print(at(2025, 2, 1, 9))]);
    const day = await onThisDay(lib, { now: leapDay });
    expect(day.reach).toBe("day");
    expect(day.prints.map(yearOf)).toEqual([2024, 2025, 2027]);
    expect(captionFor(day.prints[2].takenAt, leapDay, "on-this-day", day.reach, null).line).toBe("One year ago today");
  });

  it("is never longer than forty", async () => {
    const prints: Print[] = [];
    for (let y = 2006; y <= 2025; y++) for (let h = 8; h <= 20; h += 3) prints.push(print(at(y, 9, 22, h)));
    const day = await onThisDay(new FakeLibrary(prints), { now: NOW });
    expect(day.prints).toHaveLength(40);
    // The first sweep has every year once, oldest first.
    expect(day.prints.slice(0, 20).map(yearOf)).toEqual(Array.from({ length: 20 }, (_, i) => 2006 + i));
  });
});

// ---------------------------------------------------------------------------
// Surprise me
// ---------------------------------------------------------------------------

describe("surprise", () => {
  /** Years of photographs, a few occasions a month, each a short run of frames. */
  const library = (from = 2010, to = 2026) => {
    const prints: Print[] = [];
    for (let y = from; y <= to; y++) {
      for (let m = 0; m < 12; m++) {
        for (const d of [4, 17]) {
          const t = at(y, m, d, 15);
          prints.push(print(t), print(t + 20_000), print(t + 4 * HOUR, { width: 3024, height: 4032 }));
        }
      }
    }
    return new FakeLibrary(prints);
  };

  it("deals a roll of 24 and no more, never from the last few months, never the same print twice", async () => {
    const lib = library();
    const s = surprise(lib, { years: await yearIndex(lib, NOW) });
    const picks = await s.next(30);
    expect(picks).toHaveLength(ROLL_LENGTH);
    expect(s.rollDone).toBe(true);
    expect(s.exhausted).toBe(false);
    expect(await s.next(3)).toEqual([]);
    for (const p of picks) expect(NOW - p.takenAt).toBeGreaterThanOrEqual(REDISCOVERY_AGE_DAYS * DAY);
    expect(new Set(picks.map((p) => p.id)).size).toBe(picks.length);
  });

  it("never repeats either of the last two picks' years", async () => {
    const lib = library(2010, 2015);
    const picks = await surprise(lib, { years: await yearIndex(lib, NOW) }).next(24);
    expect(picks).toHaveLength(24);
    for (let i = 1; i < picks.length; i++) {
      expect(yearOf(picks[i])).not.toBe(yearOf(picks[i - 1]));
      if (i > 1) expect(yearOf(picks[i])).not.toBe(yearOf(picks[i - 2]));
    }
  });

  it("gives no year more than its share of a roll, however heavy", async () => {
    const lib = library(2012, 2015);
    const years: YearCount[] = [
      { year: 2012, count: 1_000_000 },
      { year: 2013, count: 10 },
      { year: 2014, count: 10 },
      { year: 2015, count: 10 },
    ];
    const picks = await surprise(lib, { years, seed: 3 }).next(24);
    expect(picks).toHaveLength(24);
    const per = new Map<number, number>();
    for (const p of picks) per.set(yearOf(p), (per.get(yearOf(p)) ?? 0) + 1);
    // max(2, ceil(24 / 4) + 1)
    for (const count of per.values()) expect(count).toBeLessThanOrEqual(7);
    expect(per.get(2012)).toBe(7);
  });

  it("keeps each pick six hours from the last eight", async () => {
    // One year, a photograph every half hour for six weeks: plenty near any pick.
    const lib = new FakeLibrary(series(at(2016, 3, 1, 0), 2000, 30 * MIN));
    const picks = await surprise(lib, { years: await yearIndex(lib, NOW), seed: 5 }).next(24);
    expect(picks).toHaveLength(24);
    for (let i = 0; i < picks.length; i++) {
      for (let j = Math.max(0, i - 8); j < i; j++) {
        expect(Math.abs(picks[i].takenAt - picks[j].takenAt)).toBeGreaterThanOrEqual(6 * HOUR);
      }
    }
  });

  it("after two of one shape, deals the other shape when there is one", async () => {
    const prints: Print[] = [];
    for (let i = 0; i < 1500; i++) {
      const t = at(2017, 0, 1) + i * HOUR;
      prints.push(print(t));
      // The tall ones weigh less, so only the pacing brings them forward.
      prints.push(print(t + 20 * MIN, { width: 3024, height: 4032, filename: "IMG-20170101-WA0001.jpg" }));
    }
    const lib = new FakeLibrary(prints);
    const years = await yearIndex(lib, NOW);
    const shape = (p: Print) => (p.height > p.width ? "tall" : "wide");
    let tall = 0;
    let runs = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const picks = await surprise(lib, { years, seed }).next(24);
      tall += picks.filter((p) => shape(p) === "tall").length;
      for (let i = 2; i < picks.length; i++) {
        if (new Set([shape(picks[i]), shape(picks[i - 1]), shape(picks[i - 2])]).size === 1) runs += 1;
      }
    }
    // By weight alone about one pick in four would be tall, and a third of
    // all triples one shape. A run of three is left only where the six-hour
    // rule took every frame of the other shape out of the window read.
    expect(tall).toBeGreaterThan(240 * 0.4);
    expect(runs).toBeLessThanOrEqual(2);
  });

  it("halves the quiet window, 21 → 10 → 5 days, for the rest of the roll, before giving up", async () => {
    const lib = library(2010, 2014);
    const asked: number[] = [];
    // Everything was seen a week ago.
    const seenWithin = (_id: string, days: number) => {
      asked.push(days);
      return days > 7;
    };
    const s = surprise(lib, { years: await yearIndex(lib, NOW), seenWithin });
    const picks = await s.next(24);
    expect(picks).toHaveLength(24);
    const steps = asked.filter((d, i) => i === 0 || d !== asked[i - 1]);
    expect(steps).toEqual([21, 10, 5]);
    // A new roll starts strict again.
    s.anotherRoll(8);
    asked.length = 0;
    expect(await s.next(1)).toHaveLength(1);
    expect(asked[0]).toBe(21);
  });

  it("deals at a quiet window of no days at all when everything was seen today", async () => {
    const lib = library(2010, 2014);
    const asked = new Set<number>();
    const s = surprise(lib, {
      years: await yearIndex(lib, NOW),
      seenWithin: (_id, days) => {
        asked.add(days);
        return true;
      },
    });
    expect(await s.next(24)).toHaveLength(24);
    expect([...asked].sort((a, b) => a - b)).toEqual([5, 10, 21]);
  });

  it("never deals what is held — developed this year, or set aside", async () => {
    const lib = library(2010, 2013);
    const held = new Set(lib.prints.filter((_, i) => i % 2 === 0).map((p) => p.id));
    const picks = await surprise(lib, { years: await yearIndex(lib, NOW), held: (id) => held.has(id) }).next(24);
    expect(picks).toHaveLength(24);
    for (const p of picks) expect(held.has(p.id)).toBe(false);
  });

  it("is the same deal for the same seed, and a different one for another", async () => {
    const lib = library();
    const years = await yearIndex(lib, NOW);
    const oldest = lib.prints[0].takenAt;
    const deal = async (seed: number) => (await surprise(lib, { years, oldest, seed }).next(12)).map((p) => p.id);
    const first = await deal(42);
    expect(await deal(42)).toEqual(first);
    expect(await deal(43)).not.toEqual(first);
  });

  it("starts cold, from the library's whole span, before any year is counted", async () => {
    const lib = library(2010, 2016);
    const oldest = lib.prints[0].takenAt;
    const s = surprise(lib, { oldest });
    const first = await s.next(3);
    expect(first).toHaveLength(3);
    expect(lib.calls.count).toHaveLength(0);
    for (const p of first) {
      expect(p.takenAt).toBeGreaterThanOrEqual(oldest);
      expect(NOW - p.takenAt).toBeGreaterThanOrEqual(REDISCOVERY_AGE_DAYS * DAY);
    }
    s.setYears(await yearIndex(lib, NOW));
    const rest = await s.next(24);
    expect(rest).toHaveLength(21);
    expect(s.rollDone).toBe(true);
  });

  it("waits, rather than giving up, when it has neither an oldest date nor the years", async () => {
    const lib = library(2010, 2014);
    const s = surprise(lib);
    expect(await s.next(3)).toEqual([]);
    expect(s.exhausted).toBe(false);
    expect(lib.calls.page).toHaveLength(0);
    s.setYears(await yearIndex(lib, NOW));
    expect(await s.next(3)).toHaveLength(3);
  });

  it("uses a year of one or two photographs only once the larger years have nothing left", async () => {
    const lib = new FakeLibrary([print(at(2009, 5, 1)), ...yearOfDays(2012, 30), ...yearOfDays(2014, 30), ...yearOfDays(2016, 30)]);
    const picks = await surprise(lib, { years: await yearIndex(lib, NOW) }).next(24);
    expect(picks).toHaveLength(24);
    expect(picks.some((p) => yearOf(p) === 2009)).toBe(false);
  });

  it("another roll deals new prints, keeping this visit's out", async () => {
    const lib = library();
    const s = surprise(lib, { years: await yearIndex(lib, NOW) });
    const one = await s.next(24);
    expect(s.rollDone).toBe(true);
    s.anotherRoll(99);
    expect(s.rollDone).toBe(false);
    const two = await s.next(24);
    expect(two).toHaveLength(24);
    const shown = new Set(one.map((p) => p.id));
    for (const p of two) expect(shown.has(p.id)).toBe(false);
  });

  it("restores a roll: the deck's prints count toward its 24 and are never dealt again", async () => {
    const lib = library();
    const years = await yearIndex(lib, NOW);
    const deck = await surprise(lib, { years, seed: 1 }).next(10);
    const restored = surprise(lib, { years, seed: 2, exclude: deck.map((p) => p.id), alreadyDealt: deck.length });
    const rest = await restored.next(24);
    expect(rest).toHaveLength(14);
    expect(restored.rollDone).toBe(true);
    const ids = new Set(deck.map((p) => p.id));
    for (const p of rest) expect(ids.has(p.id)).toBe(false);
  });

  it("asks only small questions, and never counts", async () => {
    const lib = library();
    await surprise(lib, { years: await yearIndex(new FakeLibrary(lib.prints), NOW), oldest: lib.prints[0].takenAt }).next(24);
    expect(lib.calls.count).toHaveLength(0);
    expect(lib.calls.page.every((r) => r.first <= 40)).toBe(true);
    expect(lib.maxInFlight).toBeLessThanOrEqual(4);
  });

  it("says when there is nothing old enough", async () => {
    const lib = new FakeLibrary([print(NOW - 10 * DAY), print(NOW - 30 * DAY)]);
    const s = surprise(lib, { years: await yearIndex(lib, NOW), oldest: lib.prints[0].takenAt });
    expect(await s.next(5)).toEqual([]);
    expect(s.exhausted).toBe(true);
  });

  it("says when everything is held, without asking forever", async () => {
    const lib = library(2010, 2012);
    const s = surprise(lib, { years: await yearIndex(lib, NOW), held: () => true });
    expect(await s.next(5)).toEqual([]);
    expect(s.exhausted).toBe(true);
    expect(lib.calls.page.length).toBeLessThan(200);
  });

  it("never says it has seen everything before the years are counted", async () => {
    const lib = library(2010, 2012);
    const s = surprise(lib, { oldest: lib.prints[0].takenAt, held: () => true });
    // Nothing found from the library's whole span: not yet, rather than nothing at all.
    expect(await s.next(3)).toEqual([]);
    expect(s.exhausted).toBe(false);
    // With the years known and still nothing, it says so.
    s.setYears(await yearIndex(lib, NOW));
    expect(await s.next(3)).toEqual([]);
    expect(s.exhausted).toBe(true);
    expect(lib.calls.page.length).toBeLessThan(200);
  });

  it("reads no further than a year either side of a drawn moment, even across the library's whole span", async () => {
    // Four photographs a day for eighteen years: some 26,000.
    const prints: Print[] = [];
    for (let t = at(2008, 0, 1, 9); t < at(2026, 5, 1); t += DAY) for (const h of [0, 3, 6, 9]) prints.push(print(t + h * HOUR));
    const lib = new FakeLibrary(prints);
    const s = surprise(lib, { oldest: lib.prints[0].takenAt, seed: 4 });
    expect(await s.next(3)).toHaveLength(3);
    s.setYears(await yearIndex(new FakeLibrary(prints), NOW));
    expect(await s.next(24)).toHaveLength(21);
    for (const r of lib.calls.page) expect(r.range.to - r.range.from).toBeLessThanOrEqual(READ_FAR_MS);
    // Photos gathers a range's every photograph before it hands back forty: never
    // more than a year's worth here, where a read to the end of the library's span
    // once gathered half of it.
    expect(Math.max(...lib.matched)).toBeLessThanOrEqual(366 * 4);
  });

  describe("on a library heavy with screenshots", () => {
    it("deals whole rolls, one after another, without saying it has seen everything", async () => {
      const lib = screenshotHeavy();
      const years = await yearIndex(lib, NOW);
      for (const seed of [1, 2, 3]) {
        const s = surprise(lib, { years, oldest: lib.prints[0].takenAt, seed });
        expect(await s.next(24)).toHaveLength(24);
        expect(s.exhausted).toBe(false);
        s.anotherRoll(seed + 50);
        expect(await s.next(24)).toHaveLength(24);
        expect(s.exhausted).toBe(false);
      }
    });

    it("waits for the years when the cold start comes up short, then deals", async () => {
      const lib = screenshotHeavy();
      const years = await yearIndex(lib, NOW);
      for (const seed of [1, 3, 4, 5, 6]) {
        const s = surprise(lib, { oldest: lib.prints[0].takenAt, seed });
        const cold = await s.next(3);
        expect(s.exhausted).toBe(false);
        s.setYears(years);
        expect([...cold, ...(await s.next(3 - cold.length))]).toHaveLength(3);
      }
    });
  });

  it("is not pulled to the library's first month by one photograph alone at the far end", async () => {
    // A clock never set (the first of January 1970), and a stray scan dated 1904.
    for (const stray of [0, at(1904, 0, 1, 0)]) {
      const lib = withStray(stray);
      const years = await yearIndex(lib, NOW);
      const firstMonth = (p: Print) => p.takenAt >= at(2012, 0, 1, 0) && p.takenAt < at(2012, 1, 1, 0);
      let fromCold = 0;
      let fromYears = 0;
      for (let seed = 1; seed <= 40; seed++) {
        // Before the years are counted, from the library's whole span.
        const s = surprise(lib, { oldest: stray, seed });
        let first = await s.next(1);
        expect(s.exhausted).toBe(false);
        if (first.length === 0) {
          s.setYears(years);
          first = await s.next(1);
        }
        if (firstMonth(first[0])) fromCold += 1;
        // Once they are known, from the years, even for the first pick.
        const warm = (await surprise(lib, { oldest: stray, years, seed }).next(1))[0];
        if (firstMonth(warm) || warm.takenAt < at(2012, 0, 1, 0)) fromYears += 1;
      }
      // A draw over the whole span once found the first month of 2012 four times in five.
      expect(fromCold).toBeLessThanOrEqual(8);
      expect(fromYears).toBeLessThanOrEqual(2);
    }
  });

  describe("on small and skewed libraries", () => {
    it("does not stall on two tiny years beside two large ones", async () => {
      const prints: Print[] = [print(at(2012, 4, 1)), print(at(2014, 4, 1))];
      for (const y of [2024, 2025]) for (let d = 0; d < 300; d++) for (const h of [9, 12, 15, 18]) prints.push(print(at(y, 0, 5 + d, h)));
      const lib = new FakeLibrary(prints);
      const years = await yearIndex(lib, NOW);
      for (let seed = 1; seed <= 8; seed++) {
        const s = surprise(lib, { years, oldest: lib.prints[0].takenAt, seed });
        expect(await s.next(24)).toHaveLength(24);
        expect(s.exhausted).toBe(false);
        s.anotherRoll(seed + 100);
        expect(await s.next(24)).toHaveLength(24);
      }
    });

    it("deals every photograph of a limited selection of twenty, then says so", async () => {
      // A shared weekend and a shared birthday: twenty moments, close together in time.
      const prints = [...series(at(2019, 5, 1, 10), 12, 30 * MIN), ...series(at(2021, 2, 14, 12), 8, 20 * MIN)];
      const lib = new FakeLibrary(prints);
      for (let seed = 1; seed <= 4; seed++) {
        const s = surprise(lib, { years: await yearIndex(lib, NOW), oldest: lib.prints[0].takenAt, seed });
        const picks = await s.next(24);
        expect(picks).toHaveLength(20);
        expect(new Set(picks.map((p) => p.id)).size).toBe(20);
        expect(s.exhausted).toBe(true);
      }
    });

    it("deals a full roll from a selection of thirty in one small year and one large", async () => {
      const prints = [...series(at(2018, 7, 3, 9), 27, 40 * MIN), ...series(at(2020, 1, 1, 12), 3, 2 * DAY)];
      const lib = new FakeLibrary(prints);
      for (let seed = 1; seed <= 4; seed++) {
        const s = surprise(lib, { years: await yearIndex(lib, NOW), oldest: lib.prints[0].takenAt, seed });
        expect(await s.next(24)).toHaveLength(24);
        expect(s.rollDone).toBe(true);
      }
    });

    it("puts away a heavy year whose frames are none of them photographs", async () => {
      const junk = series(at(2015, 0, 1), 300, 6 * HOUR, { filename: "saved.PNG" });
      const lib = new FakeLibrary([...junk, ...yearOfDays(2016, 30), ...yearOfDays(2018, 30)]);
      const s = surprise(lib, { years: await yearIndex(lib, NOW), seed: 4 });
      expect(await s.next(24)).toHaveLength(24);
      expect(s.exhausted).toBe(false);
    });

    it("shows at most two of an import pile in a visit", async () => {
      const pile = Array.from({ length: 40 }, () => print(at(2017, 3, 1, 10)));
      const lib = new FakeLibrary([...pile, ...yearOfDays(2017, 10), ...yearOfDays(2019, 10)]);
      const s = surprise(lib, { years: await yearIndex(lib, NOW), oldest: lib.prints[0].takenAt });
      const picks = await s.next(24);
      const fromPile = new Set(pile.map((p) => p.id));
      expect(picks.filter((p) => fromPile.has(p.id)).length).toBeLessThanOrEqual(2);
      expect(picks).toHaveLength(22);
      expect(s.exhausted).toBe(true);
    });

    it("shows a year from before 1970", async () => {
      const lib = new FakeLibrary(yearOfDays(1962, 5));
      const s = surprise(lib, { years: await yearIndex(lib, NOW), oldest: lib.prints[0].takenAt });
      const picks = await s.next(24);
      expect(picks).toHaveLength(5);
      expect(picks.every((p) => yearOf(p) === 1962)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// By year
// ---------------------------------------------------------------------------

describe("a year as an edit", () => {
  it("is about 2.5·√N, at least 12 or the whole of a small year, at most 120", () => {
    expect(editSize(1204)).toBe(87);
    expect(editSize(0)).toBe(0);
    expect(editSize(5)).toBe(5);
    expect(editSize(20)).toBe(12);
    expect(editSize(100)).toBe(25);
    expect(editSize(10_000)).toBe(120);
  });

  it("shares its slots by the square root of each month, by largest remainder, at least one to every month", () => {
    expect(monthSlots([400, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 30)).toEqual([20, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Roots 10, 8, 6; quotas 4.17, 3.33, 2.5: floors 4, 3, 2, and the last slot to the largest remainder.
    expect(monthSlots([100, 64, 36, 0, 0, 0, 0, 0, 0, 0, 0, 0], 10)).toEqual([4, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Fewer slots than months with photographs: the fullest months get one each.
    expect(monthSlots([5, 50, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0], 2)).toEqual([0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    const skewed = monthSlots([10_000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 120);
    expect(skewed.slice(1)).toEqual(Array(11).fill(1));
    expect(skewed[0]).toBe(109);
    const months = [50, 30, 0, 200, 100, 100, 300, 150, 74, 100, 50, 50];
    const slots = monthSlots(months, editSize(1204));
    expect(slots.reduce((a, b) => a + b, 0)).toBe(87);
    months.forEach((m, i) => expect(slots[i] > 0).toBe(m > 0));
  });

  it("deals the edit in order, one print per slice, each slice its own page of time", async () => {
    const months = [50, 30, 0, 200, 100, 100, 300, 150, 74, 100, 50, 50];
    const prints: Print[] = [];
    months.forEach((count, m) => {
      const from = at(2016, m, 1, 0);
      const span = at(2016, m + 1, 1, 0) - from;
      for (let i = 0; i < count; i++) prints.push(print(from + Math.floor(((i + 0.5) * span) / count)));
    });
    const lib = new FakeLibrary(prints);
    const edit = new YearEdit(lib, 2016, { now: NOW, months: await monthIndex(lib, 2016), seenWithin: never });
    expect(edit.size).toBe(87);
    expect(edit.yearCount).toBe(1204);
    const all = await edit.next(200);
    expect(all).toHaveLength(87);
    expect(edit.done).toBe(true);
    for (let i = 1; i < all.length; i++) expect(all[i].takenAt).toBeGreaterThan(all[i - 1].takenAt);
    for (const r of lib.calls.page) {
      expect(r).toMatchObject({ first: 40, order: "asc" });
      expect(new Date(r.range.from).getMonth()).toBe(new Date(r.range.to - 1).getMonth());
    }
    // Paged by time: each page starts where the one before it ended, never by a cursor.
    const starts = lib.calls.page.map((r) => r.range.from);
    expect(lib.calls.page.slice(1).some((r) => r.range.from > starts[0])).toBe(true);
    expect(lib.calls.page.every((r) => !("after" in r))).toBe(true);
  });

  it("passes a slot from an empty slice to the next, and drops one left at the end of the month", async () => {
    // Three photographs in January: three slots, three slices of about ten days.
    const passed = new FakeLibrary([print(at(2015, 0, 5, 12)), print(at(2015, 0, 25, 10)), print(at(2015, 0, 25, 15))]);
    const one = new YearEdit(passed, 2015, { now: NOW, months: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], seenWithin: never });
    expect((await one.next(10)).map((p) => new Date(p.takenAt).getDate())).toEqual([5, 25, 25]);

    const dropped = new FakeLibrary([print(at(2015, 0, 2, 9)), print(at(2015, 0, 4, 12)), print(at(2015, 0, 15, 12))]);
    const two = new YearEdit(dropped, 2015, { now: NOW, months: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], seenWithin: never });
    expect(await two.next(10)).toHaveLength(2);
  });

  it("keeps a pick two hours from the one before it where it can", async () => {
    // January's middle slice holds three moments; the first slice is empty, so the middle one picks two.
    const lib = new FakeLibrary([print(at(2015, 0, 15, 10)), print(at(2015, 0, 15, 12)), print(at(2015, 0, 15, 13))]);
    const edit = new YearEdit(lib, 2015, { now: NOW, months: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], seenWithin: never });
    expect((await edit.next(10)).map((p) => new Date(p.takenAt).getHours())).toEqual([10, 13]);
    // Where it cannot, it takes the nearer one rather than nothing.
    const close = new FakeLibrary([print(at(2015, 0, 15, 12)), print(at(2015, 0, 15, 13))]);
    const tight = new YearEdit(close, 2015, { now: NOW, months: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], seenWithin: never });
    expect(await tight.next(10)).toHaveLength(2);
  });

  it("prefers a moment not seen lately, then the weightiest, then the one nearest the middle of its slice", async () => {
    const nearMiddle = print(at(2015, 0, 16, 9));
    const light = print(at(2015, 0, 12, 9), { filename: "IMG-20150112-WA0001.jpg" });
    const far = print(at(2015, 0, 20, 9));
    const lib = new FakeLibrary([nearMiddle, light, far]);
    const months = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const pick = async (seen: Set<string>) =>
      (await new YearEdit(lib, 2015, { now: NOW, months, seenWithin: (id) => seen.has(id) }).next(1))[0].id;
    expect(await pick(new Set())).toBe(nearMiddle.id);
    expect(await pick(new Set([nearMiddle.id]))).toBe(far.id);
    expect(await pick(new Set([nearMiddle.id, far.id]))).toBe(light.id);
  });

  it("reads lazily: the month it needs, then two more ahead, no further", async () => {
    const prints: Print[] = [];
    for (let m = 0; m < 12; m++) for (let d = 1; d <= 28; d += 3) prints.push(print(at(2014, m, d, 12)));
    const lib = new FakeLibrary(prints);
    const edit = new YearEdit(lib, 2014, { now: NOW, months: await monthIndex(lib, 2014), seenWithin: never });
    const first = await edit.next(1);
    expect(new Date(first[0].takenAt).getMonth()).toBe(0);
    const monthsRead = () => new Set(lib.calls.page.map((r) => new Date(r.range.from).getMonth()));
    await edit.next(0);
    expect([...monthsRead()].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    await edit.next(500);
    expect(monthsRead().size).toBe(12);
    expect(edit.done).toBe(true);
  });

  it("opens at a month and reads nothing before it", async () => {
    const prints: Print[] = [];
    for (let m = 0; m < 12; m++) prints.push(print(at(2014, m, 10)), print(at(2014, m, 20)));
    const lib = new FakeLibrary(prints);
    const edit = new YearEdit(lib, 2014, { now: NOW, months: await monthIndex(lib, 2014), fromMonth: 7, seenWithin: never });
    // Twenty-four photographs make an edit of twelve, one a month.
    expect(edit.size).toBe(12);
    const all = await edit.next(100);
    expect(all.map((p) => new Date(p.takenAt).getMonth())).toEqual([7, 8, 9, 10, 11]);
    for (const r of lib.calls.page) expect(r.range.from).toBeGreaterThanOrEqual(at(2014, 7, 1, 0));
  });

  it("pins the print the member came from in its own slice's place, and opens there", async () => {
    const prints: Print[] = [];
    for (let m = 0; m < 12; m++) for (let d = 2; d <= 28; d += 2) prints.push(print(at(2016, m, d, 12)));
    const lib = new FakeLibrary(prints);
    const months = await monthIndex(lib, 2016);
    const plain = await new YearEdit(lib, 2016, { now: NOW, months, fromMonth: 5, seenWithin: never }).next(200);
    // A June print the edit would not have chosen, seen yesterday.
    const pin = prints.find((p) => new Date(p.takenAt).getMonth() === 5 && !plain.some((q) => q.id === p.id))!;
    const edit = new YearEdit(lib, 2016, { now: NOW, months, pin, seenWithin: (id) => id === pin.id });
    const all = await edit.next(200);
    expect(new Date(all[0].takenAt).getMonth()).toBe(5);
    expect(edit.pinIndex).not.toBeNull();
    expect(all[edit.pinIndex!].id).toBe(pin.id);
    expect(all).toHaveLength(plain.length);
  });

  it("shows more of a year with shifted slices, never repeating what was shown", async () => {
    const prints: Print[] = [];
    for (let m = 0; m < 12; m++) for (let d = 1; d <= 28; d++) prints.push(print(at(2013, m, d, 12)));
    const lib = new FakeLibrary(prints);
    const months = await monthIndex(lib, 2013);
    const first = await new YearEdit(lib, 2013, { now: NOW, months, seenWithin: never }).next(200);
    const firstRanges = new Set(lib.calls.page.map((r) => `${r.range.from}-${r.range.to}`));
    lib.calls.page.length = 0;
    const more = await new YearEdit(lib, 2013, {
      now: NOW,
      months,
      shifted: true,
      exclude: first.map((p) => p.id),
      seenWithin: never,
    }).next(200);
    expect(more.length).toBeGreaterThan(0);
    const shown = new Set(first.map((p) => p.id));
    for (const p of more) expect(shown.has(p.id)).toBe(false);
    expect(lib.calls.page.some((r) => !firstRanges.has(`${r.range.from}-${r.range.to}`))).toBe(true);
  });

  it("never deals the rest of a burst MORE FROM has already shown", async () => {
    // A weekly outing of three bursts, each four frames two seconds apart.
    const prints: Print[] = [];
    for (let d = 0; d < 365; d += 7) for (const h of [10, 14, 18]) prints.push(...series(at(2016, 0, 3 + d, h, 20), 4, 2_000));
    const lib = new FakeLibrary(prints);
    const months = await monthIndex(lib, 2016);
    const first = await new YearEdit(lib, 2016, { now: NOW, months, seenWithin: never }).next(500);
    const more = await new YearEdit(lib, 2016, {
      now: NOW,
      months,
      shifted: true,
      exclude: first.map((p) => p.id),
      seenWithin: never,
    }).next(500);
    expect(more.length).toBeGreaterThan(40);
    const again = more.filter((p) => first.some((f) => Math.abs(f.takenAt - p.takenAt) <= 5 * MIN));
    expect(again).toEqual([]);
  });

  it("shows the current year's recent photographs, the one place they appear", async () => {
    const lib = new FakeLibrary([print(at(2026, 2, 3)), print(at(2026, 8, 30)), print(at(2026, 9, 10))]);
    const all = await new YearEdit(lib, 2026, { now: NOW, months: await monthIndex(lib, 2026), seenWithin: never }).next(10);
    expect(all).toHaveLength(3);
  });

  it("shows a year from before 1970", async () => {
    const lib = new FakeLibrary(series(at(1962, 0, 4, 12), 40, 9 * DAY));
    const years = await yearIndex(lib, NOW);
    expect(years).toEqual([{ year: 1962, count: 40 }]);
    const edit = new YearEdit(lib, 1962, { now: NOW, months: await monthIndex(lib, 1962), seenWithin: never });
    const all = await edit.next(100);
    expect(edit.size).toBe(16);
    expect(all.length).toBeGreaterThanOrEqual(12);
    expect(all.every((p) => yearOf(p) === 1962)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Only bounded questions
// ---------------------------------------------------------------------------

describe("the library is asked only bounded questions", () => {
  it("never a page longer than 150, never a cursor, never more than four at once", async () => {
    const prints: Print[] = [...series(at(2017, 9, 22, 8), 500, 100_000), print(at(1962, 9, 22, 9))];
    for (let y = 2008; y <= 2025; y++) for (let d = 0; d < 360; d += 2) prints.push(print(at(y, 0, 1 + d, 10)));
    const lib = new FakeLibrary(prints);
    const years = await yearIndex(lib, NOW);
    const roll = surprise(lib, { years, oldest: lib.prints[0].takenAt });
    await Promise.all([
      onThisDay(lib, { now: NOW }),
      onThisDay(lib, { now: at(2027, 1, 14) }),
      roll.next(24),
      new YearEdit(lib, 2017, { now: NOW, months: await monthIndex(lib, 2017), seenWithin: never }).next(200),
      monthIndex(lib, 2012),
      yearIndex(lib, NOW),
    ]);
    expect(lib.calls.page.length).toBeGreaterThan(50);
    for (const r of lib.calls.page) {
      expect(Object.keys(r).sort()).toEqual(["first", "order", "range"]);
      expect(r.first).toBeGreaterThan(0);
      expect(r.first).toBeLessThanOrEqual(150);
      expect(r.range.to).toBeGreaterThan(r.range.from);
    }
    expect(lib.maxInFlight).toBeLessThanOrEqual(4);
    expect(lib.maxInFlight).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// The demo library
// ---------------------------------------------------------------------------

describe("the demo library", () => {
  const days = [NOW, at(2026, 0, 3), at(2028, 1, 29), at(2027, 2, 1), at(2026, 5, 15), at(2026, 11, 31)];

  it("opens on its six anniversaries, holds several years, and deals a whole roll, whatever the day", async () => {
    for (const today of days) {
      const lib = demoSourceAt(today);
      const day = await onThisDay(lib, { now: today });
      expect(day.reach).toBe("day");
      expect(day.prints).toHaveLength(6);
      expect(opensOnThisDay(day)).toBe(true);
      const years = await yearIndex(lib, today);
      expect(years.length).toBeGreaterThanOrEqual(9);
      const s = new Surprise(lib, { now: today, seed: 1, oldest: await lib.oldest(), years, seenWithin: never, held: never });
      expect(await s.next(24)).toHaveLength(24);
      expect(s.rollDone).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

describe("labels", () => {
  it("set the date like a catalogue", () => {
    const t = at(2018, 7, 14);
    expect(monthYear(t)).toBe("AUGUST 2018");
    expect(monthYearWords(t)).toBe("August 2018");
    expect(fullDate(t)).toBe("August 14, 2018");
    expect(monthDay(NOW)).toBe("October 22");
    expect(shortDay(NOW)).toBe("OCT 22");
    expect(monthName(7)).toBe("August");
    expect(MONTH_INITIALS).toEqual(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]);
    expect(weekday(at(2016, 7, 14))).toBe("Sunday");
  });

  it("count with commas and spell years in words up to ninety-nine", () => {
    expect(countLabel(0)).toBe("0");
    expect(countLabel(999)).toBe("999");
    expect(countLabel(1204)).toBe("1,204");
    expect(countLabel(1_234_567)).toBe("1,234,567");
    expect(yearsInWords(1)).toBe("One");
    expect(yearsInWords(20)).toBe("Twenty");
    expect(yearsInWords(21)).toBe("Twenty-one");
    expect(yearsInWords(31)).toBe("Thirty-one");
    expect(yearsInWords(99)).toBe("Ninety-nine");
    expect(yearsInWords(100)).toBe("100");
  });

  it("caption On This Day by the anniversary, the same number for every print of a week", () => {
    expect(captionFor(at(2019, 9, 22, 9), NOW, "on-this-day", "day", null)).toEqual({
      label: "OCTOBER 22, 2019",
      line: "Seven years ago today",
      long: false,
    });
    expect(captionFor(at(2019, 9, 20, 9), NOW, "on-this-day", "week", null).line).toBe("Seven years ago this week");
    expect(captionFor(at(2019, 9, 24, 9), NOW, "on-this-day", "week", null).line).toBe("Seven years ago this week");
    expect(captionFor(at(2019, 10, 2, 9), NOW, "on-this-day", "season", null).line).toBe("Seven years ago, around this time");
    expect(captionFor(at(2025, 9, 24, 9), NOW, "on-this-day", "week", null).line).toBe("One year ago this week");
    expect(captionFor(at(2025, 10, 2, 9), NOW, "on-this-day", "season", null).line).toBe("One year ago, around this time");
    // A print on the day itself says today, whatever the chapter's reach.
    expect(captionFor(at(2019, 9, 22, 9), NOW, "on-this-day", "season", null).line).toBe("Seven years ago today");
  });

  it("caption On This Day across the new year and on the 29th of February", () => {
    const jan2 = at(2027, 0, 2, 12);
    expect(captionFor(at(2019, 11, 30, 9), jan2, "on-this-day", "week", null).line).toBe("Seven years ago this week");
    expect(captionFor(at(2025, 11, 20, 9), jan2, "on-this-day", "season", null).line).toBe("One year ago, around this time");
    const leapDay = at(2028, 1, 29, 12);
    expect(captionFor(at(2027, 1, 28, 9), leapDay, "on-this-day", "day", null).line).toBe("One year ago today");
    expect(captionFor(at(2027, 1, 28, 9), leapDay, "on-this-day", "week", null).line).toBe("One year ago today");
    expect(captionFor(at(2024, 1, 29, 9), leapDay, "on-this-day", "day", null).line).toBe("Four years ago today");
  });

  it("caption Surprise and Set aside by the month, and the calendar decides under a year", () => {
    expect(captionFor(at(2014, 7, 14), NOW, "surprise", null, null)).toEqual({
      label: "AUGUST 2014",
      line: "Twelve years ago",
      long: false,
    });
    expect(captionFor(at(2025, 11, 20), NOW, "surprise", null, null).line).toBe("Last year");
    expect(captionFor(at(2025, 9, 23), NOW, "surprise", null, null).line).toBe("Last year");
    expect(captionFor(at(2025, 9, 1), NOW, "surprise", null, null).line).toBe("One year ago");
    expect(captionFor(at(2026, 2, 1), NOW, "set-aside", null, null).line).toBe("Earlier this year");
    expect(captionFor(at(2016, 7, 14), NOW, "set-aside", null, null)).toMatchObject({ label: "AUGUST 2016", line: "Ten years ago" });
    expect(captionFor(at(1990, 1, 1), NOW, "surprise", null, null).line).toBe("Thirty-six years ago");
    expect(captionFor(at(1962, 1, 1), NOW, "surprise", null, null).line).toBe("Sixty-four years ago");
    expect(captionFor(at(1920, 1, 1), NOW, "surprise", null, null).line).toBe("106 years ago");
  });

  it("caption a year by its full date and weekday", () => {
    expect(captionFor(at(2016, 7, 14), NOW, "year", null, null)).toEqual({
      label: "AUGUST 14, 2016",
      line: "A Sunday",
      long: false,
    });
  });

  it("say when a print was posted from this phone, which makes the line long", () => {
    expect(captionFor(at(2019, 9, 22, 9), NOW, "on-this-day", "day", at(2026, 4, 3))).toEqual({
      label: "OCTOBER 22, 2019",
      line: "Seven years ago today · posted in May 2026",
      long: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

describe("library access", () => {
  it("reads iOS's answer as one of the Darkroom's states", () => {
    expect(accessFrom({ status: "granted", granted: true, accessPrivileges: "all" })).toBe("full");
    expect(accessFrom({ status: "granted", granted: true, accessPrivileges: "limited" })).toBe("limited");
    expect(accessFrom({ status: "undetermined", granted: false })).toBe("undetermined");
    expect(accessFrom({ status: "denied", granted: false, accessPrivileges: "none" })).toBe("denied");
  });
});

// ---------------------------------------------------------------------------
// What the engine never touches
// ---------------------------------------------------------------------------

describe("the engine's privacy", () => {
  const files = ["types", "eligibility", "discovery", "labels", "nativeSource", "demoSource"].map((f) =>
    path.resolve(__dirname, "../src/darkroom", `${f}.ts`),
  );
  const forbidden = [
    /\.location\b/,
    /exif/i,
    /getMomentsAsync/,
    /\bfetch\(/,
    /supabase/i,
    /Image\.prefetch/,
    /console\./,
    /getAssetInfoAsync/,
    /pairedVideoAsset/,
    /getAlbums?Async/,
    /\bafter\s*:/,
  ];

  it("reads no location, metadata, moments or albums, sends nothing, and pages without cursors", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const rule of forbidden) expect({ file: path.basename(file), hit: rule.test(source) }).toEqual({ file: path.basename(file), hit: false });
    }
  });

  it("year ranges are local calendar years", () => {
    const r = yearRange(2016);
    expect(new Date(r.from).getFullYear()).toBe(2016);
    expect(new Date(r.to - 1).getFullYear()).toBe(2016);
    expect(new Date(r.to).getFullYear()).toBe(2017);
  });
});
