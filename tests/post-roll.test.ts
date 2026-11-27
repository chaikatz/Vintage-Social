import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  afterPosting,
  ageWords,
  CAMERA_LINE,
  CAMERA_MARK,
  cellLabel,
  cellSize,
  COLUMNS,
  FRAME_INSET,
  FRAME_RATIO,
  frameRatio,
  GAP,
  HEAD_WORDS,
  HEADER_BAND,
  HEADER_BELOW,
  keepSelection,
  KEEP_SELECTION_MS,
  LINE_HEIGHT,
  LINE_TYPE,
  mergeNewest,
  mergeOlder,
  newerArrived,
  nextRange,
  photoRect,
  PREVIEW_MAX,
  PREVIEW_MIN,
  previewFrame,
  recentHeight,
  RELEASE_AFTER_BLUR_MS,
  rollRows,
  ROLL_CAP,
  ROLL_FIRST,
  ROLL_MIN_VISIBLE,
  ROLL_PAGE,
  ROLL_STALE_MS,
  rowsInSight,
  SECOND_TAP_MS,
  SELECTED_BORDER,
  shouldRefresh,
  TAB_BAR,
  TAB_HEADER,
  visibleOf,
  wellRows,
} from "@/post/roll";
import { MAX_PAGE } from "@/darkroom/eligibility";
import type { Print } from "@/darkroom/types";

/**
 * The Post tab's rules, without a phone: the owner's mock, measured, and
 * the page's measurements on the three phone sizes it is drawn for; the
 * roll's rows; how it is read and merged a bounded page at a time; which
 * photograph is selected; and the words VoiceOver hears for it.
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
  { W: 320, H: 568, top: 20, bottom: 0, recent: 443 },
  { W: 390, H: 844, top: 47, bottom: 34, recent: 658 },
  { W: 440, H: 956, top: 62, bottom: 34, recent: 755 },
];

/**
 * The owner's mock (owner/post-mock.png, 390 × 797 at 1x, the status bar
 * cropped off, so y is from the top of the safe area), as measured from
 * its pixels: the header's caps from y 21 to 34, Recent from x 82 and
 * Memory Room to x 307 (the pair centred on 195); the photograph from
 * (27, 56) to (363, 476); LIBRARY's caps from x 27, a letter every 10.5
 * points, 6 tall, and POST's every 11.7, 7 tall, its arrow ending at x 361;
 * the roll from y 522, cells 96 square at x 0, 98, 196 and 294; the
 * camera tile's line 1 point, its mark 18 × 16 around the cell's middle;
 * the selected cell's rust 3 points inside its edge.
 */
const MOCK = {
  width: 390,
  frame: { left: 27, top: 56, width: 336, height: 420 },
  rollTop: 522,
  cells: [0, 98, 196, 294],
  cell: 96,
  libraryPitch: 10.5,
  postPitch: 11.7,
  camera: { line: 1, mark: 18 },
  border: 3,
  words: { capTop: 21, baseline: 34 },
};

describe("the mock's measurements", () => {
  it("are the page's own numbers", () => {
    expect(HEADER_BAND).toBe(MOCK.frame.top);
    expect(FRAME_INSET).toBe(MOCK.frame.left);
    expect(FRAME_RATIO).toBe(MOCK.frame.width / MOCK.frame.height);
    expect(LINE_HEIGHT).toBe(MOCK.rollTop - (MOCK.frame.top + MOCK.frame.height));
    expect(COLUMNS).toBe(4);
    expect(GAP).toBe(MOCK.cells[1] - MOCK.cells[0] - MOCK.cell);
    expect(SELECTED_BORDER).toBe(MOCK.border);
    expect(CAMERA_LINE).toBe(MOCK.camera.line);
    // Feather's camera is 22 of its 24 across: 20 points draws the mock's 18.
    expect(Math.round((CAMERA_MARK * 22) / 24)).toBe(MOCK.camera.mark);
  });

  it("set the line's typewriter as the mock spaces it: a letter's width (0.6 of its size) and its spacing make its pitch", () => {
    expect(LINE_TYPE.library.size * 0.6 + LINE_TYPE.library.tracking).toBeCloseTo(MOCK.libraryPitch, 1);
    expect(LINE_TYPE.post.size * 0.6 + LINE_TYPE.post.tracking).toBeCloseTo(MOCK.postPitch, 1);
    expect(LINE_TYPE.arrow.length).toBe(12);
  });

  it("set the header's words at 20 points, their caps (0.69 of the serif's size) as tall as the mock's", () => {
    expect(HEAD_WORDS.size).toBe(20);
    // Rows 21 to 34 of the mock are inked: 14 points of capital.
    expect(Math.round(HEAD_WORDS.size * 0.69)).toBe(MOCK.words.baseline - MOCK.words.capTop + 1);
    // The shared header's 36 points and the Post tab's own 20 make the mock's band.
    expect(TAB_HEADER + HEADER_BELOW).toBe(HEADER_BAND);
  });

  it("put the frame, the line and the roll where the mock has them at 390", () => {
    const recent = recentHeight(844, 47, 34);
    const frame = previewFrame(390, recent);
    expect(frame).toEqual({ left: 27, top: 0, width: 336, height: 420 });
    // From the top of the safe area: the header's band, then the frame, then the line.
    expect(HEADER_BAND + frame.top).toBe(MOCK.frame.top);
    expect(HEADER_BAND + frame.height + LINE_HEIGHT).toBe(MOCK.rollTop);
    expect(cellSize(390)).toBe(MOCK.cell);
    expect([0, 1, 2, 3].map((i) => i * (cellSize(390) + GAP))).toEqual(MOCK.cells);
  });
});

describe("the page's measurements", () => {
  it("give Recent the height between the header's band and the tab bar", () => {
    for (const p of PHONES) expect(recentHeight(p.H, p.top, p.bottom), `${p.W}`).toBe(p.recent);
    expect(TAB_BAR).toBe(49);
  });

  it("keep the frame 27 in from either edge and 4:5, but on a phone too short to show a row of the roll under it", () => {
    const at = (p: (typeof PHONES)[number]) => previewFrame(p.W, p.recent);
    // 440: the mock's inset, taller.
    expect(at(PHONES[2])).toEqual({ left: 27, top: 0, width: 386, height: 482.5 });
    // 320 × 568: the frame gives way so the first row of the roll shows under the line.
    const small = at(PHONES[0]);
    expect(small.height).toBeCloseTo(PHONES[0].recent - LINE_HEIGHT - (cellSize(320) + GAP), 5);
    expect(small.width / small.height).toBeCloseTo(4 / 5, 9);
    expect(small.left).toBeCloseTo((320 - small.width) / 2, 9);
    expect(small.width).toBeLessThan(320 - 2 * 27);
    // A 320-point window with room to spare (the browser's, with no insets) keeps the mock's inset.
    expect(previewFrame(320, 568 - HEADER_BAND - TAB_BAR)).toEqual({ left: 27, top: 0, width: 266, height: 332.5 });
    for (const p of PHONES) {
      const f = at(p);
      expect(f.height + LINE_HEIGHT + cellSize(p.W) + GAP, `${p.W}`).toBeLessThanOrEqual(p.recent + 1e-9);
    }
  });

  it("stand the photograph in the frame at the shape the editor posts it, centred, so nothing under the frame moves", () => {
    const frame = { width: 336, height: 420 };
    const table: [number, number, [number, number, number, number]][] = [
      // shape, then left, top, width, height in the frame
      [4, 5, [0, 0, 336, 420]],
      [3, 4, [0, 0, 336, 420]], // taller than 4:5 is posted 4:5
      [9, 16, [0, 0, 336, 420]],
      [1, 1, [0, 42, 336, 336]],
      [4, 3, [0, 84, 336, 252]],
      [3, 2, [0, 98, 336, 224]],
      [1.91, 1, [0, 122.03, 336, 175.92]],
      [3, 1, [0, 122.03, 336, 175.92]], // wider than 1.91 is posted 1.91
    ];
    for (const [w, h, [left, top, width, height]] of table) {
      const r = photoRect({ width: w, height: h }, frame);
      expect(r.left, `${w}:${h}`).toBeCloseTo(left, 1);
      expect(r.top, `${w}:${h}`).toBeCloseTo(top, 1);
      expect(r.width, `${w}:${h}`).toBeCloseTo(width, 1);
      expect(r.height, `${w}:${h}`).toBeCloseTo(height, 1);
      expect(r.top * 2 + r.height).toBeCloseTo(frame.height, 6);
      expect(r.width / r.height).toBeCloseTo(frameRatio({ width: w, height: h }), 6);
    }
    // A print with no size is posted square.
    expect(photoRect({ width: 0, height: 0 }, frame)).toMatchObject({ width: 336, height: 336 });
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
    expect(rollRows([], { camera: true })).toEqual([{ key: "row-0", items: [{ kind: "camera", key: "camera" }] }]);
    expect(rollRows([], { camera: false })).toEqual([]);
    // Under a limited selection SHARE MORE stands after the camera, and the photographs after it.
    expect(rollRows(prints(3), { camera: true, more: true })[0].items.map((i) => i.key)).toEqual(["camera", "more", "p0", "p1"]);
    expect(rollRows(prints(3), { camera: false, more: true })[0].items.map((i) => i.kind)).toEqual(["more", "print", "print", "print"]);
    // Every row has its own key.
    const keys = rollRows(prints(40), { camera: true }).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("are named by their place, so a photograph arriving at the top makes again only the one cell in each row that crosses into the next", () => {
    const before = rollRows(prints(11), { camera: true });
    const newest = print(-1);
    const after = rollRows([newest, ...prints(11)], { camera: true });
    // The rows keep their names, and the wells' rows have the same names, so nothing is made afresh when the roll arrives.
    expect(after.slice(0, before.length).map((r) => r.key)).toEqual(before.map((r) => r.key));
    expect(wellRows({ camera: true }).map((r) => r.key)).toEqual(["row-0", "row-1", "row-2"]);
    // In each row, every cell but one is a photograph the row already had.
    before.forEach((row, i) => {
      const had = new Set(row.items.map((it) => it.key));
      const kept = after[i].items.filter((it) => had.has(it.key));
      expect(kept.length).toBeGreaterThanOrEqual(row.items.length - 1);
    });
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

  it("keeps a photograph that shares the cut's own millisecond but fell outside the page", () => {
    const at = print(4).takenAt;
    const twin = print(40, { takenAt: at });
    const before = [...prints(5), twin, print(5), print(6)];
    const page = { prints: [print(0), print(1), print(2), print(3), print(4)], hasNextPage: true };
    expect(mergeNewest(before, page).map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3", "p4", "p40", "p5", "p6"]);
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

  it("counts three hours in the background as three hours away", () => {
    // The tab notes when the app went to the background, and asks with that time on its return.
    expect(keepSelection({ id: "p3", at: now - 3 * 3_600_000 }, list, now)).toBe("p0");
  });

  it("goes to a photograph newer than the newest shown as it arrives: one just taken, or just shared", () => {
    expect(newerArrived(print(0), print(-1))).toBe(true);
    expect(newerArrived(print(0), print(0))).toBe(false);
    expect(newerArrived(print(0), print(1))).toBe(false);
    // A first read has nothing before it to be newer than: the newest is selected by the usual rule.
    expect(newerArrived(undefined, print(0))).toBe(false);
    expect(newerArrived(print(0), undefined)).toBe(false);
  });

  it("moves on from a photograph once it has been posted, to the newest not yet posted", () => {
    const posted = new Map<string, number>([
      ["p0", now + 10],
      ["p2", now + 20],
    ]);
    const at = (id: string) => posted.get(id) ?? null;
    // p2 was selected, then posted: the newest not yet posted is p1.
    expect(afterPosting({ id: "p2", at: now }, list, at)).toBe("p1");
    // Not posted since it was selected: the selection stays (undefined is "no change").
    expect(afterPosting({ id: "p3", at: now }, list, at)).toBeUndefined();
    expect(afterPosting({ id: "p2", at: now + 30 }, list, at)).toBeUndefined();
    expect(afterPosting(null, list, at)).toBeUndefined();
    // Everything posted: the newest.
    expect(afterPosting({ id: "p0", at: now }, list, () => now + 1)).toBe("p0");
  });
});

describe("what stays drawn while the tab rests", () => {
  // 390 points: the header (doors, mount, ways) about 490 tall, the list 683, a row 96 + 2.
  const row = cellSize(390) + GAP;

  it("is the rows on the screen, one either side", () => {
    // At the top: rows 0 and 1 show under the header; row 2 is the one to spare.
    expect(rowsInSight({ offset: 0, header: 490, viewport: 683, row })).toEqual({ first: 0, last: 2 });
    // Scrolled into the roll: from one row above the first in view to one below the last.
    const deep = rowsInSight({ offset: 490 + 10 * row + 40, header: 490, viewport: 683, row });
    expect(deep.first).toBe(9);
    expect(deep.last).toBe(10 + Math.ceil((40 + 683) / row) - 1 + 1);
  });

  it("keeps everything while the list has not been measured", () => {
    expect(rowsInSight({ offset: 0, header: 490, viewport: 0, row })).toEqual({ first: 0, last: Number.POSITIVE_INFINITY });
  });
});

describe("the words VoiceOver hears for the photograph", () => {
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
