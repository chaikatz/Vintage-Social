import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BURST_GAP_MS,
  CARD_MIN,
  DIAL,
  dialIndex,
  dwellAt,
  edgeMarks,
  MARK_SPACING,
  PACE,
  REPLAY_MIN,
  replayable,
  replayEnding,
  replayInit,
  replayPlan,
  replayReducer,
  replayStart,
  STRIP,
  stripIndex,
  tickOf,
  trayRange,
  turnDelta,
  type ReducerContext,
  type ReplayEvent,
  type ReplayState,
} from "@/components/darkroom/replay";
import { replayBox } from "@/components/darkroom/geometry";
import { DISSOLVE, gateRequest } from "@/components/darkroom/plateImage";
import {
  dialLabel,
  edgeMarkWords,
  endPage,
  PLAY_HINT,
  PLAY_THROUGH,
  REPLAY_BACK_HINT,
  replayCardSaid,
  replayCardWords,
  replayEndSaid,
  replayValue,
  stageActions,
  stateWords,
  withPlayThrough,
  type Ending,
} from "@/components/darkroom/words";
import { anniversaryYear, captionFor, clockTime } from "@/darkroom/labels";
import type { DarkroomMode, Print } from "@/darkroom/types";
import { mulberry32 } from "@/utils/shuffle";

/**
 * PLAY in the Memory Room: the rules that need no screen. Which chapters
 * can be played and where a replay starts; how long each photograph stays,
 * where its years or days begin and which have a title card; the marks
 * along the strip; the strip's and the dial's arithmetic; the replay's
 * states; and its words. The room itself is walked in the browser
 * (`e2e/darkroom-test.mjs`).
 */

const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0) => new Date(y, m, d, h, min, s).getTime();
/** 4 December 2026, noon. */
const NOW = at(2026, 11, 4);

let seq = 0;
function print(takenAt: number, width = 3000, height = 4000): Print {
  seq += 1;
  return { id: `p${seq}`, uri: `ph://p${seq}`, width, height, takenAt, subtypes: [] };
}

const plan = (prints: Print[], mode: DarkroomMode, over: { reduceMotion?: boolean; now?: number; reach?: "day" | "week" | "season" | null } = {}) =>
  replayPlan(prints, { mode, reach: over.reach ?? "day", now: over.now ?? NOW, reduceMotion: over.reduceMotion ?? false });

// ---------------------------------------------------------------------------

describe("which chapters play, and from where", () => {
  it("plays On this day, a stretch and the shelf, shown whole, with three photographs or more", () => {
    for (const mode of ["on-this-day", "span", "set-aside"] as const) {
      expect(replayable(mode, false, false, 3), mode).toBe(true);
      expect(replayable(mode, false, false, 200), mode).toBe(true);
      expect(replayable(mode, true, false, 30), mode).toBe(false);
      expect(replayable(mode, false, true, 30), mode).toBe(false);
      expect(replayable(mode, false, false, REPLAY_MIN - 1), mode).toBe(false);
    }
    expect(replayable("surprise", false, false, 24)).toBe(false);
    expect(replayable("year", false, false, 40)).toBe(false);
  });

  it("starts at the print in front, or at the first when there is none, or it is the last", () => {
    const prints = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(replayStart(prints, "b")).toBe(1);
    expect(replayStart(prints, "c")).toBe(2);
    expect(replayStart(prints, "a")).toBe(0);
    expect(replayStart(prints, "d")).toBe(0);
    expect(replayStart(prints, "zz")).toBe(0);
    expect(replayStart(prints, null)).toBe(0);
    expect(replayStart([], null)).toBe(0);
  });

  it("ends as the chapter does", () => {
    expect(replayEnding("on-this-day", "week", null)).toEqual({ kind: "day", reach: "week" });
    expect(replayEnding("set-aside", null, null)).toEqual({ kind: "shelf" });
    expect(replayEnding("span", null, null)).toEqual({ kind: "span", span: null });
  });
});

// ---------------------------------------------------------------------------

describe("how long each photograph stays", () => {
  it("plays a burst of the same shape at 340, and anything else at Retro’s 500", () => {
    const t = at(2022, 11, 4, 10);
    // One stretch day, so no group rules apply.
    const ps = [print(t), print(t + 1200), print(t + 2400, 4000, 3000), print(t + 4401), print(t + 4401 + BURST_GAP_MS + 1), print(t + 9000)];
    const p = plan(ps, "span");
    expect(p.starts).toEqual([0]);
    expect(p.dwell[0]).toBe(PACE.burst); // 1.2 s on, same shape
    expect(p.dwell[1]).toBe(PACE.frame); // 1.2 s on, but a different shape
    expect(p.dwell[2]).toBe(PACE.frame); // 2.001 s on
    expect(p.dwell[3]).toBe(PACE.frame); // 2.001 s on
    expect(p.dwell[5]).toBe(PACE.last);
    expect([PACE.burst, PACE.frame, PACE.first, PACE.alone, PACE.last, PACE.card]).toEqual([340, 500, 900, 1000, 1600, 1000]);
  });

  it("reads a gap going backwards (On this day into an older year) as no burst", () => {
    const ps = [print(at(2025, 11, 4, 9)), print(at(2025, 11, 4, 9, 0, 1)), print(at(2025, 11, 4, 9, 0, 2)), print(at(2024, 11, 4, 9)), print(at(2024, 11, 4, 9, 0, 1)), print(at(2024, 11, 4, 9, 0, 2))];
    const p = plan(ps, "on-this-day");
    expect(p.dwell[2]).toBe(PACE.frame);
    expect(p.dwell[0]).toBe(PACE.burst);
    expect(p.dwell[3]).toBe(PACE.burst);
  });

  it("holds the first print shown at least 900, a print alone in its year at least 1000, and the last 1600", () => {
    const ps = [print(at(2025, 11, 4, 9)), print(at(2023, 11, 4, 9)), print(at(2023, 11, 4, 9, 0, 1)), print(at(2023, 11, 4, 9, 0, 2)), print(at(2019, 11, 4, 9))];
    const p = plan(ps, "on-this-day");
    expect(p.starts).toEqual([0, 1, 4]);
    expect(p.dwell[0]).toBe(PACE.alone);
    expect(p.dwell[1]).toBe(PACE.burst);
    expect(dwellAt(p, 1, true)).toBe(PACE.first);
    expect(dwellAt(p, 1, false)).toBe(PACE.burst);
    expect(dwellAt(p, 0, true)).toBe(PACE.alone);
    expect(p.dwell[4]).toBe(PACE.last);
  });

  it("never goes under 800 under Reduce Motion", () => {
    const t = at(2022, 11, 4, 10);
    const ps = Array.from({ length: 12 }, (_, i) => print(t + i * 400));
    const p = plan(ps, "set-aside", { reduceMotion: true });
    for (const d of p.dwell) expect(d).toBeGreaterThanOrEqual(PACE.reduceMotion);
    expect(p.dwell[11]).toBe(PACE.last);
  });

  it("never changes the gate more than three times in any second, whatever the photographs", () => {
    const rand = mulberry32(20261204);
    const modes: DarkroomMode[] = ["on-this-day", "span", "set-aside"];
    for (let run = 0; run < 200; run++) {
      const mode = modes[run % 3];
      const n = 3 + Math.floor(rand() * 60);
      let t = at(2022, 11, 4, 10);
      const ps: Print[] = [];
      for (let i = 0; i < n; i++) {
        // Mostly bursts; now and then a jump back a year, as On this day does.
        t += rand() < 0.1 ? -365 * 86_400_000 : Math.floor(rand() * 2500);
        ps.push(rand() < 0.8 ? print(t) : print(t, 4000, 3000));
      }
      const p = plan(ps, mode, { reduceMotion: rand() < 0.2 });
      // A replay from the first print: a card (if any), then each print for its dwell.
      const changes: number[] = [];
      let clock = 0;
      for (let i = 0; i < n; i++) {
        if (p.card[i]) {
          changes.push(clock);
          clock += PACE.card;
        }
        changes.push(clock);
        clock += dwellAt(p, i, i === 0);
      }
      for (let k = 0; k + 3 < changes.length; k++) expect(changes[k + 3] - changes[k]).toBeGreaterThanOrEqual(1000);
    }
  });
});

// ---------------------------------------------------------------------------

describe("the groups", () => {
  it("begins a new year in On this day wherever the time goes backwards", () => {
    const ps = [
      print(at(2025, 11, 4, 9)),
      print(at(2025, 11, 4, 18)),
      print(at(2022, 11, 4, 8)),
      print(at(2022, 11, 4, 9)),
      print(at(2022, 11, 4, 10)),
      print(at(2019, 11, 4, 12)),
    ];
    const p = plan(ps, "on-this-day");
    expect(p.starts).toEqual([0, 2, 5]);
    expect([...p.groupOf]).toEqual([0, 0, 1, 1, 1, 2]);
  });

  it("keeps an anniversary across New Year as one group, under the anniversary’s year", () => {
    const jan2 = at(2026, 0, 2);
    const ps = [
      print(at(2019, 11, 30, 10)),
      print(at(2019, 11, 31, 10)),
      print(at(2020, 0, 3, 10)),
      print(at(2017, 11, 29, 10)),
      print(at(2018, 0, 1, 10)),
      print(at(2018, 0, 2, 10)),
    ];
    const p = plan(ps, "on-this-day", { now: jan2, reach: "week" });
    expect(p.starts).toEqual([0, 3]);
    expect(anniversaryYear(ps[0].takenAt, jan2)).toBe(2020);
    expect(p.card[0]).toEqual({ eyebrow: "Six years ago this week", title: "2020", year: true });
    expect(p.card[3]?.title).toBe("2018");
  });

  it("groups a stretch by its days, which run to four in the morning", () => {
    const ps = [print(at(2022, 11, 3, 22)), print(at(2022, 11, 4, 2, 30)), print(at(2022, 11, 4, 11)), print(at(2022, 11, 4, 12)), print(at(2022, 11, 4, 13))];
    const p = plan(ps, "span");
    expect(p.starts).toEqual([0, 2]);
    expect(p.dwell[0]).toBeGreaterThanOrEqual(PACE.alone);
  });

  it("has no day rules in a one-day stretch, and one group on the shelf", () => {
    const t = at(2022, 11, 4, 10);
    const ps = [print(t), print(t + 60_000), print(t + 120_000), print(t + 180_000)];
    const day = plan(ps, "span");
    expect(day.starts).toEqual([0]);
    expect(day.card.every((c) => c == null)).toBe(true);
    expect(day.dwell.slice(0, 3)).toEqual([PACE.frame, PACE.frame, PACE.frame]);
    const shelf = plan([print(at(2016, 7, 1)), print(at(2012, 1, 1)), print(at(2019, 3, 3))], "set-aside");
    expect(shelf.starts).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------

describe("the title cards", () => {
  const day = [
    print(at(2025, 11, 4, 9)),
    print(at(2019, 11, 4, 8)),
    print(at(2019, 11, 4, 9)),
    print(at(2019, 11, 4, 10)),
    print(at(2016, 11, 4, 9)),
    print(at(2016, 11, 4, 10)),
  ];

  it("opens only a year of three or more in On this day, where there are two years or more", () => {
    const p = plan(day, "on-this-day");
    expect(p.card.map((c) => c != null)).toEqual([false, true, false, false, false, false]);
    expect(p.card[1]).toEqual({ eyebrow: "Seven years ago today", title: "2019", year: true });
    expect(CARD_MIN).toBe(3);
    // One year alone has no card, however many it holds.
    const one = plan(day.slice(1, 4), "on-this-day");
    expect(one.card.every((c) => c == null)).toBe(true);
  });

  it("names a day of a stretch by its weekday and date", () => {
    const ps = [print(at(2022, 11, 3, 18)), print(at(2022, 11, 4, 9)), print(at(2022, 11, 4, 10)), print(at(2022, 11, 4, 11))];
    const p = plan(ps, "span");
    expect(p.card[1]).toEqual({ eyebrow: "Sunday", title: "December 4", year: false });
    expect(replayCardWords("span", at(2022, 11, 4), NOW, null)).toEqual({ eyebrow: "Sunday", title: "December 4", year: false });
  });

  it("has none on the shelf, and none on resume", () => {
    const shelf = plan(day, "set-aside");
    expect(shelf.card.every((c) => c == null)).toBe(true);
    expect(replayCardWords("set-aside", day[0].takenAt, NOW, null)).toBeNull();
    const ctx = context(6, { card: (i) => i === 1 });
    const held: ReplayState = { ...replayInit(1, ctx), phase: "held", wait: null };
    expect(replayReducer(held, { type: "play" }, ctx).wait).toBeNull();
  });

  it("says a card aloud as it comes up", () => {
    expect(replayCardSaid({ eyebrow: "Seven years ago today", title: "2019", year: true })).toBe("2019. Seven years ago today.");
    expect(replayCardSaid({ eyebrow: "Sunday", title: "December 4", year: false })).toBe("Sunday, December 4.");
  });
});

// ---------------------------------------------------------------------------

describe("the strip’s edge marks", () => {
  it("prints the year over the first frame of each, at least three frames apart", () => {
    const years = [2025, 2024, 2023, 2023, 2023, 2022, 2021, 2021, 2021, 2021, 2019];
    const ps = years.map((y, i) => print(at(y, 11, 4, 8 + i)));
    const p = plan(ps, "on-this-day");
    expect(p.starts).toEqual([0, 1, 2, 5, 6, 10]);
    const marks = edgeMarks(ps, p, "on-this-day", NOW);
    expect([...marks.entries()]).toEqual([
      [0, "2025"],
      [5, "2022"],
      [10, "2019"],
    ]);
    const kept = [...marks.keys()];
    for (let k = 1; k < kept.length; k++) expect(kept[k] - kept[k - 1]).toBeGreaterThanOrEqual(MARK_SPACING);
  });

  it("prints the day in a stretch of two days or more, and nothing in one day or on the shelf", () => {
    const ps = [print(at(2022, 11, 3, 9)), print(at(2022, 11, 3, 10)), print(at(2022, 11, 3, 11)), print(at(2022, 11, 4, 9)), print(at(2022, 11, 4, 10))];
    expect([...edgeMarks(ps, plan(ps, "span"), "span", NOW).entries()]).toEqual([
      [0, "DEC 3"],
      [3, "DEC 4"],
    ]);
    const one = ps.slice(0, 3);
    expect(edgeMarks(one, plan(one, "span"), "span", NOW).size).toBe(0);
    expect(edgeMarks(ps, plan(ps, "set-aside"), "set-aside", NOW).size).toBe(0);
    expect(edgeMarkWords("set-aside", ps[0].takenAt, NOW)).toBeNull();
  });

  it("are dates, never frame numbers", () => {
    const ps = Array.from({ length: 30 }, (_, i) => print(at(2025 - i, 11, 4)));
    for (const words of edgeMarks(ps, plan(ps, "on-this-day"), "on-this-day", NOW).values()) expect(words).toMatch(/^\d{4}$/);
  });
});

// ---------------------------------------------------------------------------

type Ctx = ReducerContext & { readySet: Set<number>; goneSet: Set<number> };
function context(n: number, over: { card?: (i: number) => boolean; online?: boolean; ready?: number[]; gone?: number[] } = {}): Ctx {
  const readySet = new Set(over.ready ?? []);
  const goneSet = new Set(over.gone ?? []);
  return {
    n,
    readySet,
    goneSet,
    gone: (i) => goneSet.has(i),
    ready: (i) => readySet.has(i),
    card: over.card ?? (() => false),
    online: over.online ?? true,
  };
}
const run = (s: ReplayState, ctx: ReducerContext, ...events: ReplayEvent[]) => events.reduce((x, e) => replayReducer(x, e, ctx), s);

describe("the replay’s states", () => {
  it("opens playing on the print in front, fresh, with its card if it begins a group that has one", () => {
    const ctx = context(5, { card: (i) => i === 0 });
    expect(replayInit(2, ctx)).toMatchObject({ index: 2, phase: "playing", wait: null, fresh: true, centre: 2 });
    expect(replayInit(0, ctx)).toMatchObject({ index: 0, wait: "card" });
  });

  it("toggles from each phase: playing holds, held plays on, ended plays again", () => {
    const ctx = context(5, { ready: [0, 1, 2, 3, 4] });
    const s = replayInit(1, ctx);
    const held = replayReducer(s, { type: "toggle" }, ctx);
    expect(held).toMatchObject({ phase: "held", index: 1 });
    const again = replayReducer(held, { type: "toggle" }, ctx);
    expect(again).toMatchObject({ phase: "playing", index: 1, wait: null, fresh: true });
    const ended: ReplayState = { ...s, phase: "ended", index: 4 };
    expect(replayReducer(ended, { type: "toggle" }, ctx)).toMatchObject({ phase: "playing", index: 0, fresh: true });
  });

  it("plays again from the first print that is not gone, with its card, from the last print or the end", () => {
    const ctx = context(5, { card: (i) => i === 1, gone: [0] });
    const last: ReplayState = { ...replayInit(4, ctx), phase: "held" };
    expect(replayReducer(last, { type: "play" }, ctx)).toMatchObject({ phase: "playing", index: 1, wait: "card", fresh: true, centre: 1 });
    const ended: ReplayState = { ...last, phase: "ended" };
    expect(replayReducer(ended, { type: "play" }, ctx)).toMatchObject({ index: 1, wait: "card" });
    // Held on the last that is not gone is the last.
    const ctx2 = context(5, { gone: [4] });
    expect(replayReducer({ ...replayInit(3, ctx2), phase: "held" }, { type: "play" }, ctx2)).toMatchObject({ index: 0 });
  });

  it("moves on when its time is up: to a ready print, or waits for it online, or goes on offline", () => {
    const ctx = context(5, { ready: [2] });
    const s = replayInit(1, ctx);
    const on = replayReducer(s, { type: "due" }, ctx);
    expect(on).toMatchObject({ index: 2, wait: null, fresh: false, source: "clock", shown: s.shown + 1, centre: 2 });
    const waiting = replayReducer(on, { type: "due" }, ctx);
    expect(waiting).toMatchObject({ index: 2, wait: "image", pending: 3, shown: on.shown });
    expect(replayReducer(waiting, { type: "drawn", index: 3 }, ctx)).toMatchObject({ index: 3, wait: null, pending: null });
    expect(replayReducer(waiting, { type: "drawn", index: 4 }, ctx)).toBe(waiting);
    expect(replayReducer(waiting, { type: "waitedOut" }, ctx)).toMatchObject({ index: 3, wait: null });
    const offline = context(5, { online: false });
    expect(replayReducer(replayInit(1, offline), { type: "due" }, offline)).toMatchObject({ index: 2, wait: null });
  });

  it("shows a card before its group’s first print, then the print", () => {
    const ctx = context(5, { card: (i) => i === 3, ready: [0, 1, 2, 3, 4] });
    const s = run(replayInit(2, ctx), ctx, { type: "due" });
    expect(s).toMatchObject({ index: 3, wait: "card" });
    expect(replayReducer(s, { type: "due" }, ctx)).toBe(s);
    const over = replayReducer(s, { type: "cardOver" }, ctx);
    expect(over).toMatchObject({ index: 3, wait: null, shown: s.shown + 1 });
  });

  it("ends after the last print, and skips the prints known to be gone", () => {
    const ctx = context(5, { ready: [0, 1, 2, 3, 4], gone: [2, 4] });
    const s = run(replayInit(1, ctx), ctx, { type: "due" });
    expect(s.index).toBe(3);
    expect(replayReducer(s, { type: "due" }, ctx)).toMatchObject({ phase: "ended", index: 3 });
    // The photograph waited for goes: on past it.
    const c2 = context(5, {});
    const waiting = run(replayInit(0, c2), c2, { type: "due" });
    expect(waiting).toMatchObject({ wait: "image", pending: 1 });
    c2.goneSet.add(1);
    c2.readySet.add(2);
    expect(replayReducer(waiting, { type: "gone", index: 1 }, c2)).toMatchObject({ index: 2, wait: null });
  });

  it("holds from any phase as a finger comes down on the strip or the dial, and clears the waits", () => {
    const ctx = context(8, {});
    const waiting = run(replayInit(1, ctx), ctx, { type: "due" });
    expect(waiting.wait).toBe("image");
    for (const from of [waiting, { ...waiting, phase: "held" as const, wait: null }, { ...waiting, phase: "ended" as const, wait: null }]) {
      const s = replayReducer(from, { type: "scrubStart", by: "strip" }, ctx);
      expect(s).toMatchObject({ phase: "held", wait: null, pending: null, scrubbing: "strip" });
    }
    const s = run(waiting, ctx, { type: "scrubStart", by: "dial" }, { type: "scrubTo", index: 99, by: "dial" });
    expect(s).toMatchObject({ index: 7, source: "dial", centre: waiting.centre });
    expect(replayReducer(s, { type: "scrubTo", index: -4, by: "dial" }, ctx).index).toBe(0);
    expect(replayReducer(s, { type: "scrubEnd" }, ctx).scrubbing).toBeNull();
    // The photographs held ready follow once the finger has come to rest.
    expect(replayReducer(s, { type: "rest" }, ctx).centre).toBe(7);
  });

  it("steps one print at a time, held, clamped, past the gone", () => {
    const ctx = context(5, { gone: [2] });
    const s = replayInit(1, ctx);
    expect(replayReducer(s, { type: "step", by: 1, source: "tap" }, ctx)).toMatchObject({ phase: "held", index: 3, source: "tap" });
    expect(replayReducer(s, { type: "step", by: -1, source: "vo" }, ctx)).toMatchObject({ phase: "held", index: 0 });
    const first = replayInit(0, ctx);
    expect(replayReducer(first, { type: "step", by: -1, source: "tap" }, ctx)).toMatchObject({ phase: "held", index: 0 });
    const last = replayInit(4, ctx);
    expect(replayReducer(last, { type: "step", by: 1, source: "tap" }, ctx)).toMatchObject({ phase: "held", index: 4 });
  });

  it("holds as the app or the room goes out of view only when playing", () => {
    const ctx = context(5, {});
    const s = replayInit(1, ctx);
    expect(replayReducer(s, { type: "away" }, ctx).phase).toBe("held");
    const ended: ReplayState = { ...s, phase: "ended" };
    expect(replayReducer(ended, { type: "away" }, ctx)).toBe(ended);
  });

  it("never reads the clock", () => {
    const ctx = context(5, { ready: [0, 1, 2, 3, 4] });
    const s = replayInit(0, ctx);
    expect(run(s, ctx, { type: "due" }, { type: "due" })).toEqual(run(s, ctx, { type: "due" }, { type: "due" }));
  });
});

// ---------------------------------------------------------------------------

describe("the gate, the strip and the dial", () => {
  it("holds at most five photographs ready while playing and three while held, never out of range", () => {
    for (let n = 1; n < 12; n++) {
      for (let i = 0; i < n; i++) {
        for (const playing of [true, false]) {
          const [a, b] = trayRange(i, n, playing);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThan(n);
          expect(a).toBeLessThanOrEqual(i);
          expect(b).toBeGreaterThanOrEqual(i);
          expect(b - a + 1).toBeLessThanOrEqual(playing ? 5 : 3);
        }
      }
    }
    expect(trayRange(5, 10, true)).toEqual([4, 8]);
    expect(trayRange(5, 10, false)).toEqual([4, 6]);
  });

  it("stands each photograph in the gate at its own shape, on the bottom, centred, on the pixels", () => {
    // The reference phone's gate, about 361 × 450, at 3×; an SE's at 2×.
    for (const [w, h, pr] of [
      [361, 450, 3],
      [343, 322, 2],
    ] as const) {
      for (const ratio of [3 / 4, 1, 4 / 3, 16 / 9, 9 / 16, 1 / 3, 3]) {
        const b = replayBox(ratio, w, h, pr);
        expect(b.width).toBeLessThanOrEqual(w);
        expect(b.height).toBeLessThanOrEqual(h);
        expect(Math.abs(b.width / b.height - ratio)).toBeLessThan(0.02 * ratio);
        expect(b.width === w || Math.abs(b.height - h) < 1 / pr).toBe(true);
        expect(b.top + b.height).toBeCloseTo(h, 6);
        expect(Math.abs(b.left - (w - b.width) / 2)).toBeLessThanOrEqual(1 / pr);
        for (const v of [b.width, b.height, b.left]) expect(Math.abs(v * pr - Math.round(v * pr))).toBeLessThan(1e-6);
      }
    }
    expect(Math.round(replayBox(3 / 4, 361, 450, 3).width)).toBe(338);
    expect(Math.round(replayBox(3 / 4, 343, 322, 2).width)).toBe(242);
  });

  it("reads the strip’s frame under the box, rounded and clamped", () => {
    expect(STRIP.pitch).toBe(STRIP.cellW + STRIP.gap);
    expect(stripIndex(0, 10)).toBe(0);
    expect(stripIndex(17.9, 10)).toBe(0);
    expect(stripIndex(18, 10)).toBe(1);
    expect(stripIndex(72, 10)).toBe(2);
    expect(stripIndex(5000, 10)).toBe(9);
    expect(stripIndex(-80, 10)).toBe(0);
  });

  it("turns the dial the short way across 12 o’clock and 6", () => {
    expect(turnDelta(170, -170)).toBe(20);
    expect(turnDelta(-170, 170)).toBe(-20);
    expect(turnDelta(350, 10)).toBe(20);
    expect(turnDelta(10, 350)).toBe(-20);
    expect(turnDelta(0, 90)).toBe(90);
    expect(turnDelta(90, 0)).toBe(-90);
    expect(Math.abs(turnDelta(0, 180))).toBe(180);
  });

  it("never lands the dial past the last photograph", () => {
    for (const n of [3, 7, 60, 1000]) {
      expect(dialIndex((n - 1) / n, n)).toBe(n - 1);
      expect(dialIndex(0.9999, n)).toBeLessThan(n);
      expect(dialIndex(1, n)).toBe(n - 1);
      expect(dialIndex(0, n)).toBe(0);
    }
  });

  it("has sixty ticks", () => {
    const ticks = new Set(Array.from({ length: 6000 }, (_, k) => tickOf(k / 6000)));
    expect(ticks.size).toBe(DIAL.ticks);
    expect(Math.min(...ticks)).toBe(0);
    expect(Math.max(...ticks)).toBe(59);
    expect(tickOf(1)).toBe(59);
  });
});

// ---------------------------------------------------------------------------

describe("the replay’s words", () => {
  it("tells the time on a twelve-hour clock", () => {
    expect(clockTime(at(2022, 11, 4, 16, 12))).toBe("4:12 PM");
    expect(clockTime(at(2022, 11, 4, 0, 5))).toBe("12:05 AM");
    expect(clockTime(at(2022, 11, 4, 12, 0))).toBe("12:00 PM");
    expect(clockTime(at(2022, 11, 4, 9, 7))).toBe("9:07 AM");
  });

  it("names the dial by what a press does, and gives the photograph its value, never a count", () => {
    expect(dialLabel("playing")).toBe("Pause");
    expect(dialLabel("held")).toBe("Play");
    expect(dialLabel("ended")).toBe("Play again");
    const t = at(2022, 11, 4, 16, 12);
    expect(replayValue(t, "A Sunday", "playing")).toBe("December 4, 2022. A Sunday. Playing.");
    expect(replayValue(t, "A Sunday", "held")).toBe("December 4, 2022. A Sunday.");
    expect(captionFor(t, NOW, "span", null, null)).toMatchObject({ label: "DECEMBER 4, 2022", line: "A Sunday" });
    expect(PLAY_HINT).toBe("Plays this chapter through, a photograph at a time.");
    expect(REPLAY_BACK_HINT).toBe("Stops playing, and keeps this photograph in front of you.");
  });

  it("puts PLAY IT THROUGH first on the end of a day, a stretch and the shelf, and leaves endPage’s own words alone", () => {
    const ctx = { now: NOW, limited: false, years: null };
    const playable: Ending[] = [{ kind: "day", reach: "day" }, { kind: "span", span: null }, { kind: "shelf" }];
    for (const ending of playable) {
      const page = endPage(ending, ctx);
      const played = withPlayThrough(page, ending, true);
      expect(played.words[0]).toEqual(PLAY_THROUGH);
      expect(played.words.slice(1)).toEqual(page.words);
      expect(withPlayThrough(page, ending, false)).toBe(page);
    }
    for (const ending of [
      { kind: "year", year: 2016, smaller: false, fromMonth: 0, shown: 3 },
      { kind: "roll" },
      { kind: "exhausted" },
      { kind: "readFailed" },
    ] as Ending[]) {
      const page = endPage(ending, ctx);
      expect(withPlayThrough(page, ending, true)).toBe(page);
    }
    expect(endPage({ kind: "day", reach: "day" }, ctx).words.map((w) => w.act)).toEqual(["surprise", "chooseYear", "library"]);
    expect(endPage({ kind: "shelf" }, ctx).words.map((w) => w.act)).toEqual(["surprise", "library"]);
    expect(PLAY_THROUGH).toEqual({ label: "Play it through", act: "play" });
  });

  it("says the chapter’s end title as the replay ends", () => {
    const ctx = { now: NOW, limited: false, years: null };
    expect(replayEndSaid({ kind: "day", reach: "day" }, ctx)).toBe("That is everything from this day.");
    expect(replayEndSaid({ kind: "shelf" }, ctx)).toBe("That is all you set aside.");
    expect(replayEndSaid({ kind: "span", span: null }, ctx)).toBe("That is everything from it.");
  });

  it("offers Play to VoiceOver just before Contents, never while busy, and leaves the three-argument actions as they were", () => {
    const t = at(2014, 7, 1);
    expect(stageActions(t, false).map((a) => a.label)).toEqual(["Develop", "Set aside", "More from 2014", "Contents"]);
    expect(stageActions(t, false, undefined, true).map((a) => a.label)).toEqual(["Develop", "Set aside", "More from 2014", "Play", "Contents"]);
    expect(stageActions(t, false, undefined, true)[3]).toEqual({ name: "play", label: "Play" });
    const ctx = { setAside: false, shelfChapter: false, limited: false };
    const idle = { words: stateWords({ kind: "idle" }, ctx), stated: false, busy: false };
    expect(stageActions(t, false, idle).map((a) => a.name)).toEqual(["develop", "toggle", "more", "contents"]);
    expect(stageActions(t, false, idle, true).map((a) => a.name)).toEqual(["develop", "toggle", "more", "play", "contents"]);
    const busy = { words: stateWords({ kind: "downloading", progress: null }, ctx), stated: true, busy: true };
    expect(stageActions(t, false, busy, true).map((a) => a.name)).toEqual(["stop"]);
    expect(stageActions(null, false, idle, true).map((a) => a.name)).toEqual(["contents"]);
  });

  it("asks for each gate photograph kept by its view alone, dissolving only when it mounts in front", () => {
    expect(gateRequest(true, false)).toEqual({ cachePolicy: "none", priority: "normal", allowDownscaling: false, transition: DISSOLVE });
    expect(gateRequest(true, true).transition).toBe(0);
    expect(gateRequest(false, false).transition).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("the replay, in its source", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");
  /** Without its comments, so prose that names what is not done is not taken as doing it. */
  const code = (file: string) =>
    read(file)
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const dir = "src/components/darkroom";
  const views = readdirSync(path.join(root, dir))
    .filter((f) => /^Replay.*\.tsx$/.test(f))
    .map((f) => `${dir}/${f}`);
  const replayFiles = [...views, `${dir}/replay.ts`, `${dir}/useReplay.ts`, `${dir}/awake.ts`, `${dir}/PlayTab.tsx`];

  it("covers the replay's files", () => {
    expect(views.map((f) => path.basename(f)).sort()).toEqual(["Replay.tsx", "ReplayDial.tsx", "ReplayGate.tsx", "ReplayStrip.tsx"]);
  });

  it("keeps every photograph by its view alone: never the shared memory cache, never the disk", () => {
    let images = 0;
    for (const file of views) {
      const src = code(file);
      for (const m of src.matchAll(/<Image\b[\s\S]*?\/>/g)) {
        images += 1;
        expect(m[0], file).toMatch(/cachePolicy="none"|cachePolicy=\{request\.cachePolicy\}/);
      }
      expect(src, file).not.toMatch(/"(memory|disk|memory-disk)"/);
      expect(src, file).not.toMatch(/prefetch/i);
    }
    // The gate's photograph and its proof, and the strip's frame.
    expect(images).toBe(3);
    const gate = code(`${dir}/ReplayGate.tsx`);
    expect(gate).toMatch(/import \{ gateRequest, progressOf, proofHoldMs \} from "\.\/plateImage";/);
  });

  it("fixes each gate photograph's request as its view is made, and shows it by its wrapper's opacity alone", () => {
    const gate = code(`${dir}/ReplayGate.tsx`);
    const slot = gate.slice(gate.indexOf("const Slot = memo("), gate.indexOf("function ScrubProof("));
    expect(slot).toMatch(/const \[request\] = useState\(\(\) => gateRequest\(current, look\.reduceMotion\)\);/);
    expect(slot).toMatch(/const \[source\] = useState\(\(\) => printSource\(print\.uri\)\);/);
    const image = slot.slice(slot.indexOf("<Image"));
    expect(image).not.toMatch(/\bcurrent\b/);
    for (const prop of ["cachePolicy", "priority", "allowDownscaling", "transition"]) expect(image).toMatch(new RegExp(`${prop}=\\{request\\.${prop}\\}`));
    expect(image).toMatch(/recyclingKey=\{id\}/);
    // The one thing that differs between the slot in front and the rest.
    expect(slot.match(/current \?/g)).toHaveLength(1);
    expect(slot).toMatch(/style=\{\[styles\.box, \{ left, top, width, height, opacity: current \? 1 : 0 \}\]\}/);
    // Nothing drawn before the gate has a size.
    expect(gate).toMatch(/const box = size\.width > 0 && size\.height > 0 \? boxFor\(current\) : null;/);
  });

  it("asks the library nothing: no reader, no source, no page or count", () => {
    const forbidden = /^(@\/darkroom\/(source|discovery|nativeSource|nativeLibrary|demoSource|develop|localFile|access|eligibility)|\.\/(visit|dealer|chapter))$/;
    for (const file of replayFiles) {
      const src = code(file);
      const from = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const spec of from) expect(forbidden.test(spec), `${file} imports ${spec}`).toBe(false);
      expect(src, file).not.toMatch(/\.(page|count|oldest)\(/);
      if (file !== `${dir}/replay.ts`) expect(src, file).not.toMatch(/@\/darkroom\/occasions/);
    }
    // The one thing taken from the occasions: how a day is counted.
    expect(code(`${dir}/replay.ts`)).toMatch(/^import \{ occasionDay \} from "@\/darkroom\/occasions";$/m);
    // The room's own rule for a print seen, and nothing else of the room's state.
    expect(code(`${dir}/useReplay.ts`)).toMatch(/^import \{ SEEN_AFTER_MS \} from "@\/darkroom\/useDarkroom";$/m);
  });

  it("keeps the screen awake only through a guarded call to Expo's own keep-awake", () => {
    const awake = code(`${dir}/awake.ts`);
    expect(awake).toMatch(/export const KEEP_AWAKE_TAG = "vintage-replay";/);
    expect(awake).toMatch(/try \{\s*loaded = require\("expo-keep-awake"\) as KeepAwake;\s*\} catch \{/);
    const guarded = awake.slice(awake.indexOf("export function stayAwake"));
    expect(guarded).toMatch(
      /try \{[\s\S]*?activateKeepAwakeAsync\(KEEP_AWAKE_TAG\)\.catch\(\(\) => undefined\);[\s\S]*?deactivateKeepAwake\(KEEP_AWAKE_TAG\)\.catch\(\(\) => undefined\);[\s\S]*?\} catch \{/,
    );
    // Only while it plays, and let go as it closes.
    const hook = code(`${dir}/useReplay.ts`);
    expect(hook).toMatch(/stayAwake\(state\.phase === "playing"\);/);
    expect(hook).toMatch(/useEffect\(\(\) => \(\) => stayAwake\(false\), \[\]\);/);
  });

  it("steps the hand onto each photograph's place under Reduce Motion, never a photograph ahead", () => {
    const hook = code(`${dir}/useReplay.ts`);
    const effect = hook.slice(hook.indexOf("const hand = useRef("), hook.indexOf("AppState.addEventListener"));
    // Playing, the hand is set on the photograph in front; only with motion does it then sweep on to the next.
    expect(effect).toMatch(/hand\.setValue\(i \/ n\);\s*if \(reduceMotion\) return;\s*const left = [^;]+;\s*return to\(\(i \+ 1\) \/ n, /);
    expect(effect.match(/\(i \+ 1\) \/ n/g)).toHaveLength(1);
  });

  it("holds as the app leaves the foreground", () => {
    const hook = code(`${dir}/useReplay.ts`);
    expect(hook).toMatch(/AppState\.addEventListener\("change", \(next\) => \{\s*if \(next !== "active"\) dispatch\(\{ type: "away" \}\);/);
  });

  it("feels the dial's ticks, and nothing else", () => {
    const haptics = code(`${dir}/haptics.ts`);
    expect(haptics).toMatch(/detent: \(\) => quietly\(Haptics\.selectionAsync\(\)\),/);
    const callers: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(path.join(root, d), { withFileTypes: true })) {
        const f = `${d}/${e.name}`;
        if (e.isDirectory()) walk(f);
        else if (/\.tsx?$/.test(e.name) && /haptics\.detent\(/.test(code(f))) callers.push(f);
      }
    };
    walk("src");
    walk("app");
    expect(callers).toEqual([`${dir}/ReplayDial.tsx`]);
    for (const file of [`${dir}/ReplayStrip.tsx`, `${dir}/ReplayGate.tsx`, `${dir}/Replay.tsx`, `${dir}/PlayTab.tsx`]) {
      expect(code(file), file).not.toMatch(/haptics|expo-haptics/);
    }
  });

  it("draws PLAY as CONTENTS is drawn, and never in the accent", () => {
    const tab = code(`${dir}/PlayTab.tsx`);
    expect(tab).toMatch(/<Feather name="play" size=\{14\} color=\{room\.ink\} accessible=\{false\} \/>/);
    expect(tab).toMatch(/<RoomText kind="tab" numberOfLines=\{1\} maxFontSizeMultiplier=\{1\.15\}>\s*Play\s*<\/RoomText>/);
    expect(tab).toMatch(/borderColor: contrast \? room\.soft : room\.lineFirm/);
    expect(tab).not.toMatch(/accent/);
    expect(tab).toMatch(/accessibilityHint=\{PLAY_HINT\}/);
    expect(tab).toMatch(/testID="darkroom-play"/);
  });
  it("is a mode of the room's own page: the back swipe off, CONTENTS out of the head, Back closing it", () => {
    const room = code("app/darkroom.tsx");
    expect(room).toMatch(/<Stack\.Screen options=\{\{ headerShown: false, gestureEnabled: replay == null \}\} \/>/);
    expect(room).toMatch(/<RunningHead\s+top=\{insets\.top\}[\s\S]*?contents=\{inside && replay == null\}[\s\S]*?backHint=\{replay \? REPLAY_BACK_HINT : undefined\}[\s\S]*?onBack=\{replay \? \(\) => replayRef\.current\?\.close\(\) : back\}/);
    expect(room).toMatch(/onAccessibilityEscape=\{\(\) => \(replay \? replayRef\.current\?\.close\(\) : sheet\.open \? sheet\.close\(\) : back\(\)\)\}/);
    // Held as the room goes out of view, as the app leaving the foreground holds it.
    expect(room).toMatch(/onBlur\.current = \(\) => \{\s*replayRef\.current\?\.hold\("away"\);/);
    // In the stage's place, and the bottom row's, which fade out together.
    expect(room).toMatch(/\{replay && chapter \? \(\s*<Replay\b[\s\S]*?\) : \(\s*<Animated\.View style=\{\[styles\.room, \{ opacity: roomFade \}\]\}>/);
    // Its three ways in: PLAY, the end page's first word, and VoiceOver's action.
    expect(room).toMatch(/<PlayTab\s+opacity=\{developOpacity\}\s+interactive=\{showsPlay && !atTail && !dragging\}/);
    expect(room).toMatch(/const showsPlay = canPlay && showsDevelop && currentState\.kind === "idle";/);
    expect(room).toMatch(/withPlayThrough\(endPage\(darkroom\.ending, \{ now, limited, years: state\.years \}\), darkroom\.ending, canPlay\)/);
    expect(room).toMatch(/case "play":\s*return startReplay\(null\);/);
    expect(room).toMatch(/stageActions\([^;]*?, canPlay && !atTail\)/);
    expect(room).toMatch(/if \(name === "play"\) return startReplay\(current\.id\);/);
    // It plays a snapshot of the chapter, all but the prints known to be gone, and lands the room on the one it stopped on.
    expect(room).toMatch(/chapterPrints\.filter\(\(p\) => !state\.missing\.has\(p\.id\)\)/);
    expect(room).toMatch(/const i = chapter \? chapter\.prints\.findIndex\(\(p\) => p\.id === id\) : -1;\s*if \(i >= 0\) onSettle\(i\);/);
    // Closed at once if the chapter is dealt again, or goes, under it.
    expect(room).toMatch(/chapter\?\.generation !== replay\.generation \|\| state\.view\.kind !== "prints" \|\| state\.loading != null/);
    // Still the one tap handed to the pager.
    expect(room.match(/onTap=/g)).toHaveLength(1);
  });
});
