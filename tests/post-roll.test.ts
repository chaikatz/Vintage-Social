import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ageWords,
  cellLabel,
  cellSize,
  heroFrame,
  heroHeight,
  heroMetrics,
  keepSelection,
  KEEP_SELECTION_MS,
  mergeNewest,
  mergeOlder,
  nextRange,
  pageHeight,
  PREVIEW_MAX,
  PREVIEW_MIN,
  RELEASE_AFTER_BLUR_MS,
  rollRows,
  ROLL_CAP,
  ROLL_FIRST,
  ROLL_MIN_VISIBLE,
  ROLL_PAGE,
  ROLL_STALE_MS,
  roomDoorFace,
  SECOND_TAP_MS,
  shouldRefresh,
  visibleOf,
  wellRows,
} from "@/post/roll";
import { MAX_PAGE } from "@/darkroom/eligibility";
import type { Print } from "@/darkroom/types";

/**
 * The Post tab's rules, without a phone: the page's measurements on the
 * three phone sizes it is drawn for, the roll's rows, how it is read and
 * merged a bounded page at a time, which photograph is selected, and the
 * words under the one on the mount.
 */

const root = path.resolve(import.meta.dirname, "..");

function print(n: number, over: Partial<Print> = {}): Print {
  return {
    id: `p${n}`,
    uri: `ph://p${n}`,
    width: 4032,
    height: 3024,
    takenAt: new Date(2024, 5, 1, 12).getTime() - n * 3_600_000,
    subtypes: [],
    ...over,
  };
}
const prints = (count: number) => Array.from({ length: count }, (_, i) => print(i));

/** The three phones: 320 × 568 (insets 20/0), 390 × 844 (47/34), 440 × 956 (62/34). */
const PHONES = [
  { W: 320, H: 568, top: 20, bottom: 0, page: 468, hero: 234 },
  { W: 390, H: 844, top: 47, bottom: 34, page: 683, hero: 342 },
  { W: 440, H: 956, top: 62, bottom: 34, page: 780, hero: 390 },
];

describe("the page's measurements", () => {
  it("are taken between the tab header and the tab bar, from the window and its insets", () => {
    for (const p of PHONES) expect(pageHeight(p.H, p.top, p.bottom), `${p.W}`).toBe(p.page);
  });

  it("give the mount half the page, no less than 230 and no more than 400", () => {
    for (const p of PHONES) expect(heroHeight(p.page)).toBe(p.hero);
    expect(heroHeight(300)).toBe(230);
    expect(heroHeight(1200)).toBe(400);
  });

  it("set the narrow phone's mount a little tighter", () => {
    expect(heroMetrics(320)).toEqual({ mount: 10, strip: 52, button: 36 });
    expect(heroMetrics(390)).toEqual({ mount: 12, strip: 56, button: 40 });
    expect(heroMetrics(440)).toEqual({ mount: 12, strip: 56, button: 40 });
  });

  it("frame the photograph as the editor will, centred on the mount", () => {
    const shape = (w: number, h: number) => ({ width: w, height: h });
    const sizes: [number, number, [number, number], [number, number]][] = [
      // W, H, shape, frame
      [390, 342, [4, 5], [219.2, 274]],
      [390, 342, [1, 1], [274, 274]],
      [390, 342, [5, 4], [342.5, 274]],
      [390, 342, [3, 2], [366, 244]],
      [390, 342, [1.91, 1], [366, 191.623]],
      [320, 234, [4, 5], [137.6, 172]],
      [320, 234, [1, 1], [172, 172]],
      [320, 234, [3, 2], [258, 172]],
      [320, 234, [1.91, 1], [300, 157.068]],
      [440, 390, [4, 5], [257.6, 322]],
      [440, 390, [1, 1], [322, 322]],
      [440, 390, [3, 2], [416, 277.333]],
      [440, 390, [1.91, 1], [416, 217.801]],
      // Taller than 4:5 is framed 4:5, wider than 1.91 is framed 1.91, as compose frames them.
      [390, 342, [9, 16], [219.2, 274]],
      [390, 342, [3, 1], [366, 191.623]],
    ];
    for (const [W, H, [w, h], [fw, fh]] of sizes) {
      const f = heroFrame(shape(w, h), W, H);
      const { mount, strip } = heroMetrics(W);
      expect(f.width, `${W} ${w}:${h}`).toBeCloseTo(fw, 2);
      expect(f.height, `${W} ${w}:${h}`).toBeCloseTo(fh, 2);
      expect(f.left).toBeCloseTo((W - f.width) / 2, 5);
      expect(f.top).toBeCloseTo(mount + (H - mount - strip - f.height) / 2, 5);
      expect(f.width).toBeLessThanOrEqual(W - 2 * mount + 1e-9);
    }
    // A print with no size is framed square.
    expect(heroFrame(shape(0, 0), 390, 342).width).toBe(274);
  });

  it("keep the editor's own clamp on a photograph's shape", () => {
    const compose = readFileSync(path.join(root, "app/compose.tsx"), "utf8");
    const clamp = compose.match(/const previewRatio = width && height \? Math\.min\(Math\.max\(width \/ height, (\d+) \/ (\d+)\), ([\d.]+)\) : 1;/);
    expect(clamp).not.toBeNull();
    expect(PREVIEW_MIN).toBe(Number(clamp![1]) / Number(clamp![2]));
    expect(PREVIEW_MAX).toBe(Number(clamp![3]));
  });

  it("set the roll four to a row, edge to edge, two points between", () => {
    expect(cellSize(320)).toBe(78.5);
    expect(cellSize(390)).toBe(96);
    expect(cellSize(440)).toBe(108.5);
  });
});

describe("the roll's rows", () => {
  it("are four to a row, the camera first only when asked for, the last row as long as it is", () => {
    const withCamera = rollRows(prints(6), { camera: true });
    expect(withCamera.map((r) => r.items.map((i) => i.key))).toEqual([["camera", "p0", "p1", "p2"], ["p3", "p4", "p5"]]);
    const without = rollRows(prints(6), { camera: false });
    expect(without.map((r) => r.items.length)).toEqual([4, 2]);
    expect(without[0].items.every((i) => i.kind === "print")).toBe(true);
    expect(rollRows([], { camera: true })).toEqual([{ key: "row-camera", items: [{ kind: "camera", key: "camera" }] }]);
    expect(rollRows([], { camera: false })).toEqual([]);
    // Every row has its own key.
    const keys = rollRows(prints(40), { camera: true }).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stand in as three rows of wells, the camera among them", () => {
    const wells = wellRows({ camera: true });
    expect(wells).toHaveLength(3);
    expect(wells.flatMap((r) => r.items)).toHaveLength(12);
    expect(wells[0].items[0].kind).toBe("camera");
    expect(wells.flatMap((r) => r.items).filter((i) => i.kind === "well")).toHaveLength(11);
    expect(wellRows({ camera: false }).flatMap((r) => r.items).every((i) => i.kind === "well")).toBe(true);
  });
});

describe("reading the roll", () => {
  it("reads in bounded pages, never past what Photos is asked for at once", () => {
    expect(ROLL_FIRST).toBe(60);
    expect(ROLL_PAGE).toBe(120);
    expect(ROLL_PAGE).toBeLessThanOrEqual(MAX_PAGE);
    expect(ROLL_CAP).toBe(1200);
    expect(ROLL_MIN_VISIBLE).toBe(24);
    expect(ROLL_STALE_MS).toBe(60_000);
    expect(RELEASE_AFTER_BLUR_MS).toBe(10_000);
    expect(KEEP_SELECTION_MS).toBe(300_000);
    expect(SECOND_TAP_MS).toBe(400);
  });

  it("leaves screenshots out of the whole library, and keeps every one the member chose", () => {
    const shot = print(1, { subtypes: ["screenshot"] });
    const list = [print(0), shot, print(2, { subtypes: ["livePhoto"] })];
    expect(visibleOf(list, "full").map((p) => p.id)).toEqual(["p0", "p2"]);
    expect(visibleOf(list, "limited").map((p) => p.id)).toEqual(["p0", "p1", "p2"]);
  });

  it("reads on from the oldest photograph read, that millisecond and all, or steps past it", () => {
    const list = prints(3);
    const oldest = list[2].takenAt;
    expect(nextRange(list)).toEqual({ from: new Date(1900, 0, 1).getTime(), to: oldest + 1 });
    expect(nextRange(list, true)).toEqual({ from: new Date(1900, 0, 1).getTime(), to: oldest });
    expect(nextRange([])).toBeNull();
  });

  it("adds an older page once each, newest first", () => {
    const first = prints(3);
    const page = [print(2), print(3), print(4)];
    const merged = mergeOlder(first, page);
    expect(merged.prints.map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(merged.added).toBe(2);
    expect(mergeOlder(first, [print(1), print(2)]).added).toBe(0);
  });

  it("never asks the same question twice, even when more photographs share one millisecond than a page holds", () => {
    // Twenty photographs at one instant, and a library that answers pages of five.
    const at = new Date(2020, 0, 1).getTime();
    const library = [
      ...Array.from({ length: 20 }, (_, i) => print(100 + i, { takenAt: at })),
      ...Array.from({ length: 5 }, (_, i) => print(200 + i, { takenAt: at - (i + 1) * 1000 })),
    ];
    const pageOf = (to: number) => {
      const inRange = library.filter((p) => p.takenAt < to).sort((a, b) => b.takenAt - a.takenAt);
      return { prints: inRange.slice(0, 5), hasNextPage: inRange.length > 5 };
    };
    let read: Print[] = pageOf(at + 1).prints;
    let more = true;
    let stepPast = false;
    const asked: number[] = [];
    for (let i = 0; i < 50 && more; i++) {
      const range = nextRange(read, stepPast)!;
      asked.push(range.to);
      const page = pageOf(range.to);
      const merged = mergeOlder(read, page.prints);
      read = merged.prints;
      more = page.hasNextPage;
      stepPast = merged.added === 0;
    }
    expect(more).toBe(false);
    expect(new Set(asked).size).toBe(asked.length);
    expect(asked.length).toBeLessThan(10);
    // Every photograph older than that instant is read.
    expect(read.filter((p) => p.takenAt < at)).toHaveLength(5);
  });

  it("reads the newest page again over the newest stretch, dropping what was deleted from it and keeping what is older", () => {
    const before = prints(8);
    // p1 was deleted; p-1 is new; the page holds the newest five.
    const page = { prints: [print(-1), print(0), print(2), print(3), print(4)], hasNextPage: true };
    const after = mergeNewest(before, page);
    expect(after.map((p) => p.id)).toEqual(["p-1", "p0", "p2", "p3", "p4", "p5", "p6", "p7"]);
    // A page that is the whole library is all of it.
    expect(mergeNewest(before, { prints: [print(0)], hasNextPage: false }).map((p) => p.id)).toEqual(["p0"]);
    expect(mergeNewest(before, { prints: [], hasNextPage: false })).toEqual([]);
  });

  it("reads the newest again on focus only a minute on, or once the library has been heard to change", () => {
    const now = 1_000_000;
    expect(shouldRefresh(now - 59_000, now, false)).toBe(false);
    expect(shouldRefresh(now - 61_000, now, false)).toBe(true);
    expect(shouldRefresh(now - 1_000, now, true)).toBe(true);
    expect(shouldRefresh(null, now, false)).toBe(true);
  });
});

describe("the selection", () => {
  const list = prints(5);
  const now = 10_000_000;

  it("is kept across visits for five minutes, while its photograph is still in the roll", () => {
    expect(keepSelection({ id: "p3", at: now - 60_000 }, list, now)).toBe("p3");
    expect(keepSelection({ id: "p3", at: now - 299_000 }, list, now)).toBe("p3");
  });

  it("gives way to the newest after five minutes, when its photograph is gone, or when there was none", () => {
    expect(keepSelection({ id: "p3", at: now - 300_000 }, list, now)).toBe("p0");
    expect(keepSelection({ id: "gone", at: now }, list, now)).toBe("p0");
    expect(keepSelection(null, list, now)).toBe("p0");
    expect(keepSelection(null, [], now)).toBeNull();
  });
});

describe("the words under the photograph", () => {
  const now = new Date(2026, 10, 25, 15, 0).getTime();
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

  it("say how long ago in words, without a full stop", () => {
    const table: [number, string][] = [
      [at(2026, 10, 25, 9), "Today"],
      [at(2026, 10, 24, 23), "Yesterday"],
      [at(2026, 10, 23), "Two days ago"],
      [at(2026, 10, 19), "Six days ago"],
      [at(2026, 10, 18), "One week ago"],
      [at(2026, 10, 11), "Two weeks ago"],
      [at(2026, 10, 4), "Three weeks ago"],
      [at(2026, 9, 28), "Four weeks ago"],
      [at(2026, 9, 25), "One month ago"],
      [at(2025, 11, 30), "Ten months ago"],
      [at(2025, 11, 25), "Eleven months ago"],
      [at(2025, 10, 25), "One year ago"],
      [at(2020, 7, 14), "Six years ago"],
      [at(1906, 0, 1), "120 years ago"],
    ];
    for (const [t, words] of table) {
      expect(ageWords(t, now), new Date(t).toDateString()).toBe(words);
      expect(words).not.toMatch(/\.$/);
    }
  });

  it("read a date ahead of the phone's clock as today", () => {
    expect(ageWords(now + 3 * 86_400_000, now)).toBe("Today");
  });

  it("count days by the calendar, across midnight and across a change of the clocks", () => {
    // Five minutes before midnight is yesterday at five past.
    expect(ageWords(new Date(2026, 10, 24, 23, 55).getTime(), new Date(2026, 10, 25, 0, 5).getTime())).toBe("Yesterday");
    // Wherever the clocks change in March and November, a week is a week, and a day a day.
    expect(ageWords(new Date(2026, 2, 5, 12).getTime(), new Date(2026, 2, 12, 12).getTime())).toBe("One week ago");
    expect(ageWords(new Date(2026, 2, 28, 23, 30).getTime(), new Date(2026, 2, 30, 0, 30).getTime())).toBe("Two days ago");
    expect(ageWords(new Date(2026, 9, 31, 23, 30).getTime(), new Date(2026, 10, 2, 0, 30).getTime())).toBe("Two days ago");
  });

  it("name a cell for VoiceOver by its date and time", () => {
    expect(cellLabel({ takenAt: new Date(2019, 9, 14, 18, 42).getTime() })).toBe("Photograph, October 14, 2019, 6:42 PM");
    expect(cellLabel({ takenAt: new Date(2019, 9, 14, 0, 5).getTime() })).toBe("Photograph, October 14, 2019, 12:05 AM");
  });
});

describe("the Memory Room's door", () => {
  const cover = { front: print(1), back: print(2) };
  const shelf = print(9);

  it("says where the member left off, or what the room is for", () => {
    expect(roomDoorFace("You left off in July 2021.", null, null, true).line).toBe("You left off in July 2021.");
    expect(roomDoorFace(null, null, null, true).line).toBe("Rediscover something worth sharing.");
  });

  it("carries the print left off on and its neighbour; else the newest set aside; else words alone", () => {
    expect(roomDoorFace("x", cover, shelf, true)).toMatchObject({ front: cover.front, back: cover.back });
    expect(roomDoorFace(null, null, shelf, true)).toMatchObject({ front: shelf, back: null });
    expect(roomDoorFace(null, null, null, true)).toMatchObject({ front: null, back: null });
  });

  it("draws no photograph where the library may not be shown", () => {
    expect(roomDoorFace("x", cover, shelf, false)).toEqual({ line: "x", front: null, back: null });
  });
});
