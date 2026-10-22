import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" }, Linking: { openSettings: async () => undefined } }));
vi.mock("expo-file-system", () => ({ File: class {}, Paths: { document: "" } }));
vi.mock("expo-media-library", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));

import { condense, editOccasion, isEligible, representative, spread, SCENE_GAP_MS } from "@/darkroom/eligibility";
import {
  anniversary,
  onThisDay,
  REDISCOVERY_AGE_DAYS,
  roundRobin,
  Surprise,
  windowAround,
  YearChapter,
  monthIndex,
  yearIndex,
} from "@/darkroom/discovery";
import { agoLine, captionFor, fullDate, monthYear, yearsBetween } from "@/darkroom/labels";
import { accessFrom } from "@/darkroom/access";
import { parseHistory, remember } from "@/darkroom/history";
import { parseSetAside } from "@/darkroom/setAside";
import { keepPlace, recallPlace, PLACE_KEPT_MS } from "@/darkroom/session";
import type { LibrarySource, Page, PageRequest, Print, TimeRange } from "@/darkroom/types";

// ---------------------------------------------------------------------------
// A fake library that keeps count of what it is asked
// ---------------------------------------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let n = 0;
function print(at: Date | number, over: Partial<Print> = {}): Print {
  n += 1;
  return {
    id: `p${n}`,
    uri: `ph://p${n}`,
    width: 4032,
    height: 3024,
    takenAt: typeof at === "number" ? at : at.getTime(),
    subtypes: [],
    ...over,
  };
}

class FakeLibrary implements LibrarySource {
  readonly prints: Print[];
  calls = { count: [] as TimeRange[], page: [] as PageRequest[], oldest: 0 };
  constructor(prints: Print[]) {
    this.prints = [...prints].sort((a, b) => a.takenAt - b.takenAt);
  }
  async count(range: TimeRange, subtype?: "screenshot") {
    this.calls.count.push(range);
    return this.prints.filter(
      (p) => p.takenAt >= range.from && p.takenAt < range.to && (!subtype || p.subtypes.includes(subtype)),
    ).length;
  }
  async page(req: PageRequest): Promise<Page> {
    this.calls.page.push(req);
    let list = this.prints.filter((p) => p.takenAt >= req.range.from && p.takenAt < req.range.to);
    if (req.order === "desc") list = list.reverse();
    const start = req.after ? list.findIndex((p) => p.id === req.after) + 1 : 0;
    const prints = list.slice(start, start + req.first);
    return { prints, endCursor: prints[prints.length - 1]?.id ?? null, hasNextPage: start + req.first < list.length };
  }
  async oldest() {
    this.calls.oldest += 1;
    return this.prints[0]?.takenAt ?? null;
  }
}

const year = (p: Print) => new Date(p.takenAt).getFullYear();

beforeEach(() => {
  n = 0;
});

// ---------------------------------------------------------------------------

describe("what is worth showing", () => {
  it("passes a camera frame and leaves out screenshots, thumbnails and screen-shaped images", () => {
    const at = new Date(2016, 4, 3);
    expect(isEligible(print(at))).toBe(true);
    expect(isEligible(print(at, { width: 3024, height: 4032 }))).toBe(true);
    expect(isEligible(print(at, { subtypes: ["screenshot"] }))).toBe(false);
    expect(isEligible(print(at, { width: 240, height: 180 }))).toBe(false);
    expect(isEligible(print(at, { width: 1170, height: 2532 }))).toBe(false);
    expect(isEligible(print(at, { width: 1920, height: 1080 }))).toBe(true);
  });

  it("leaves out a PNG or a GIF, which a camera never writes", () => {
    const at = new Date(2016, 4, 3);
    expect(isEligible(print(at, { filename: "IMG_0412.HEIC" }))).toBe(true);
    expect(isEligible(print(at, { filename: "IMG_0413.JPG" }))).toBe(true);
    expect(isEligible(print(at, { filename: "meme.PNG" }))).toBe(false);
    expect(isEligible(print(at, { filename: "reaction.gif" }))).toBe(false);
  });

  it("keeps a panorama, and refuses a photograph with no date or no size", () => {
    const at = new Date(2016, 4, 3);
    expect(isEligible(print(at, { width: 12000, height: 3000, subtypes: ["panorama"] }))).toBe(true);
    expect(isEligible(print(0))).toBe(false);
    expect(isEligible(print(at, { width: 0, height: 0 }))).toBe(false);
  });
});

describe("a run of frames is one moment", () => {
  it("folds a burst into its largest frame, and of equals the last", () => {
    const t = new Date(2015, 6, 4, 20, 0).getTime();
    const burst = [print(t), print(t + 5_000), print(t + 40_000, { width: 4000, height: 3000 })];
    expect(representative(burst).id).toBe(burst[1].id);
    const apart = print(t + SCENE_GAP_MS + 60_000);
    expect(condense([...burst, apart]).map((p) => p.id)).toEqual([burst[1].id, apart.id]);
  });

  it("spreads picks evenly, first and last included, and edits a long occasion to a few moments", () => {
    expect(spread([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([1, 5, 9]);
    expect(spread([1, 2, 3], 1)).toEqual([2]);
    expect(spread([1, 2], 5)).toEqual([1, 2]);
    const scenes = Array.from({ length: 40 }, (_, i) => print(new Date(2014, 1, 1, 10, i * 3)));
    const edit = editOccasion(scenes);
    expect(edit).toHaveLength(4);
    expect(edit[0].id).toBe(scenes[0].id);
    expect(edit[3].id).toBe(scenes[39].id);
    expect(editOccasion(scenes.slice(0, 1))).toHaveLength(1);
  });
});

describe("the contents page", () => {
  it("counts each year without its screenshots, oldest first, and leaves out empty years", async () => {
    const lib = new FakeLibrary([
      print(new Date(2011, 3, 1)),
      print(new Date(2011, 7, 1)),
      print(new Date(2013, 1, 1)),
      print(new Date(2013, 1, 2), { subtypes: ["screenshot"] }),
      print(new Date(2014, 5, 1), { subtypes: ["screenshot"] }),
    ]);
    const years = await yearIndex(lib, new Date(2026, 9, 22).getTime());
    expect(years).toEqual([
      { year: 2011, count: 2 },
      { year: 2013, count: 1 },
    ]);
  });

  it("opens only the decades that hold photographs", async () => {
    const lib = new FakeLibrary([print(new Date(1962, 5, 1)), print(new Date(2019, 5, 1))]);
    const years = await yearIndex(lib, new Date(2026, 9, 22).getTime());
    expect(years.map((y) => y.year)).toEqual([1962, 2019]);
    // Seven decades counted once each, then the eighteen years of the two filled
    // decades (1962–69, 2010–19) twice each — all, and screenshots — not 65 years.
    expect(lib.calls.count.length).toBe(7 + 18 * 2);
  });

  it("is empty for an empty library", async () => {
    expect(await yearIndex(new FakeLibrary([]))).toEqual([]);
  });
});

describe("on this day", () => {
  const now = new Date(2026, 9, 22, 12).getTime();

  it("sweeps the years oldest first, one from each year before a second from any", async () => {
    const lib = new FakeLibrary([
      print(new Date(2012, 9, 22, 9)),
      print(new Date(2012, 9, 22, 18)),
      print(new Date(2019, 9, 22, 11)),
      print(new Date(2023, 9, 22, 8)),
      print(new Date(2023, 9, 22, 21)),
      print(new Date(2026, 9, 22, 8)), // today itself is not a memory
      print(new Date(2019, 9, 23, 8)), // the next day is not the day
    ]);
    const years = await yearIndex(lib, now);
    const day = await onThisDay(lib, years, { now, minimum: 4 });
    expect(day.reach).toBe("day");
    expect(day.prints.map((p) => year(p))).toEqual([2012, 2019, 2023, 2012, 2023]);
  });

  it("reaches out to the week, then the time of year, when the day itself is thin", async () => {
    const lib = new FakeLibrary([
      print(new Date(2014, 9, 22, 9)),
      print(new Date(2017, 9, 20, 9)),
      print(new Date(2018, 9, 25, 9)),
      print(new Date(2020, 9, 24, 9)),
    ]);
    const years = await yearIndex(lib, now);
    const week = await onThisDay(lib, years, { now, minimum: 4 });
    expect(week.reach).toBe("week");
    expect(week.prints).toHaveLength(4);

    const sparse = new FakeLibrary([print(new Date(2014, 9, 22, 9)), print(new Date(2015, 10, 1, 9))]);
    const season = await onThisDay(sparse, await yearIndex(sparse, now), { now, minimum: 2 });
    expect(season.reach).toBe("season");
    expect(season.prints).toHaveLength(2);
  });

  it("finds nothing, honestly, when there is nothing near the date", async () => {
    const lib = new FakeLibrary([print(new Date(2015, 2, 1))]);
    const day = await onThisDay(lib, await yearIndex(lib, now), { now });
    expect(day.prints).toEqual([]);
  });

  it("gives the 29th of February to the 28th in a common year", () => {
    expect(anniversary(2023, 1, 29).getDate()).toBe(28);
    expect(anniversary(2024, 1, 29).getDate()).toBe(29);
    const w = windowAround(2023, 1, 29, 0);
    expect(new Date(w.from).getDate()).toBe(28);
    expect(w.to - w.from).toBe(DAY);
  });

  it("caps how many come from any one year", async () => {
    const heavy = Array.from({ length: 50 }, (_, i) => print(new Date(2016, 9, 22, 8, i * 10)));
    const lib = new FakeLibrary(heavy);
    const day = await onThisDay(lib, await yearIndex(lib, now), { now, perYear: 8 });
    expect(day.prints).toHaveLength(8);
  });

  it("interleaves lists fairly", () => {
    expect(roundRobin([[1, 2, 3], [4], [5, 6]])).toEqual([1, 4, 5, 2, 6, 3]);
  });
});

describe("surprise", () => {
  const now = new Date(2026, 9, 22, 12).getTime();
  // Fifteen years, a few occasions a year, each a short run of frames.
  const library = () => {
    const prints: Print[] = [];
    for (let y = 2010; y <= 2026; y++) {
      for (let m = 0; m < 12; m += 2) {
        const t = new Date(y, m, 10, 15).getTime();
        prints.push(print(t), print(t + 20_000), print(t + 3 * DAY));
      }
    }
    return new FakeLibrary(prints);
  };

  it("never offers anything from the last few months, and never the same year twice running", async () => {
    const lib = library();
    const s = new Surprise(lib, await yearIndex(lib, now), { now, seed: 7 });
    const picks = await s.next(30);
    expect(picks.length).toBe(30);
    for (const p of picks) expect(now - p.takenAt).toBeGreaterThanOrEqual(REDISCOVERY_AGE_DAYS * DAY);
    for (let i = 1; i < picks.length; i++) expect(year(picks[i])).not.toBe(year(picks[i - 1]));
    expect(new Set(picks.map((p) => p.id)).size).toBe(picks.length);
  });

  it("does not show two moments from the same occasion close together", async () => {
    const lib = library();
    const s = new Surprise(lib, await yearIndex(lib, now), { now, seed: 11 });
    const picks = await s.next(20);
    for (let i = 0; i < picks.length; i++) {
      for (let j = Math.max(0, i - 8); j < i; j++) {
        expect(Math.abs(picks[i].takenAt - picks[j].takenAt)).toBeGreaterThanOrEqual(6 * HOUR);
      }
    }
  });

  it("asks the library only small questions", async () => {
    const lib = library();
    const s = new Surprise(lib, await yearIndex(lib, now), { now, seed: 3 });
    await s.next(12);
    expect(lib.calls.page.every((r) => r.first <= 40)).toBe(true);
    expect(lib.calls.page.length).toBeLessThanOrEqual(12 * 6 * 2);
  });

  it("passes over what was seen lately, until nothing else is left", async () => {
    const lib = new FakeLibrary([print(new Date(2015, 4, 1)), print(new Date(2018, 4, 1))]);
    const years = await yearIndex(lib, now);
    const seenAll = new Surprise(lib, years, { now, seed: 1, skip: () => true });
    expect((await seenAll.next(2)).length).toBe(2); // relaxed rather than empty
    const seenOne = new Surprise(lib, years, { now, seed: 1, skip: (id) => id === "p1" });
    expect((await seenOne.next(1))[0].id).toBe("p2");
  });

  it("is the same deal for the same seed, and a different one for another", async () => {
    const a = library();
    const ya = await yearIndex(a, now);
    const first = (await new Surprise(a, ya, { now, seed: 42 }).next(8)).map((p) => p.id);
    const again = (await new Surprise(a, ya, { now, seed: 42 }).next(8)).map((p) => p.id);
    const other = (await new Surprise(a, ya, { now, seed: 43 }).next(8)).map((p) => p.id);
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it("says when there is nothing old enough", async () => {
    const lib = new FakeLibrary([print(now - 10 * DAY)]);
    const s = new Surprise(lib, await yearIndex(lib, now), { now, seed: 1 });
    expect(await s.next(5)).toEqual([]);
    expect(s.exhausted).toBe(true);
  });
});

describe("a year as a chapter", () => {
  it("reads in order, one moment per burst, a few moments per occasion, a page only when needed", async () => {
    const prints: Print[] = [];
    // A morning burst, an afternoon of forty frames, an evening of two.
    const morning = new Date(2016, 2, 5, 9).getTime();
    prints.push(print(morning), print(morning + 2_000), print(morning + 4_000));
    for (let i = 0; i < 40; i++) prints.push(print(new Date(2016, 2, 5, 14, i * 2).getTime()));
    prints.push(print(new Date(2016, 2, 5, 22, 0)), print(new Date(2016, 2, 5, 22, 30)));
    // A different month.
    prints.push(print(new Date(2016, 7, 1, 12)));
    const lib = new FakeLibrary(prints);
    const chapter = new YearChapter(lib, 2016, 20);
    const first = await chapter.next(1);
    expect(lib.calls.page.length).toBe(1);
    const rest = await chapter.next(50);
    const all = [...first, ...rest];
    for (let i = 1; i < all.length; i++) expect(all[i].takenAt).toBeGreaterThan(all[i - 1].takenAt);
    // morning: 1, afternoon: 4 (edited), evening 22:00 + 22:30 within 3h of each other: one occasion of 2 → 2, August: 1
    expect(all).toHaveLength(1 + 4 + 2 + 1);
    expect(chapter.done).toBe(true);
  });

  it("does not split a burst that straddles a page boundary", async () => {
    const t = new Date(2019, 0, 1, 12).getTime();
    const lib = new FakeLibrary([print(t), print(t + 1000), print(t + 2000), print(t + 3000)]);
    const chapter = new YearChapter(lib, 2019, 2);
    expect(await chapter.next(10)).toHaveLength(1);
  });
});

describe("a year by month", () => {
  it("counts each month without screenshots, and can open the chapter at a month", async () => {
    const lib = new FakeLibrary([
      print(new Date(2016, 0, 3)),
      print(new Date(2016, 5, 3, 9)),
      print(new Date(2016, 5, 3, 18)),
      print(new Date(2016, 5, 4), { subtypes: ["screenshot"] }),
      print(new Date(2016, 10, 1)),
    ]);
    expect(await monthIndex(lib, 2016)).toEqual([1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0]);
    const fromJune = await new YearChapter(lib, 2016, 50, 5).next(10);
    expect(fromJune.map((p) => new Date(p.takenAt).getMonth())).toEqual([5, 5, 10]);
  });
});

describe("labels", () => {
  const now = new Date(2026, 9, 22).getTime();
  it("set the date like a catalogue", () => {
    expect(monthYear(new Date(2018, 7, 14).getTime())).toBe("AUGUST 2018");
    expect(fullDate(new Date(2018, 7, 14).getTime())).toBe("August 14, 2018");
  });
  it("caption each way in as an archive would", () => {
    const day = new Date(2019, 9, 22, 9).getTime();
    expect(captionFor(day, now, "on-this-day", "day", false)).toEqual({ label: "OCTOBER 22, 2019", line: "Seven years ago today" });
    const near = new Date(2019, 9, 20, 9).getTime();
    expect(captionFor(near, now, "on-this-day", "week", false).line).toBe("Seven years ago, this week");
    expect(captionFor(near, now, "surprise", null, true)).toEqual({ label: "OCTOBER 2019", line: "Seven years ago · posted" });
    expect(captionFor(new Date(2016, 7, 14).getTime(), now, "year", null, false)).toEqual({ label: "AUGUST 14, 2016", line: "Sunday" });
  });

  it("count a year only once its anniversary has passed, and say it in words", () => {
    expect(yearsBetween(new Date(2019, 9, 23).getTime(), now)).toBe(6);
    expect(yearsBetween(new Date(2019, 9, 22).getTime(), now)).toBe(7);
    expect(agoLine(new Date(2019, 9, 22).getTime(), now, true)).toBe("Seven years ago today");
    expect(agoLine(new Date(2025, 9, 1).getTime(), now)).toBe("One year ago");
    expect(agoLine(new Date(2026, 1, 1).getTime(), now)).toBe("Earlier this year");
    expect(agoLine(new Date(1990, 1, 1).getTime(), now)).toBe("36 years ago");
  });
});

describe("library access", () => {
  it("reads iOS's answer as one of five states", () => {
    expect(accessFrom({ status: "granted", granted: true, accessPrivileges: "all" })).toBe("full");
    expect(accessFrom({ status: "granted", granted: true, accessPrivileges: "limited" })).toBe("limited");
    expect(accessFrom({ status: "undetermined", granted: false })).toBe("undetermined");
    expect(accessFrom({ status: "denied", granted: false, accessPrivileges: "none" })).toBe("denied");
  });
});

describe("what the Darkroom remembers", () => {
  it("keeps the most recent, letting the oldest go", () => {
    const m = new Map<string, number>();
    remember(m, "a", 1, 2);
    remember(m, "b", 2, 2);
    remember(m, "a", 3, 2);
    remember(m, "c", 4, 2);
    expect([...m.keys()]).toEqual(["a", "c"]);
  });

  it("refuses a stored file that does not fit, entry by entry", () => {
    expect(parseHistory(null)).toBeNull();
    expect(parseHistory({ seen: [["a", 1], ["", 2], ["b", "x"], 3], developed: "no" })).toEqual({
      seen: [["a", 1]],
      developed: [],
    });
    expect(parseSetAside({})).toBeNull();
    expect(
      parseSetAside([
        { id: "a", uri: "ph://a", width: 10, height: 10, takenAt: 5, setAsideAt: 6 },
        { id: "b", uri: "ph://b" },
      ]),
    ).toEqual([{ id: "a", uri: "ph://a", width: 10, height: 10, takenAt: 5, setAsideAt: 6, subtypes: [] }]);
  });

  it("holds the place for two hours, in memory", () => {
    keepPlace({ mode: "year", year: 2016, prints: [], index: 3, reader: null }, 1_000);
    expect(recallPlace(1_000 + PLACE_KEPT_MS - 1)?.index).toBe(3);
    expect(recallPlace(1_000 + PLACE_KEPT_MS + 1)).toBeNull();
  });
});
