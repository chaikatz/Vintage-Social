import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  captionHeight,
  GLIDE_GAP,
  GLIDE_HEIGHT,
  GLIDE_INSET,
  groupTop,
  plateBox,
  plateFrame,
  captionWidth,
  signatureGap,
  stageFrame,
  underPlate,
} from "@/components/darkroom/geometry";
import { GLIDE, GLIDE_IDLE, glideReducer, measuredCaption, sheetShows, stripFollow, type GlideEvent, type GlideState } from "@/components/darkroom/glide";
import { DISSOLVE, glideRequest } from "@/components/darkroom/plateImage";
import { edgeMarks, groupStarts, MARK_SPACING, STRIP, stripIndex } from "@/components/darkroom/replay";
import { edgeMarkWords } from "@/components/darkroom/words";
import { anniversaryYear } from "@/darkroom/labels";
import type { DarkroomMode, Print } from "@/darkroom/types";

/**
 * The glide strip in the Memory Room: under the caption on every page of
 * every chapter, and the one way to play a chapter through. The rules
 * that need no screen — which frame is under the box, where a chapter's
 * groups begin and what is printed along the strip's edge, how the strip
 * follows the pages, the preview's states while a finger glides, how the
 * sharp preview is asked for, and where everything stands on the page —
 * and the room's source, held to what it must never do. The room itself
 * is walked in the browser (`e2e/darkroom-test.mjs`).
 */

const root = path.resolve(import.meta.dirname, "..");
function read(file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}
/** Without its comments, so prose that names what is not done is not taken as doing it. */
function code(file: string): string {
  return (
    read(file)
      // A JSX comment, whole: never from one comment's opening to a later one's close, across the code between.
      .replace(/\{\s*\/\*(?:(?!\*\/)[\s\S])*\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
  );
}
const dir = "src/components/darkroom";
const stripFiles = [`${dir}/glide.ts`, `${dir}/replay.ts`, `${dir}/ReplayStrip.tsx`, `${dir}/GlideStrip.tsx`, `${dir}/GlideSheet.tsx`];
/** Where a JSX element opens (not a type argument such as `useRef<StageHandle>`). */
const opens = (src: string, name: string) => src.search(new RegExp(`<${name}\\s`));
/** From the opening of a JSX element to the close of its tag. */
const element = (src: string, name: string) => {
  const i = opens(src, name);
  return i < 0 ? "" : src.slice(i, src.indexOf("/>", i) + 2);
};

const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0) => new Date(y, m, d, h, min, s).getTime();
/** 4 December 2026, noon. */
const NOW = at(2026, 11, 4);

let seq = 0;
function print(takenAt: number, width = 3000, height = 4000): Print {
  seq += 1;
  return { id: `p${seq}`, uri: `ph://p${seq}`, width, height, takenAt, subtypes: [] };
}

// ---------------------------------------------------------------------------

describe("the strip's frames", () => {
  it("reads the frame under the box over the prints and the blank frame after them, rounded and clamped", () => {
    expect(STRIP.pitch).toBe(STRIP.cellW + STRIP.gap);
    // Six prints and the blank frame: seven frames, 0 to 6.
    expect(stripIndex(0, 7)).toBe(0);
    expect(stripIndex(17.9, 7)).toBe(0);
    expect(stripIndex(18, 7)).toBe(1);
    expect(stripIndex(72, 7)).toBe(2);
    expect(stripIndex(6 * STRIP.pitch, 7)).toBe(6);
    expect(stripIndex(5000, 7)).toBe(6);
    expect(stripIndex(-80, 7)).toBe(0);
    expect(stripIndex(Number.NaN, 7)).toBe(0);
    expect(stripIndex(100, 0)).toBe(0);
  });
});

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
    expect(groupStarts(ps, "on-this-day")).toEqual([0, 2, 5]);
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
    expect(groupStarts(ps, "on-this-day")).toEqual([0, 3]);
    expect(anniversaryYear(ps[0].takenAt, jan2)).toBe(2020);
    expect([...edgeMarks(ps, "on-this-day", jan2).entries()]).toEqual([
      [0, "2020"],
      [3, "2018"],
    ]);
  });

  it("groups a stretch by its days, which run to four in the morning", () => {
    const ps = [print(at(2022, 11, 3, 22)), print(at(2022, 11, 4, 2, 30)), print(at(2022, 11, 4, 11)), print(at(2022, 11, 4, 12)), print(at(2022, 11, 4, 13))];
    expect(groupStarts(ps, "span")).toEqual([0, 2]);
  });

  it("groups a year by its months, and Surprise me and the shelf as one", () => {
    const ps = [
      print(at(2016, 0, 3)),
      print(at(2016, 0, 30)),
      print(at(2016, 2, 1)),
      print(at(2016, 2, 9)),
      print(at(2016, 2, 20)),
      print(at(2016, 6, 4)),
      print(at(2016, 11, 25)),
    ];
    expect(groupStarts(ps, "year")).toEqual([0, 2, 5, 6]);
    // The same month of another year is another group.
    expect(groupStarts([print(at(2016, 4, 1)), print(at(2017, 4, 1))], "year")).toEqual([0, 1]);
    const anyOrder = [print(at(2016, 7, 1)), print(at(2012, 1, 1)), print(at(2019, 3, 3)), print(at(2019, 3, 2))];
    expect(groupStarts(anyOrder, "surprise")).toEqual([0]);
    expect(groupStarts(anyOrder, "set-aside")).toEqual([0]);
    expect(groupStarts([], "on-this-day")).toEqual([]);
  });
});

describe("the strip’s edge marks", () => {
  it("prints the year over the first frame of each, at least three frames apart", () => {
    const years = [2025, 2024, 2023, 2023, 2023, 2022, 2021, 2021, 2021, 2021, 2019];
    const ps = years.map((y, i) => print(at(y, 11, 4, 8 + i)));
    expect(groupStarts(ps, "on-this-day")).toEqual([0, 1, 2, 5, 6, 10]);
    const marks = edgeMarks(ps, "on-this-day", NOW);
    expect([...marks.entries()]).toEqual([
      [0, "2025"],
      [5, "2022"],
      [10, "2019"],
    ]);
    const kept = [...marks.keys()];
    expect(MARK_SPACING).toBe(3);
    for (let k = 1; k < kept.length; k++) expect(kept[k] - kept[k - 1]).toBeGreaterThanOrEqual(MARK_SPACING);
  });

  it("prints the day only in a stretch of two days or more", () => {
    const ps = [print(at(2022, 11, 3, 9)), print(at(2022, 11, 3, 10)), print(at(2022, 11, 3, 11)), print(at(2022, 11, 4, 9)), print(at(2022, 11, 4, 10))];
    expect([...edgeMarks(ps, "span", NOW).entries()]).toEqual([
      [0, "DEC 3"],
      [3, "DEC 4"],
    ]);
    expect(edgeMarks(ps.slice(0, 3), "span", NOW).size).toBe(0);
  });

  it("prints the month in a year, three letters, where each begins", () => {
    const ps = [
      print(at(2016, 0, 3)),
      print(at(2016, 0, 9)),
      print(at(2016, 0, 30)),
      print(at(2016, 2, 1)),
      print(at(2016, 2, 9)),
      print(at(2016, 2, 20)),
      print(at(2016, 4, 2)),
      print(at(2016, 5, 2)),
    ];
    expect([...edgeMarks(ps, "year", NOW).entries()]).toEqual([
      [0, "JAN"],
      [3, "MAR"],
      [6, "MAY"],
    ]);
    expect(edgeMarkWords("year", at(2016, 2, 9), NOW)).toBe("MAR");
    for (const words of edgeMarks(ps, "year", NOW).values()) expect(words).toMatch(/^[A-Z]{3}$/);
  });

  it("prints nothing in Surprise me, on the shelf or in a one-day stretch", () => {
    const ps = [print(at(2016, 7, 1)), print(at(2012, 1, 1)), print(at(2019, 3, 3)), print(at(2009, 3, 3)), print(at(2001, 3, 3))];
    expect(edgeMarks(ps, "surprise", NOW).size).toBe(0);
    expect(edgeMarks(ps, "set-aside", NOW).size).toBe(0);
    expect(edgeMarkWords("surprise", ps[0].takenAt, NOW)).toBeNull();
    expect(edgeMarkWords("set-aside", ps[0].takenAt, NOW)).toBeNull();
    const t = at(2022, 11, 4, 10);
    expect(edgeMarks([print(t), print(t + 60_000), print(t + 120_000), print(t + 180_000)], "span", NOW).size).toBe(0);
  });

  it("are dates, never frame numbers: a number is only ever a year", () => {
    const day = Array.from({ length: 30 }, (_, i) => print(at(2025 - i, 11, 4)));
    for (const words of edgeMarks(day, "on-this-day", NOW).values()) expect(words).toMatch(/^\d{4}$/);
    const stretch = Array.from({ length: 30 }, (_, i) => print(at(2022, 10, 1 + i, 10)));
    for (const words of edgeMarks(stretch, "span", NOW).values()) expect(words).toMatch(/^[A-Z]{3} \d{1,2}$/);
    const year = Array.from({ length: 36 }, (_, i) => print(at(2016, Math.floor(i / 3), 1 + (i % 3))));
    for (const words of edgeMarks(year, "year", NOW).values()) expect(words).not.toMatch(/\d/);
  });
});

// ---------------------------------------------------------------------------

describe("the strip following the pages", () => {
  const phone = { reduceMotion: false, web: false };

  it("glides a frame on by UIKit's own ease", () => {
    expect(stripFollow({ target: 2, rebase: 0 }, { index: 3, count: 7, rebase: 0 }, phone)).toEqual({ to: 3, animated: true });
    expect(stripFollow({ target: 3, rebase: 0 }, { index: 2, count: 7, rebase: 0 }, phone)).toEqual({ to: 2, animated: true });
    expect(stripFollow({ target: 0, rebase: 0 }, { index: GLIDE.far, count: 40, rebase: 0 }, phone)).toEqual({ to: GLIDE.far, animated: true });
  });

  it("cuts under Reduce Motion, in the browser, after prints were taken out behind, for a jump past eight, and the first time", () => {
    const from = { target: 2, rebase: 0 };
    expect(stripFollow(from, { index: 3, count: 7, rebase: 0 }, { reduceMotion: true, web: false })).toEqual({ to: 3, animated: false });
    expect(stripFollow(from, { index: 3, count: 7, rebase: 0 }, { reduceMotion: false, web: true })).toEqual({ to: 3, animated: false });
    expect(stripFollow(from, { index: 2, count: 7, rebase: 1 }, phone)).toEqual({ to: 2, animated: false });
    expect(stripFollow({ target: 0, rebase: 0 }, { index: GLIDE.far + 1, count: 40, rebase: 0 }, phone)).toEqual({ to: GLIDE.far + 1, animated: false });
    expect(GLIDE.far).toBe(8);
    expect(stripFollow(null, { index: 4, count: 7, rebase: 0 }, phone)).toEqual({ to: 4, animated: false });
  });

  it("moves nothing when nothing changed, and a batch dealt on at the end moves nothing", () => {
    expect(stripFollow({ target: 3, rebase: 0 }, { index: 3, count: 7, rebase: 0 }, phone)).toBeNull();
    // On the blank frame of a roll still being dealt: the batch lands, the page in front is still the same.
    expect(stripFollow({ target: 3, rebase: 0 }, { index: 3, count: 7, rebase: 0 }, phone)).toBeNull();
    expect(stripFollow({ target: 3, rebase: 0 }, { index: 3, count: 10, rebase: 0 }, phone)).toBeNull();
    // Never past the blank frame.
    expect(stripFollow({ target: 3, rebase: 0 }, { index: 12, count: 7, rebase: 0 }, phone)).toEqual({ to: 6, animated: true });
  });
});

// ---------------------------------------------------------------------------

const run = (s: GlideState, ...events: GlideEvent[]) => events.reduce(glideReducer, s);

describe("the preview while gliding", () => {
  it("shows nothing for a touch alone, and hides again back over the page it began on", () => {
    const touched = run(GLIDE_IDLE, { type: "start", origin: 3 });
    expect(touched).toEqual({ kind: "gliding", origin: 3, index: 3, sharp: false });
    expect(sheetShows(touched)).toBe(false);
    const away = run(touched, { type: "to", index: 5 });
    expect(away).toEqual({ kind: "gliding", origin: 3, index: 5, sharp: false });
    expect(sheetShows(away)).toBe(true);
    expect(sheetShows(run(away, { type: "to", index: 3 }))).toBe(false);
    expect(sheetShows(GLIDE_IDLE)).toBe(false);
    expect(sheetShows({ kind: "idle", fade: true })).toBe(false);
  });

  it("goes sharp only once rested on the same frame, and loses it on the next", () => {
    const away = run(GLIDE_IDLE, { type: "start", origin: 0 }, { type: "to", index: 2 });
    expect(run(away, { type: "rested", index: 1 })).toBe(away);
    const sharp = run(away, { type: "rested", index: 2 });
    expect(sharp).toMatchObject({ index: 2, sharp: true });
    expect(run(sharp, { type: "to", index: 2 })).toBe(sharp);
    expect(run(sharp, { type: "to", index: 3 })).toMatchObject({ index: 3, sharp: false });
    // Rested means nothing out of a glide.
    expect(run(GLIDE_IDLE, { type: "rested", index: 2 })).toBe(GLIDE_IDLE);
  });

  it("ends at once on the page it began on, or on the blank frame", () => {
    const back = run(GLIDE_IDLE, { type: "start", origin: 2 }, { type: "to", index: 4 }, { type: "to", index: 2 }, { type: "end", id: "x" });
    expect(back).toEqual({ kind: "idle", fade: false });
    const tail = run(GLIDE_IDLE, { type: "start", origin: 2 }, { type: "to", index: 6 }, { type: "end", id: null });
    expect(tail).toEqual({ kind: "idle", fade: false });
    // An end with no glide changes nothing.
    expect(run(GLIDE_IDLE, { type: "end", id: "x" })).toBe(GLIDE_IDLE);
  });

  it("lands on another print, and fades once that page's photograph has drawn, or a while has passed", () => {
    const landing = run(GLIDE_IDLE, { type: "start", origin: 1 }, { type: "to", index: 4 }, { type: "rested", index: 4 }, { type: "end", id: "p4" });
    expect(landing).toEqual({ kind: "landing", index: 4, id: "p4", sharp: true, arrived: false });
    expect(sheetShows(landing)).toBe(true);
    expect(run(landing, { type: "drawn", id: "p5" })).toBe(landing);
    expect(run(landing, { type: "drawn", id: "p4" })).toEqual({ kind: "idle", fade: true });
    expect(run(landing, { type: "timedOut" })).toEqual({ kind: "idle", fade: true });
    expect(run(GLIDE_IDLE, { type: "timedOut" })).toBe(GLIDE_IDLE);
    expect(run(GLIDE_IDLE, { type: "drawn", id: "p4" })).toBe(GLIDE_IDLE);
  });

  it("arrives as the room settles there; after that, a page turned elsewhere or dragged ends it at once", () => {
    const landing = run(GLIDE_IDLE, { type: "start", origin: 1 }, { type: "to", index: 4 }, { type: "end", id: "p4" });
    // The pager's own turn begins before it lands: not yet the member's.
    expect(run(landing, { type: "pagerMoved" })).toBe(landing);
    expect(run(landing, { type: "settled", index: 1 })).toBe(landing);
    const arrived = run(landing, { type: "settled", index: 4 });
    expect(arrived).toMatchObject({ kind: "landing", arrived: true });
    expect(run(arrived, { type: "settled", index: 4 })).toBe(arrived);
    expect(run(arrived, { type: "settled", index: 5 })).toEqual({ kind: "idle", fade: false });
    expect(run(arrived, { type: "pagerMoved" })).toEqual({ kind: "idle", fade: false });
    expect(run(arrived, { type: "drawn", id: "p4" })).toEqual({ kind: "idle", fade: true });
  });

  it("is taken over by a finger down again, from any state, and reset from any", () => {
    const landing = run(GLIDE_IDLE, { type: "start", origin: 1 }, { type: "to", index: 4 }, { type: "end", id: "p4" });
    expect(run(landing, { type: "start", origin: 4 })).toEqual({ kind: "gliding", origin: 4, index: 4, sharp: false });
    expect(run({ kind: "idle", fade: true }, { type: "start", origin: 0 })).toMatchObject({ kind: "gliding" });
    for (const s of [landing, run(GLIDE_IDLE, { type: "start", origin: 0 }, { type: "to", index: 1 }), { kind: "idle", fade: true } as GlideState]) {
      expect(run(s, { type: "reset" })).toEqual({ kind: "idle", fade: false });
    }
  });

  it("asks for the sharp preview kept by its view alone, at the plate's size, dissolving in, and cutting in under Reduce Motion", () => {
    expect(glideRequest(false)).toEqual({ cachePolicy: "none", priority: "normal", allowDownscaling: false, transition: DISSOLVE });
    expect(glideRequest(true).transition).toBe(0);
    expect(GLIDE).toEqual({ deferMs: 250, inMs: 150, revealMs: 60, sharpMs: 100, landMaxMs: 700, warmLandMs: 120, outMs: 120, far: 8, proof: 48 });
  });

  it("lays the preview out at the caption height its page settles on: the pages' own within a point, the measure otherwise", () => {
    expect(measuredCaption(40.4, 40)).toBe(40);
    expect(measuredCaption(39.2, 40)).toBe(40);
    // SET ASIDE gone to a line of its own under a narrow plate: the plate stands where the page will stand it.
    expect(measuredCaption(57.3, 40)).toBe(57);
    expect(measuredCaption(38.9, 40)).toBe(39);
    // The page's own rule, which this follows: kept within a point of what it was laid out at, the measure rounded otherwise.
    expect(code(`${dir}/PrintPage.tsx`)).toMatch(/if \(Math\.abs\(h - caption\) >= 1\) setMeasured\(Math\.round\(h\)\);/);
  });
});

// ---------------------------------------------------------------------------

describe("the page, with the strip on it", () => {
  it("sets the strip's slot to its marks' row and its box's, and a gap over DEVELOP", () => {
    expect(GLIDE_HEIGHT).toBe(STRIP.marks + 2 + STRIP.boxH);
    expect([GLIDE_GAP, GLIDE_INSET]).toEqual([8, 16]);
  });

  it("gives the photograph's area what is left on every phone", () => {
    expect(stageFrame(852, { top: 59, bottom: 34 })).toEqual({ top: 103, height: 583 });
    expect(stageFrame(667, { top: 20, bottom: 0 })).toEqual({ top: 64, height: 455 });
    expect(stageFrame(568, { top: 20, bottom: 0 })).toEqual({ top: 64, height: 356 });
    expect(stageFrame(956, { top: 62, bottom: 34 })).toEqual({ top: 106, height: 684 });
  });

  it("stands the preview exactly where the page stands its plate and caption", () => {
    for (const stage of [356, 455, 583]) {
      for (const ratio of [1 / 3, 9 / 16, 3 / 4, 1, 4 / 3, 3]) {
        for (const [width, pr] of [
          [320, 2],
          [375, 2],
          [393, 3],
        ] as const) {
          const caption = captionHeight(1, 1);
          const box = plateBox(ratio, width, stage, caption, pr);
          const captionW = captionWidth(box.width);
          expect(plateFrame(ratio, width, stage, caption, pr)).toEqual({
            box,
            top: groupTop(stage, box.height, underPlate(box.width, caption, pr)),
            left: (width - box.width) / 2,
            captionW,
            captionLeft: (width - captionW) / 2,
            gap: signatureGap(captionW, pr),
          });
        }
      }
    }
  });

  it("leaves a portrait plate on the smallest phone at least 190 wide", () => {
    expect(plateBox(3 / 4, 320, 356, captionHeight(1, 1), 2).width).toBeGreaterThanOrEqual(190);
  });

  it("draws the preview's soft proof at the plate's own proof width", () => {
    expect(read("src/components/darkroom/PrintPage.tsx")).toMatch(new RegExp(`const PROOF_WIDTH = ${GLIDE.proof};`));
  });
});

// ---------------------------------------------------------------------------

describe("the replay is gone", () => {
  it("leaves none of its files, and nothing that asks for them", () => {
    for (const f of ["Replay.tsx", "ReplayGate.tsx", "ReplayLeader.tsx", "useReplay.ts", "awake.ts", "PlayTab.tsx"]) {
      expect(existsSync(path.join(root, dir, f)), f).toBe(false);
    }
    expect(existsSync(path.join(root, "tests/darkroom-replay.test.ts"))).toBe(false);
    const all = (d: string): string[] =>
      readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? all(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : [],
      );
    for (const file of [...all("src"), ...all("app")]) {
      const src = read(file);
      expect(src, file).not.toMatch(/from "[^"]*\/(Replay|ReplayGate|ReplayLeader|useReplay|awake|PlayTab)"/);
      expect(src, file).not.toMatch(/expo-keep-awake/);
    }
  });

  it("leaves no word to play with", () => {
    const words = code(`${dir}/words.ts`);
    for (const gone of ["PLAY_THROUGH", "withPlayThrough", "replayWord", "PLAY_HINT", "REPLAY_BACK_HINT", "replayCard"]) expect(words).not.toContain(gone);
    expect(words).not.toMatch(/"Play\b|Play it through|"play"/);
  });

  it("leaves the room one way through a chapter: the strip", () => {
    const room = code("app/darkroom.tsx");
    expect(room).not.toMatch(/replay|Replay|PlayTab|roomFade/);
    expect(room).toMatch(/<Stack\.Screen options=\{\{ headerShown: false \}\} \/>/);
    expect(room).toMatch(/contents=\{inside\}/);
    expect(room).toMatch(/onBack=\{back\}/);
    // Nothing the replay added to the room's shared pieces is left behind.
    expect(code(`${dir}/Caption.tsx`)).not.toMatch(/export function Signature\b/);
    expect(room).toMatch(/onAccessibilityEscape=\{\(\) => \(sheet\.open \? sheet\.close\(\) : back\(\)\)\}/);
    expect(room).toMatch(/stageActions\(current\?\.takenAt \?\? null, aside, \{ words, stated: develop\.id != null, busy: develop\.busy \}\)/);
  });
});

describe("the strip, in the room's source", () => {
  const room = code("app/darkroom.tsx");

  it("is on the page once, under the stage and over DEVELOP, in a slot that is always there", () => {
    expect(room.match(/<GlideStrip\s/g)).toHaveLength(1);
    expect(room.match(/<GlideSheet\s/g)).toHaveLength(1);
    expect(element(room, "GlideStrip")).toMatch(/key=\{chapter\.generation\}/);
    expect(element(room, "GlideSheet")).toMatch(/key=\{chapter\.generation\}/);
    // The slot is rendered whatever the stage shows, so the stage keeps one height.
    const stageEnd = room.indexOf("<View style={styles.glideSlot}>");
    expect(stageEnd).toBeGreaterThan(room.indexOf('<View style={styles.stage} onLayout='));
    expect(room.slice(stageEnd - 40, stageEnd)).toMatch(/<\/View>\s*$/);
    expect(room.slice(stageEnd)).toMatch(/^<View style=\{styles\.glideSlot\}>\s*\{chapter && state\.view\.kind === "prints" \? \(\s*<GlideStrip/);
    expect(opens(room, "Develop")).toBeGreaterThan(stageEnd);
    expect(room).toMatch(/glideSlot: \{ height: GLIDE_HEIGHT, marginBottom: GLIDE_GAP \}/);
    // The sheet lies over the stage, under the title card.
    expect(opens(room, "GlideSheet")).toBeGreaterThan(opens(room, "Stage"));
    expect(opens(room, "GlideSheet")).toBeLessThan(room.indexOf("{fades.card ? ("));
  });

  it("shows each frame of a glide without drawing the room again, and deals on as it nears the end", () => {
    const body = room.slice(room.indexOf("const onGlideTo = useEvent("), room.indexOf("const onGlideEnd = useEvent("));
    expect(body).toMatch(/if \(!glidingNow\.current\) return;\s*glide\.current\?\.to\(i\);\s*darkroom\.dealAhead\(i\);\s*\}\);/);
    expect(body).not.toMatch(/set[A-Z]\w*\(/);
  });

  it("lands a glide as a page turn: one cut, settled by the room's own rules", () => {
    expect(room.match(/stage\.current\?\.goTo\(/g)).toHaveLength(4);
    const end = room.slice(room.indexOf("const onGlideEnd = useEvent("), room.indexOf("const onFrame = useEvent("));
    expect(end).toMatch(/if \(turns\) stage\.current\?\.goTo\(i\);/);
    expect(end).toMatch(/glide\.current\?\.end\(turns && p \? p\.id : null, p != null && darkroom\.hasLoaded\(p\.id\)\);/);
    const frame = room.slice(room.indexOf("const onFrame = useEvent("), room.indexOf("const onPlateLoad = useEvent("));
    expect(frame).toMatch(/if \(!chapter \|\| develop\.busy \|\| state\.loading \|\| i === chapter\.index\) return;\s*stage\.current\?\.goTo\(i\);/);
  });

  it("hands a landed glide over to the page once its photograph has drawn, and still counts the photograph", () => {
    expect(element(room, "PrintPage")).toMatch(/onLoad=\{onPlateLoad\}/);
    expect(room).toMatch(/const onPlateLoad = useEvent\(\(id: string\) => \{\s*imageLoaded\(id\);\s*glide\.current\?\.drawn\(id\);\s*\}\);/);
    expect(room.match(/onTap=/g)).toHaveLength(1);
  });

  it("holds the pager and DEVELOP while a finger glides, and never leaves the pager held", () => {
    expect(element(room, "Stage")).toMatch(/scrollEnabled=\{!develop\.busy && !state\.loading && !gliding\}/);
    expect(element(room, "Develop")).toMatch(/dragging=\{dragging \|\| gliding\}/);
    expect(element(room, "GlideStrip")).toMatch(/enabled=\{!develop\.busy && state\.loading == null && fades\.card == null && !dragging\}/);
    expect(room).toMatch(/useEffect\(\(\) => \{\s*endGlide\(\);[\s\S]*?\}, \[generation, state\.view\.kind, state\.loading != null\]\);/);
    expect(room).toMatch(/onBlur\.current = \(\) => \{\s*endGlide\(\);/);
    // The caption's presses wait for the glide to land.
    expect(room).toMatch(/const onDate = useEvent\(\(print: Print\) => \{\s*if \(glidingNow\.current \|\| develop\.id != null\) return;/);
    expect(room).toMatch(/const onRight = useEvent\(\(print: Print\) => \{\s*if \(glidingNow\.current\) return;/);
  });

  it("deals ahead from the frame glided to by the very rule that deals on near the end of the pages", () => {
    const hook = code("src/darkroom/useDarkroom.ts");
    expect(hook).toMatch(/const BATCH = \{ surprise: 3, year: 12 \} as const;/);
    expect(hook).toMatch(/const AHEAD = \{ surprise: 3, year: 4 \} as const;/);
    const ahead = hook.slice(hook.indexOf("const dealAhead = useCallback("), hook.indexOf("const readOn = useCallback("));
    expect(ahead).toMatch(
      /if \(!c \|\| !d \|\| !c\.more \|\| c\.failed \|\| d\.reading \|\| s\.view\.kind !== "prints" \|\| s\.loading\) return;\s*const kind = c\.mode === "surprise" \? "surprise" : "year";\s*if \(index >= c\.prints\.length - AHEAD\[kind\]\) void d\.read\(BATCH\[kind\]\);/,
    );
    // The deal-on near the end of the pages is as it was.
    expect(hook).toMatch(/if \(chapter\.index >= chapter\.prints\.length - AHEAD\[kind\]\) void d\.read\(BATCH\[kind\]\);\s*\}, \[chapter, state\.view\.kind, state\.years\]\);/);
    expect(hook).toMatch(/\s{4}dealAhead,\n/);
    expect(hook).not.toMatch(/releaseImages/);
  });
});

describe("the strip, in its own source", () => {
  it("comes a moment after the page, and moves only by following the pages", () => {
    const glide = code(`${dir}/GlideStrip.tsx`);
    expect(glide).toMatch(/export const GlideStrip = memo\(function GlideStrip\(/);
    expect(glide).toMatch(/import \{ ReplayStrip, type StripHandle \} from "\.\/ReplayStrip";/);
    expect(glide).toMatch(/setTimeout\(\(\) => \{[\s\S]*?setStart\(at\.index\);\s*\}, GLIDE\.deferMs\);/);
    expect(glide).toMatch(/const move = stripFollow\(/);
    expect(glide.match(/scrollTo\(/g)).toHaveLength(1);
    expect(glide).toMatch(/strip\.current\?\.scrollTo\(move\.to, move\.animated\);/);
    // Not while a finger glides it.
    expect(glide).toMatch(/if \(!mounted \|\| gliding\.current\) return;/);
    expect(glide).not.toMatch(/leader|Leader|haptics/i);
  });

  it("draws each frame as a contact sheet's, from Photos' own thumbnail, and the blank frame with no photograph", () => {
    const strip = code(`${dir}/ReplayStrip.tsx`);
    expect(strip.match(/<Image\b/g)).toHaveLength(1);
    expect(element(strip, "Image")).toMatch(/cachePolicy="none"/);
    expect(strip).not.toMatch(/prefetch/i);
    const tail = strip.slice(strip.indexOf("const TailCell = memo("), strip.indexOf("const FRAME_INSET"));
    expect(tail).not.toMatch(/<Image\b|\bmark\b/);
    expect(tail).toMatch(/backgroundColor: look\.room\.page/);
    expect(tail).toMatch(/testID="darkroom-glide-tail"/);
    // A batch dealt on mid-glide never makes the native scroll handler anew.
    expect(strip).toMatch(/useMemo\(\s*\(\) =>\s*Animated\.event\([\s\S]*?\),\s*\[scrollX\],\s*\);/);
    expect(strip).toMatch(/count\.current = prints\.length \+ 1;/);
    expect(strip).toMatch(/on\.current\.onScrubEnd\(stripIndex\(glidedTo\.current, count\.current\)\);/);
    // Hidden from VoiceOver, its frames a contact sheet's.
    expect(strip).toMatch(/accessibilityElementsHidden\s*importantForAccessibility="no-hide-descendants"\s*testID="darkroom-glide-strip-row"/);
    expect(strip).toMatch(/windowSize=\{3\}\s*removeClippedSubviews/);
    expect(strip).toMatch(/snapToInterval=\{STRIP\.pitch\}\s*decelerationRate="normal"/);
  });

  it("previews with one proof and one sharp photograph at most, each kept by its view alone, and never fetches", () => {
    const sheet = code(`${dir}/GlideSheet.tsx`);
    const images = [...sheet.matchAll(/<Image\b[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(images).toHaveLength(2);
    expect(images[0]).toMatch(/cachePolicy="none"/);
    expect(images[1]).toMatch(/cachePolicy=\{request\.cachePolicy\}/);
    expect(images[1]).toMatch(/onProgress=\{\(\) => onRefuse\(id\)\}/);
    expect(images[1]).toMatch(/onError=\{\(\) => onRefuse\(id\)\}/);
    expect(sheet).toMatch(/const \[request\] = useState\(\(\) => glideRequest\(look\.reduceMotion\)\);/);
    expect(sheet).toMatch(/<Sharp key=\{print\.id\}/);
    expect(sheet).not.toMatch(/"(memory|disk|memory-disk)"|prefetch/i);
    expect(sheet).toMatch(/useReducer\(glideReducer, GLIDE_IDLE\)/);
    expect(sheet).toMatch(/pointerEvents="none"\s*accessibilityElementsHidden\s*importantForAccessibility="no-hide-descendants"\s*testID="darkroom-glide-sheet"/);
  });

  it("never opens on an empty well: drawn unseen from the touch, and over the page once its proof has drawn, or a moment has passed", () => {
    const sheet = code(`${dir}/GlideSheet.tsx`);
    const images = [...sheet.matchAll(/<Image\b[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(images[0]).toMatch(/onLoad=\{\(\) => onProof\(id\)\}/);
    expect(sheet).toMatch(/const up = wants && \(raised \|\| \(state\.kind === "gliding" && ready\)\);/);
    expect(sheet).toMatch(/setTimeout\(\(\) => setRaised\(true\), GLIDE\.revealMs\)/);
    expect(sheet).toMatch(/<View style=\{\[StyleSheet\.absoluteFill, !up && styles\.unseen\]\} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">/);
    // One preview, its proof kept across the glide's returns to the page in front and to the blank frame.
    expect(sheet.match(/<Preview\b/g)).toHaveLength(1);
    expect(sheet).not.toMatch(/<Preview[^>]*\bkey=/);
    expect(sheet).toMatch(/<View style=\{\[StyleSheet\.absoluteFill, tail && styles\.unseen\]\}>\s*<Preview/);
  });

  it("stands the preview where its page will: the caption with its own word, never pressed, laid out at its measured height", () => {
    const sheet = code(`${dir}/GlideSheet.tsx`);
    const caption = element(sheet, "Caption");
    expect(caption).toMatch(/word=\{words\.word \? \{ label: words\.word\.label, on: words\.word\.on, inert: true \} : null\}/);
    expect(caption).toMatch(/onHeight=\{\(h\) => onMeasured\(h, caption, known\)\}/);
    expect(sheet).toMatch(/const caption = measured \?\? known;\s*const f = plateFrame\(ratio, width, stageHeight, caption, pixelRatio\);/);
    expect(sheet).toMatch(/const next = measuredCaption\(h, known\);/);
    const room = code("app/darkroom.tsx");
    expect(room.slice(room.indexOf("const glideWords = useEvent("))).toMatch(/word: said\.word \? \{ label: said\.word\.label, on: said\.word\.on \} : null,/);
  });

  it("hands a sharp preview over to a plate dissolving in only once its dissolve is over", () => {
    const sheet = code(`${dir}/GlideSheet.tsx`);
    expect(sheet).toMatch(/if \(id === landed\.current\) dissolving\.current = !warm\.current && sharpOf\.current === id;/);
    expect(sheet).toMatch(/const delay = dissolving\.current \? proofHoldMs\(photographRequest\(true, look\.reduceMotion\)\) : 0;/);
    expect(sheet).toMatch(/Animated\.timing\(opacity, \{ toValue: 0, duration: GLIDE\.outMs, delay,/);
    const images = [...sheet.matchAll(/<Image\b[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(images[1]).toMatch(/onLoad=\{\(\) => onSharp\(id, true\)\}/);
  });

  it("hands on each frame once, and lands a glide whose momentum is heard late where UIKit will bring it to rest", () => {
    const strip = code(`${dir}/ReplayStrip.tsx`);
    expect(strip.match(/on\.current\.onScrubTo\(/g)).toHaveLength(1);
    expect(strip).toMatch(/const i = stripIndex\(x, count\.current\);\s*if \(i === handed\.current\) return;\s*handed\.current = i;\s*on\.current\.onScrubTo\(i\);/);
    expect(strip).toMatch(/const target = e\?\.nativeEvent\?\.targetContentOffset\?\.x;/);
    expect(strip).toMatch(/endTimer\.current = setTimeout\(\(\) => \{\s*if \(driving\.current && restingAt\.current != null\) glidedTo\.current = restingAt\.current;\s*end\(\);\s*\}, END_DRAG_MS\);/);
    expect(strip).toMatch(/const END_DRAG_MS = 80;/);
  });

  it("keeps every photograph by its view alone: never the shared memory cache, never the disk", () => {
    let images = 0;
    for (const file of [`${dir}/ReplayStrip.tsx`, `${dir}/GlideStrip.tsx`, `${dir}/GlideSheet.tsx`]) {
      const src = code(file);
      for (const m of src.matchAll(/<Image\b[\s\S]*?\/>/g)) {
        images += 1;
        expect(m[0], file).toMatch(/cachePolicy="none"|cachePolicy=\{request\.cachePolicy\}/);
      }
      expect(src, file).not.toMatch(/"(memory|disk|memory-disk)"/);
      expect(src, file).not.toMatch(/prefetch/i);
    }
    // The strip's frame, the preview's proof and its sharp photograph.
    expect(images).toBe(3);
  });

  it("asks the library nothing: no reader, no source, no history, no dealer, no page or count", () => {
    // useDarkroom too: it holds the room's readers, so importing anything from it would bring them all in with it.
    const forbidden =
      /^(@\/darkroom\/(source|discovery|nativeSource|nativeLibrary|demoSource|develop|localFile|access|eligibility|useDarkroom|history)|\.\/(visit|dealer|chapter))$/;
    for (const file of stripFiles) {
      const src = code(file);
      const from = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const spec of from) expect(forbidden.test(spec), `${file} imports ${spec}`).toBe(false);
      expect(src, file).not.toMatch(/\.(page|count|oldest)\(/);
      if (file !== `${dir}/replay.ts`) expect(src, file).not.toMatch(/@\/darkroom\/occasions/);
    }
    // The one thing taken from the occasions: how a day is counted.
    expect(code(`${dir}/replay.ts`)).toMatch(/^import \{ occasionDay \} from "@\/darkroom\/occasions";$/m);
    // glide.ts is pure: no imports at all.
    expect(code(`${dir}/glide.ts`)).not.toMatch(/\bimport\b/);
  });

  it("is never felt", () => {
    const haptics = code(`${dir}/haptics.ts`);
    expect([...haptics.matchAll(/^ {2}(\w+): \(\) => quietly\(/gm)].map((m) => m[1])).toEqual(["develop", "setAside", "putBack", "chosen"]);
    for (const file of stripFiles) expect(code(file), file).not.toMatch(/haptics|expo-haptics/);
  });
});

/** Every chapter the room has, so a mode added later is not left without a rule for its marks. */
const MODES: DarkroomMode[] = ["on-this-day", "surprise", "year", "set-aside", "span"];
describe("every chapter", () => {
  it("has a rule for its marks", () => {
    const ps = [print(at(2016, 0, 3)), print(at(2015, 5, 3)), print(at(2014, 2, 3)), print(at(2013, 2, 3))];
    for (const mode of MODES) expect(() => edgeMarks(ps, mode, NOW), mode).not.toThrow();
  });
});
