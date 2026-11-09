import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default } }));
// What a visit reads besides the library: the phone's own stores, faked in memory.
vi.mock("@/darkroom/develop", () => ({ stillInLibrary: async () => null }));
vi.mock("@/darkroom/history", () => ({ developedRecently: () => false, localDay: () => "2026-10-22", seenWithin: () => false }));
vi.mock("@/darkroom/session", () => ({ keepChapter: () => undefined, recallChapter: () => null }));
vi.mock("@/darkroom/setAside", () => ({ isSetAside: () => false, setAsidePrints: () => [] }));

import { Drawn, RELEASE_AFTER } from "@/components/darkroom/drawn";
import {
  closerBox,
  closerRequest,
  DISSOLVE,
  photographRequest,
  PLATE_PATIENCE_MS,
  PLATE_ZOOM,
  proofHoldMs,
  PLATE_STALL_MS,
  PlateStall,
  progressOf,
  PROOF_AHEAD,
  PROOF_BEHIND,
  quietAllowed,
  SILENT_TRIES,
  stallCheck,
  wantsProof,
} from "@/components/darkroom/plateImage";
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

  it("reads the library afresh once it changes, even while a count or the day is still being read", async () => {
    vi.useFakeTimers({ now: NOW });
    const lib = new SerialLibrary(bigLibrary());
    const visit = new Visit(lib);
    visit.libraryChanged(true);
    await settle(visit.oldest());

    // Photos says the library changed part way through the year count.
    const counting = visit.years(false, true);
    await vi.advanceTimersByTimeAsync(100);
    visit.libraryChanged(false);
    const recounted = visit.years();
    const [before, after] = await settle(Promise.all([counting, recounted]));
    // The first count answers its own callers; the next ask is a new count of the library as it is now.
    expect(after).not.toBe(before);
    expect(after).toEqual(before);

    // And part way through the whole day.
    const reading = visit.askDay(true);
    await vi.advanceTimersByTimeAsync(100);
    visit.libraryChanged(true);
    const reread = visit.askDay();
    const [day1, day2] = await settle(Promise.all([reading, reread]));
    expect(day2).not.toBe(day1);
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

  it("slides in soft, not empty: a proof on the settled page, the one before and the two after", () => {
    expect([PROOF_BEHIND, PROOF_AHEAD]).toEqual([1, 2]);
    const settled = 10;
    const proofed = [7, 8, 9, 10, 11, 12, 13, 14].filter((i) => wantsProof(i, settled));
    expect(proofed).toEqual([9, 10, 11, 12]);
    expect(wantsProof(0, 0)).toBe(true);
    expect(wantsProof(-1, 0)).toBe(true);
    expect(read("app/darkroom.tsx")).toMatch(/proof=\{chapter != null && wantsProof\(index, chapter\.index\)\}/);
    // The full photograph is still asked for only by the pages the stage mounts: the one in view and one either side.
    expect(read("src/components/darkroom/Stage.tsx")).toMatch(/initialNumToRender=\{1\}\s*maxToRenderPerBatch=\{1\}\s*windowSize=\{3\}/);
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
    expect(photograph).toMatch(/onLoad=\{\(\) => \{\s*stall\.drew\(\);\s*onCloud\(null\);/);
    expect(photograph).toMatch(/onError=\{\(e: ImageErrorEventData\) => \{\s*stall\.failed\(\);\s*onCloud\(null\);/);
  });
});

describe("a plate's proof, as its photograph comes in", () => {
  const page = read("src/components/darkroom/PrintPage.tsx");
  const full = page.slice(page.indexOf("function Full("), page.indexOf("function Closer("));
  const photograph = page.slice(page.indexOf("function Photograph("), page.indexOf("function Full("));

  it("stays under the photograph for the whole of its dissolve, and goes at once when there is none", () => {
    // expo-image fades the photograph in from an empty view over 240 ms: the proof is what it fades in over.
    expect(proofHoldMs(photographRequest(true, false))).toBe(DISSOLVE.duration);
    expect(DISSOLVE.duration).toBe(240);
    // Drawn before this visit, or under Reduce Motion: no dissolve, no wait.
    expect(proofHoldMs(photographRequest(false, false))).toBe(0);
    expect(proofHoldMs(photographRequest(true, true))).toBe(0);
  });

  it("is let go by the photograph's own view once that time has passed, not as it loads", () => {
    // The proof is drawn until the photograph has developed, not merely drawn.
    expect(photograph).toMatch(/\{images && source != null && proof && !developed \? \(/);
    expect(photograph).not.toMatch(/proof && !drawn/);
    expect(photograph).toMatch(/onDeveloped=\{\(\) => setDeveloped\(true\)\}/);
    expect(photograph.match(/setDeveloped\(/g)).toHaveLength(1);
    // The view that dissolves says when it is done, by the request it was made with, and forgets its timer as it goes.
    expect(full).toMatch(/const ms = proofHoldMs\(request\);/);
    expect(full).toMatch(/if \(ms === 0\) \{\s*hold\.current = null;\s*onDeveloped\(\);\s*return;\s*\}/);
    expect(full).toMatch(/hold\.current = setTimeout\(\(\) => \{\s*hold\.current = null;\s*onDeveloped\(\);\s*\}, ms\);/);
    expect(full).toMatch(/useEffect\(\s*\(\) => \(\) => \{\s*if \(hold\.current\) clearTimeout\(hold\.current\);/);
    expect(full).toMatch(/onLoad=\{loaded\}/);
    expect(full).toMatch(/const loaded = \(\) => \{\s*onLoad\(\);/);
  });
});

describe("a plate zoomed in", () => {
  const page = read("src/components/darkroom/PrintPage.tsx");
  const zoom = page.slice(page.indexOf("function Zoom("), page.indexOf("function actualSize("));
  const photograph = page.slice(page.indexOf("function Photograph("), page.indexOf("function Full("));
  const closer = page.slice(page.indexOf("function Closer("), page.indexOf("const styles = StyleSheet.create"));

  it("is drawn from a photograph made for the zoom: a pixel of it to a pixel of the screen at the most zoom", () => {
    expect(PLATE_ZOOM).toBe(2);
    expect(zoom).toMatch(/maximumZoomScale=\{PLATE_ZOOM\}/);
    // A 361-point plate on a 3x phone: Photos is asked for the view's size at the screen's scale.
    const scale = 3;
    const box = { width: 361, height: 481 };
    const plate = box.width * scale;
    const at = closerBox(box);
    // Before: the plate's own, stretched by the zoom, half the screen's pixels.
    expect(plate / (box.width * PLATE_ZOOM)).toBe(1.5);
    // Now: the zoom's own, one to one.
    expect((at.width * scale) / (box.width * PLATE_ZOOM)).toBe(scale);
    // It lies over the plate exactly, drawn at its scale about its middle.
    expect(at.scale).toBe(1 / PLATE_ZOOM);
    expect(at.left + at.width / 2).toBe(box.width / 2);
    expect(at.top + at.height / 2).toBe(box.height / 2);
    expect(at.width * at.scale).toBe(box.width);
    expect(at.height * at.scale).toBe(box.height);
  });

  it("is kept by its view alone, never in memory after or on disk, and dissolves in unless Reduce Motion is on", () => {
    expect(closerRequest(false)).toEqual({ cachePolicy: "none", priority: "normal", allowDownscaling: false, transition: DISSOLVE });
    expect(closerRequest(true).transition).toBe(0);
    for (const prop of ["cachePolicy", "priority", "allowDownscaling", "transition"]) {
      expect(closer).toMatch(new RegExp(`${prop}=\\{request\\.${prop}\\}`));
    }
    expect(closer).toMatch(/const \[request\] = useState\(\(\) => closerRequest\(look\.reduceMotion\)\);/);
    expect(closer).not.toMatch(/prefetch|memory-disk|cachePolicy="/);
  });

  it("is there only while the plate in front is zoomed in, its own photograph has drawn, and the room is in front", () => {
    // The zoom says whether it is zoomed in, from the scroll, the pinch's end, and the page turned away.
    expect(zoom).toMatch(/zoomed\.current = \(e\.nativeEvent\.zoomScale \?\? 1\) > ZOOMED;\s*onZoomed\(zoomed\.current\);/);
    expect(zoom).toMatch(/zoomed\.current = false;\s*onZoomed\(false\);\s*actualSize\(scroll\.current, box\);/);
    expect(page).toMatch(/const \[closer, setCloser\] = useState\(false\);/);
    expect(page).toMatch(/<Zoom box=\{box\} current=\{current\} onTap=\{props\.onTap\} onZoomed=\{setCloser\}>/);
    expect(page).toMatch(/<Photograph \{\.\.\.props\} box=\{box\} onCloud=\{cloud\.step\} closer=\{closer\} \/>/);
    expect(photograph).toMatch(
      /\{images && inFront && source != null && current && closer && drawn && !closerRefused \? \(\s*<Closer id=\{print\.id\} source=\{source\} box=\{box\} onRefused=\{\(\) => setCloserRefused\(true\)\} \/>\s*\) : null\}/,
    );
    expect(page.match(/<Closer\b/g)).toHaveLength(1);
    // Under the editor the room is not in front: the closer goes, so one full decode is live behind it.
    expect(photograph).toMatch(/const inFront = props\.inFront \?\? true;/);
    expect(read("app/darkroom.tsx")).toMatch(/images=\{focused \|\| isCurrent\}\s+inFront=\{focused\}/);
  });

  it("never starts a download from iCloud: at the first word of one, or a failure, it is given up", () => {
    // Photos reports progress for a ph:// address only while it brings the photograph down from iCloud.
    expect(closer).toMatch(/onProgress=\{onRefused\}/);
    expect(closer).toMatch(/onError=\{onRefused\}/);
  });
});

/**
 * One plate in front of the member, watched by its own `PlateStall` on a
 * fake clock, the way the plate's effect watches it: on `again` the plate
 * is asked for afresh and watched again; on `trouble` it says why.
 * `progress` is when iCloud reports, in milliseconds from the start.
 */
function watchedPlate(online: boolean, progress: (t: number) => boolean, until: number) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const stall = new PlateStall();
  const againAt: number[] = [];
  let trouble: string | null = null;
  let troubleAt: number | null = null;
  let stop = () => undefined as void;
  const watch = () => {
    stop = stall.watch(online, {
      again: () => {
        againAt.push(Date.now());
        watch();
      },
      trouble: (why) => {
        trouble = why;
        troubleAt = Date.now();
      },
    });
  };
  watch();
  for (let t = 1_000; t <= until && trouble == null; t += 1_000) {
    vi.advanceTimersByTime(1_000);
    if (progress(t)) stall.heard();
  }
  stop();
  return { stall, attempts: 1 + againAt.length, againAt, trouble, troubleAt };
}

const never = () => false;

describe("a plate that hears nothing of its photograph", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks once more, then says why, instead of leaving its soft proof in place", () => {
    expect(SILENT_TRIES).toBe(1);
    // Online, the last try is given the patience a slow download needs.
    expect(watchedPlate(true, never, 120_000)).toMatchObject({
      attempts: 2,
      againAt: [PLATE_STALL_MS],
      trouble: "other",
      troubleAt: PLATE_STALL_MS + PLATE_PATIENCE_MS,
    });
    // Offline nothing can be on its way: IN ICLOUD, soon.
    expect(watchedPlate(false, never, 120_000)).toMatchObject({
      attempts: 2,
      againAt: [PLATE_STALL_MS],
      trouble: "offline",
      troubleAt: 2 * PLATE_STALL_MS,
    });
  });

  it("never cancels a download iCloud is still sending, however seldom Photos reports it", () => {
    // Progress first at 2 s, then every 20 s: longer than the first stall, inside the patience.
    const seldom = (t: number) => t === 2_000 || (t > 2_000 && (t - 2_000) % 20_000 === 0);
    expect(PLATE_PATIENCE_MS).toBeGreaterThan(20_000);
    expect(PLATE_STALL_MS).toBeLessThan(20_000);
    expect(watchedPlate(true, seldom, 180_000)).toMatchObject({ attempts: 1, trouble: null });
    // And a quick one as before.
    expect(watchedPlate(true, (t) => t % 5_000 === 0, 180_000)).toMatchObject({ attempts: 1, trouble: null });
  });

  it("gives up on a download that stops, after the patience, twice", () => {
    const stops = (t: number) => t === 2_000 || t === 4_000;
    expect(watchedPlate(true, stops, 180_000)).toMatchObject({
      attempts: 2,
      againAt: [4_000 + PLATE_PATIENCE_MS],
      trouble: "other",
      troubleAt: 4_000 + 2 * PLATE_PATIENCE_MS,
    });
  });

  it("asks again when the member turns back to a plate that gave up for hearing nothing, not one Photos refused", () => {
    const gaveUp = watchedPlate(true, never, 120_000).stall;
    expect(gaveUp.turnedTo("other")).toBe(true);
    // IN ICLOUD is asked again as the phone comes back online (asksAgain), not by turning to it.
    expect(gaveUp.turnedTo("offline")).toBe(false);
    expect(gaveUp.turnedTo("missing")).toBe(false);
    expect(gaveUp.turnedTo(null)).toBe(false);
    gaveUp.fresh();
    expect(gaveUp.turnedTo("other")).toBe(false);
    const refused = watchedPlate(true, never, 120_000).stall;
    refused.failed();
    expect(refused.turnedTo("other")).toBe(false);
    // A plate that is still waiting has nothing to ask again for.
    expect(new PlateStall().turnedTo("other")).toBe(false);
  });

  it("starts its count again once a photograph draws, or it is asked for afresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    for (const reset of ["drew", "fresh"] as const) {
      const stall = new PlateStall();
      const said: string[] = [];
      const act = { again: () => said.push("again"), trouble: (why: string) => said.push(why) };
      let stop = stall.watch(true, act);
      vi.advanceTimersByTime(PLATE_STALL_MS);
      expect(said).toEqual(["again"]);
      stop();
      stall[reset]();
      stop = stall.watch(true, act);
      vi.advanceTimersByTime(PLATE_STALL_MS);
      // A first try again: asked once more after the short stall, not given up on.
      expect(said).toEqual(["again", "again"]);
      stop();
    }
  });

  it("does nothing once the plate stops waiting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const stall = new PlateStall();
    const said: string[] = [];
    const stop = stall.watch(true, { again: () => said.push("again"), trouble: (why) => said.push(why) });
    vi.advanceTimersByTime(PLATE_STALL_MS - 1);
    stop();
    vi.advanceTimersByTime(10 * PLATE_PATIENCE_MS);
    expect(said).toEqual([]);
  });

  it("waits the whole stall from the last thing it heard", () => {
    expect(stallCheck(0, 5_000, 0, true)).toEqual({ wait: PLATE_STALL_MS - 5_000 });
    expect(stallCheck(0, PLATE_STALL_MS, 0, true)).toEqual({ again: true });
    expect(stallCheck(0, PLATE_STALL_MS, 0, true, true)).toEqual({ wait: PLATE_PATIENCE_MS - PLATE_STALL_MS });
    expect(stallCheck(0, PLATE_STALL_MS, 1, true)).toEqual({ wait: PLATE_PATIENCE_MS - PLATE_STALL_MS });
    expect(stallCheck(0, PLATE_PATIENCE_MS, 1, true)).toEqual({ trouble: "other" });
    expect(stallCheck(0, PLATE_STALL_MS, 1, false)).toEqual({ trouble: "offline" });
    expect(quietAllowed(0, false, true)).toBe(PLATE_STALL_MS);
  });

  it("is watched only in front of the member, while it is still waiting for its picture", () => {
    const page = read("src/components/darkroom/PrintPage.tsx");
    const photograph = page.slice(page.indexOf("function Photograph("), page.indexOf("function Full("));
    expect(photograph).toMatch(/const waiting = current && images && !drawn && trouble == null && !gone && source != null;/);
    expect(photograph).toMatch(/const \[stall\] = useState\(\(\) => new PlateStall\(\)\);/);
    // Asking again is a new view; giving up says why.
    expect(photograph).toMatch(
      /if \(!waiting\) return;\s*return stall\.watch\(online, \{\s*again: \(\) => \{\s*onCloud\(null\);\s*setAttempt\(\(a\) => a \+ 1\);\s*\},\s*trouble: \(why\) => \{\s*onCloud\(null\);\s*setTrouble\(why\);\s*\},\s*\}\);\s*\}, \[waiting, attempt, online, onCloud, stall\]\);/,
    );
    // Turned back to, a plate that gave up for hearing nothing asks again.
    expect(photograph).toMatch(
      /const turnedTo = current && !wasCurrent\.current;\s*wasCurrent\.current = current;\s*if \(turnedTo && stall\.turnedTo\(trouble\)\) \{\s*stall\.fresh\(\);\s*setTrouble\(null\);\s*setAttempt\(\(a\) => a \+ 1\);/,
    );
    // iCloud's progress counts as hearing something; a picture or Photos' own failure ends the watch's say.
    expect(photograph).toMatch(/onProgress=\{\(fraction\) => \{\s*stall\.heard\(\);/);
    expect(photograph).toMatch(/onLoad=\{\(\) => \{\s*stall\.drew\(\);/);
    expect(photograph).toMatch(/onError=\{\(e: ImageErrorEventData\) => \{\s*stall\.failed\(\);/);
    // Every other way of asking again starts the count afresh.
    expect(photograph.match(/stall\.fresh\(\);\s*setTrouble\(null\);\s*setAttempt\(\(a\) => a \+ 1\);/g)?.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// What the room keeps in memory
// ---------------------------------------------------------------------------

/** A plate's photograph decoded at its size on a 3× phone, 430 points wide, a little larger as Photos' fast resize hands it back. */
const PRINT_MB = (1194 * 1.3 * 1590 * 1.3 * 4) / 1e6;

/** A member turns through `n` prints; how many decoded photographs the room is keeping in memory at the end, at most. */
function keptAfter(n: number): { kept: number; releases: number } {
  const drawn = new Drawn();
  let kept = 0;
  let releases = 0;
  for (let i = 0; i < n; i++) {
    kept += 1;
    const { release } = drawn.add(`p${i}`);
    if (release) {
      releases += 1;
      drawn.released([`p${i - 1}`, `p${i}`, `p${i + 1}`]);
      // The cache is emptied; the plates on screen still hold theirs.
      kept = 2;
    }
  }
  return { kept, releases };
}

describe("the room's photographs in memory", () => {
  it("lets go of what it decoded every few prints, so an evening in the room stays a few hundred megabytes at most", () => {
    // Before: every print drawn stayed until iOS warned — a year's edit of 120 prints held all 120.
    const year = keptAfter(120);
    expect(year.releases).toBe(Math.floor(120 / RELEASE_AFTER));
    expect(year.kept).toBeLessThanOrEqual(RELEASE_AFTER + 2);
    expect(RELEASE_AFTER * PRINT_MB).toBeLessThan(220);
    expect(120 * PRINT_MB).toBeGreaterThan(1000);
  });

  it("counts a print once, however often it draws, and forgets all but the plates on screen when it lets go", () => {
    const drawn = new Drawn();
    expect(drawn.add("a")).toEqual({ first: true, release: false });
    expect(drawn.add("a")).toEqual({ first: false, release: false });
    for (let i = 1; i < RELEASE_AFTER - 1; i++) drawn.add(`x${i}`);
    expect(drawn.add("last")).toEqual({ first: true, release: true });
    drawn.released(["x3", "last"]);
    expect(drawn.has("a")).toBe(false);
    expect(drawn.has("x3")).toBe(true);
    expect(drawn.has("last")).toBe(true);
    // A print let go of dissolves in again when it next draws, and counts toward the next letting-go.
    expect(drawn.add("a")).toEqual({ first: true, release: false });
  });

  it("lets go as it draws and as the room closes, keeping the plates on screen", () => {
    const room = read("src/darkroom/useDarkroom.ts");
    expect(room).toMatch(/void Image\.clearMemoryCache\(\)\.catch\(\(\) => undefined\)/);
    const loaded = room.slice(room.indexOf("const imageLoaded = useCallback"), room.indexOf("const hasLoaded = useCallback"));
    expect(loaded).toMatch(/const \{ first, release \} = loaded\.current\.add\(id\);/);
    // The plates on screen (the one in front and one either side) keep their photographs, and stay counted as drawn.
    expect(loaded).toMatch(
      /if \(release\) \{\s*const c = live\.current\.chapter;\s*const onScreen = c \? c\.prints\.slice\(Math\.max\(0, c\.index - 1\), c\.index \+ 2\)\.map\(\(p\) => p\.id\) : \[\];\s*loaded\.current\.released\(\[\.\.\.onScreen, id\]\);\s*releaseDrawn\(\);/,
    );
    const unmount = room.slice(room.indexOf("// --- mount and unmount"));
    expect(unmount).toMatch(/mounted\.current = false;\s*\/\/[^\n]*\n\s*releaseDrawn\(\);/);
  });
});
