import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default } }));
// What a visit reads besides the library: the phone's own stores, faked in memory.
vi.mock("@/darkroom/develop", () => ({ stillInLibrary: async () => null }));
vi.mock("@/darkroom/history", () => ({ developedRecently: () => false, localDay: () => "2026-10-22", seenWithin: () => false }));
vi.mock("@/darkroom/session", () => ({ keepChapter: () => undefined, recallChapter: () => null }));
vi.mock("@/darkroom/setAside", () => ({ isSetAside: () => false, setAsidePrints: () => [] }));

import { DISSOLVE, photographRequest, PLATE_STALL_MS, progressOf, SILENT_TRIES, stallCheck } from "@/components/darkroom/plateImage";
import { Visit } from "@/components/darkroom/visit";
import { gated, inBackground, onThisDay, Surprise, yearIndex } from "@/darkroom/discovery";
import { MAX_IN_FLIGHT } from "@/darkroom/eligibility";
import type { LibrarySource, Page, PageRequest, Print, TimeRange } from "@/darkroom/types";
import { mulberry32 } from "@/utils/shuffle";

/**
 * The Memory Room, kept quick on a phone with a large library.
 *
 * Every library question goes to expo-media-library, and Expo answers
 * every module's async calls one at a time on one shared queue. So the
 * library here is modelled the same way: one question at a time, each
 * holding the queue for a few simulated milliseconds. The room must keep
 * the prints a member is about to see ahead of everything it reads for
 * itself, keep no more than two questions outstanding, and never read the
 * same thing twice at once.
 */

const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");

const COST = { count: 20, page: 30, perPrint: 0.4, oldest: 200 };
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();
const NOW = at(2026, 9, 22);

/** A library that answers one question at a time, like Expo's shared queue, and writes down when each was answered. */
class SerialLibrary implements LibrarySource {
  readonly prints: Print[];
  private readonly times: number[];
  private queue: Promise<unknown> = Promise.resolve();
  inFlight = 0;
  maxInFlight = 0;
  answered: string[] = [];
  counts = 0;
  pages = 0;

  constructor(prints: readonly Print[]) {
    this.prints = [...prints].sort((a, b) => a.takenAt - b.takenAt);
    this.times = this.prints.map((p) => p.takenAt);
  }

  private index(t: number) {
    let lo = 0;
    let hi = this.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private within(r: TimeRange) {
    const a = this.index(r.from);
    return this.prints.slice(a, Math.max(a, this.index(r.to)));
  }

  private serve<T>(label: string, cost: (v: T) => number, value: () => T): Promise<T> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const run = this.queue.then(async () => {
      const v = value();
      await new Promise((r) => setTimeout(r, cost(v)));
      this.answered.push(label);
      return v;
    });
    this.queue = run.catch(() => undefined);
    return run.finally(() => {
      this.inFlight -= 1;
    });
  }

  count(range: TimeRange, subtype?: "screenshot") {
    this.counts += 1;
    return this.serve(`count`, () => COST.count, () => this.within(range).filter((p) => !subtype || p.subtypes.includes(subtype)).length);
  }

  page(req: PageRequest): Promise<Page> {
    this.pages += 1;
    return this.serve(
      `page:${req.first}`,
      (p: Page) => COST.page + COST.perPrint * p.prints.length,
      () => {
        let list = this.within(req.range);
        if (req.order === "desc") list = list.reverse();
        return { prints: list.slice(0, req.first), hasNextPage: list.length > req.first };
      },
    );
  }

  oldest() {
    return this.serve("oldest", () => COST.oldest, () => this.prints[0]?.takenAt ?? null);
  }
}

/** About 48,000 photographs from 2010 to 2025, a tenth of them screenshots, and almost nothing on the 22nd of October: a thin day. */
function bigLibrary(): Print[] {
  const rand = mulberry32(42);
  const out: Print[] = [];
  let n = 0;
  for (let y = 2010; y <= 2025; y++) {
    for (let i = 0; i < 3000; i++) {
      const d = new Date(y, 0, 1 + Math.floor(rand() * 365), 8 + Math.floor(rand() * 14), Math.floor(rand() * 60));
      if (d.getMonth() === 9 && d.getDate() === 22 && !(y === 2015 && i % 7 === 0)) continue;
      n += 1;
      const shot = rand() < 0.1;
      out.push({
        id: `a${n}`,
        uri: `ph://a${n}`,
        width: shot ? 1179 : 4032,
        height: shot ? 2556 : 3024,
        takenAt: d.getTime(),
        subtypes: shot ? ["screenshot"] : [],
      });
    }
  }
  return out;
}

/** Runs simulated time forward until `p` settles. */
async function settle<T>(p: Promise<T>, limitMs = 60_000): Promise<T> {
  let done = false;
  let value: T | undefined;
  let error: unknown;
  p.then(
    (v) => {
      done = true;
      value = v;
    },
    (e) => {
      done = true;
      error = e;
    },
  );
  for (let t = 0; t < limitMs && !done; t += 5) await vi.advanceTimersByTimeAsync(5);
  if (!done) throw new Error("never settled");
  if (error) throw error;
  return value as T;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the gate's two lines", () => {
  it("answers a question in the front line before the back line's queue, never more than two at once", async () => {
    vi.useFakeTimers({ now: NOW });
    const lib = new SerialLibrary(bigLibrary());
    const back = inBackground(lib);
    const front = gated(lib);
    // The room's own reading: forty counts queued in the back line.
    const queued = Array.from({ length: 40 }, (_, i) => back.count({ from: at(2010 + (i % 16), 0, 1), to: at(2011 + (i % 16), 0, 1) }));
    await vi.advanceTimersByTimeAsync(1);
    // Then the member's next print: a page in the front line.
    const asked = Date.now();
    const pageAnswered = front.page({ range: { from: at(2014, 0, 1), to: at(2014, 1, 1) }, first: 40, order: "asc" }).then(() => Date.now() - asked);
    const waited = await settle(pageAnswered);
    // Behind at most the questions already outstanding, never the whole queue.
    expect(lib.answered.indexOf("page:40")).toBeLessThanOrEqual(MAX_IN_FLIGHT);
    expect(waited).toBeLessThan(COST.count * (MAX_IN_FLIGHT + 1) + COST.page + 40 * COST.perPrint + 10);
    await settle(Promise.all(queued));
    expect(lib.maxInFlight).toBeLessThanOrEqual(2);
    expect(MAX_IN_FLIGHT).toBe(2);
  });

  it("keeps a discovery function handed the back line in the back line, all the way through", async () => {
    vi.useFakeTimers({ now: NOW });
    const lib = new SerialLibrary(bigLibrary());
    const back = inBackground(lib);
    expect(gated(back)).not.toBe(back);
    expect(inBackground(back)).toBe(back);
    expect(inBackground(gated(lib))).toBe(back);
    // The whole of a thin day, read in the back line, while a roll deals in the front.
    const day = onThisDay(back, { now: NOW, oldest: at(2010, 0, 1) });
    const years = yearIndex(back, NOW, at(2010, 0, 1));
    await vi.advanceTimersByTimeAsync(1);
    const roll = new Surprise(lib, { now: NOW, seed: 3, oldest: at(2010, 0, 1), seenWithin: () => false, held: () => false });
    const asked = Date.now();
    const dealt = await settle(roll.next(3).then((p) => ({ n: p.length, ms: Date.now() - asked })));
    const all = await settle(Promise.all([day, years]).then(() => Date.now() - asked));
    expect(dealt.n).toBe(3);
    // The roll's three prints come in a fraction of the time the background reading takes.
    expect(dealt.ms * 4).toBeLessThan(all);
  });
});

describe("a visit's reading", () => {
  it("deals the roll's next prints while the year index and the whole day are read, without waiting for them", async () => {
    vi.useFakeTimers({ now: NOW });
    const lib = new SerialLibrary(bigLibrary());
    const visit = new Visit(lib);
    visit.libraryChanged(true);
    const opened = (async () => {
      const first = await visit.oldest();
      const day = await visit.askDayOnly(Date.now());
      const s = visit.surprise(first);
      const prints = await s.next(3);
      return { day, s, prints };
    })();
    const { day, s, prints } = await settle(opened);
    expect(prints).toHaveLength(3);
    // A thin day: the whole of it is read again after the first print, as the room does.
    expect(day?.prints.length ?? 0).toBeLessThan(3);
    const started = Date.now();
    const years = visit.years(false, true).then(() => Date.now() - started);
    const whole = visit.askDay(true).then(() => Date.now() - started);
    const next = s.next(3).then((p) => ({ n: p.length, ms: Date.now() - started }));
    const dealt = await settle(next);
    expect(dealt.n).toBe(3);
    const background = Math.max(await settle(years), await settle(whole));
    // Measured in this model before the back line: 3,090 ms, as long as the whole day took. Now about 300.
    expect(dealt.ms).toBeLessThan(600);
    expect(background).toBeGreaterThan(2000);
  }, 30_000);

  it("reads the year index and the day once, however many ask while they are being read", async () => {
    vi.useFakeTimers({ now: NOW });
    const lib = new SerialLibrary(bigLibrary());
    const visit = new Visit(lib);
    visit.libraryChanged(true);
    await settle(visit.oldest());
    const counts0 = lib.counts;
    const a = visit.years(false, true);
    const b = visit.years();
    const both = await settle(Promise.all([a, b]));
    expect(both[0]).toBe(both[1]);
    const oneCount = lib.counts - counts0;
    expect(oneCount).toBeGreaterThan(10);
    // A recount that was asked for reads again.
    await settle(visit.years(true));
    expect(lib.counts - counts0).toBe(oneCount * 2);

    const pages0 = lib.pages;
    const d1 = visit.askDay(true);
    const d2 = visit.askDay();
    const days = await settle(Promise.all([d1, d2]));
    expect(days[0]).toBe(days[1]);
    const onePass = lib.pages - pages0;
    expect(onePass).toBeGreaterThan(10);
  }, 30_000);
});

describe("the room asks for what it reads of its own accord in the back line", () => {
  const room = read("src/darkroom/useDarkroom.ts");
  const after = room.slice(room.indexOf("const afterFirstPrint = useCallback"), room.indexOf("const show = useCallback"));

  it("after the first print: the year index, the whole day and the open year's months", () => {
    expect(after).toMatch(/loadYears\(false, true\)/);
    expect(after).toMatch(/askDay\(true\)/);
    expect(after).toMatch(/loadMonths\(c\.year, true\)/);
  });

  it("when the library changes, and behind TRY AGAIN's way in", () => {
    expect(room).toMatch(/before\.years != null\) void loadYears\(true, true\)/);
    expect(room.slice(room.indexOf("const retry = useCallback"))).toMatch(/^[\s\S]*?void loadYears\(true, true\)/);
  });

  it("and everything a chapter waits on in the front line", () => {
    const open = room.slice(room.indexOf("const open = useCallback"), room.indexOf("const openDefault = useCallback"));
    expect(open).toMatch(/await askDay\(\)/);
    expect(open).toMatch(/await loadYears\(\)/);
    expect(read("src/components/darkroom/visit.ts")).toMatch(/background \? inBackground\(this\.source\) : this\.source/);
  });
});

// ---------------------------------------------------------------------------
// A plate's photograph
// ---------------------------------------------------------------------------

/**
 * expo-image on iOS loads a view again whenever any prop it was given
 * changes (`OnViewDidUpdateProps` → `reload()`), cancelling what it was
 * still loading. Counted here for one plate's life: made as the page beside
 * the one in front, turned to, its photograph drawn, then turned past.
 */
function reloadsOverAPageTurn(props: (state: { current: boolean; drawnBefore: boolean }) => Record<string, unknown>): number {
  const states = [
    { current: false, drawnBefore: false },
    { current: true, drawnBefore: false },
    { current: true, drawnBefore: true },
    { current: false, drawnBefore: true },
  ];
  let reloads = 0;
  let last = JSON.stringify(props(states[0]));
  for (const s of states.slice(1)) {
    const next = JSON.stringify(props(s));
    if (next !== last) reloads += 1;
    last = next;
  }
  return reloads;
}

describe("a plate's photograph", () => {
  const page = read("src/components/darkroom/PrintPage.tsx");
  const full = page.slice(page.indexOf("function Full("), page.indexOf("const styles = StyleSheet.create"));
  const photograph = page.slice(page.indexOf("function Photograph("), page.indexOf("function Full("));

  it("asks for nothing that changes as the page is turned, so turning reloads and cancels nothing", () => {
    // What the plate asked for before: its priority by whether it was in front, its dissolve until it had drawn.
    const before = reloadsOverAPageTurn(({ current, drawnBefore }) => ({
      cachePolicy: "memory",
      priority: current ? "high" : "low",
      transition: !drawnBefore ? DISSOLVE : 0,
    }));
    expect(before).toBe(3);
    // Now: decided once, as the view is made, from whether the print had been drawn then.
    const after = reloadsOverAPageTurn(() => ({ ...photographRequest(true, false) }));
    expect(after).toBe(0);
    // The request has nothing in it about the page being in front.
    expect(photographRequest.length).toBe(2);
    expect(full).toMatch(/const \[request\] = useState\(\(\) => photographRequest\(dissolve, look\.reduceMotion\)\)/);
    for (const prop of ["cachePolicy", "priority", "allowDownscaling", "transition"]) {
      expect(full).toMatch(new RegExp(`${prop}=\\{request\\.${prop}\\}`));
    }
    expect(page).not.toMatch(/priority=\{current/);
    expect(page).not.toMatch(/transition=\{dissolve/);
  });

  it("is kept in memory only, dissolves only when it was not drawn this visit, and never under Reduce Motion", () => {
    expect(photographRequest(true, false)).toEqual({ cachePolicy: "memory", priority: "normal", allowDownscaling: false, transition: DISSOLVE });
    expect(photographRequest(false, false).transition).toBe(0);
    expect(photographRequest(true, true).transition).toBe(0);
  });

  it("leaves a slightly larger rendition to the GPU rather than redrawing it on the main thread", () => {
    for (const d of [true, false]) for (const r of [true, false]) expect(photographRequest(d, r).allowDownscaling).toBe(false);
  });

  it("reads iCloud's progress as Photos sends it for a ph:// address, and bytes elsewhere", () => {
    expect(progressOf({ loaded: null, total: null, progress: 0.42 })).toBe(0.42);
    expect(progressOf({ loaded: 50, total: 200 })).toBe(0.25);
    expect(progressOf({ progress: 1.3 })).toBe(1);
    expect(progressOf({ progress: -1 })).toBe(0);
    expect(progressOf({ loaded: 5, total: 0 })).toBeNull();
    expect(progressOf({})).toBeNull();
    expect(progressOf(null)).toBeNull();
  });

  it("draws the photograph's download on the signature line of the plate in front, unless DOWNLOAD AND DEVELOP is drawing its own", () => {
    expect(page).toMatch(/progress=\{props\.progress \?\? \(current \? cloud\.shown : null\)\}/);
    expect(full).toMatch(/onProgress=\{\(e\) => \{\s*const fraction = progressOf\(e\);/);
    // Drawn or failed, the line is the signature line again.
    expect(photograph).toMatch(/onLoad=\{\(\) => \{\s*silent\.current = 0;\s*onCloud\(null\);/);
    expect(photograph).toMatch(/onError=\{\(e: ImageErrorEventData\) => \{\s*onCloud\(null\);/);
  });
});

/**
 * One plate in front of the member whose photograph Photos never answers,
 * run the way the plate's effect runs `stallCheck`: it waits, asks once
 * more, then says why. `progressEvery` is iCloud's progress, which keeps it
 * waiting for as long as the download moves.
 */
function stalledPlate(online: boolean, progressEvery: number | null, until: number) {
  let t = 0;
  let heard = 0;
  let silent = 0;
  let attempts = 1;
  let trouble: string | null = null;
  let next = PLATE_STALL_MS;
  while (t < until && trouble == null) {
    const progressAt = progressEvery == null ? Infinity : (Math.floor(t / progressEvery) + 1) * progressEvery;
    if (progressAt < next) {
      t = progressAt;
      heard = t;
      continue;
    }
    t = next;
    const step = stallCheck(heard, t, silent, online);
    if ("wait" in step) next = t + step.wait;
    else if ("again" in step) {
      silent += 1;
      attempts += 1;
      heard = t;
      next = t + PLATE_STALL_MS;
    } else trouble = step.trouble;
  }
  return { attempts, trouble, at: Math.min(t, until) };
}

describe("a plate that hears nothing of its photograph", () => {
  it("asks once more, then says why, instead of leaving its soft proof in place", () => {
    expect(SILENT_TRIES).toBe(1);
    expect(stalledPlate(true, null, 120_000)).toEqual({ attempts: 2, trouble: "other", at: 2 * PLATE_STALL_MS });
    expect(stalledPlate(false, null, 120_000)).toEqual({ attempts: 2, trouble: "offline", at: 2 * PLATE_STALL_MS });
  });

  it("waits for as long as iCloud's download is moving", () => {
    expect(stalledPlate(true, 5_000, 120_000)).toEqual({ attempts: 1, trouble: null, at: 120_000 });
  });

  it("waits the whole stall from the last thing it heard", () => {
    expect(stallCheck(0, 5_000, 0, true)).toEqual({ wait: PLATE_STALL_MS - 5_000 });
    expect(stallCheck(0, PLATE_STALL_MS, 0, true)).toEqual({ again: true });
    expect(stallCheck(0, PLATE_STALL_MS, 1, true)).toEqual({ trouble: "other" });
    expect(stallCheck(0, PLATE_STALL_MS, 1, false)).toEqual({ trouble: "offline" });
  });

  it("is watched only in front of the member, while it is still waiting for its picture", () => {
    const page = read("src/components/darkroom/PrintPage.tsx");
    expect(page).toMatch(/const waiting = current && images && !drawn && trouble == null && !gone && source != null;/);
    expect(page).toMatch(/const next = stallCheck\(heard\.current, Date\.now\(\), silent\.current, online\);/);
    // iCloud's progress counts as hearing something.
    expect(page).toMatch(/onProgress=\{\(fraction\) => \{\s*heard\.current = Date\.now\(\);/);
  });
});
