import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Print } from "@/darkroom/types";
import { dropOnSettle } from "@/components/darkroom/chapter";
import { tapStep, tapTurn, type TapContext, type TapHeld, type TapPager } from "@/components/darkroom/turn";

/**
 * Turning the room's pages with a tap: which way a tap on the photograph
 * turns (`tapTurn`), and all the stage does with it (`tapStep`) — held
 * back while the print is zoomed in, while a develop state is showing,
 * while the pager cannot be swiped, while a turn is under way and under
 * VoiceOver, and a cut under Reduce Motion; each turn the stage makes
 * itself settled once, played through a model of the list and the room;
 * and, read from the source, the lines that make the pager's own scroll
 * do it, and that keep the room's words on the page, now that a tap no
 * longer hides them. The room itself is walked in the browser
 * (`e2e/darkroom-test.mjs`).
 */

const root = path.resolve(import.meta.dirname, "..");

/** The source without its comments, so prose that names what is not done is not taken as doing it. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** A phone 393 wide, on the third of seven prints and the end page. */
const W = 393;
const at = (over: Partial<TapContext> = {}): TapContext => ({
  index: 2,
  count: 8,
  zoomed: false,
  locked: false,
  turning: false,
  screenReader: false,
  ...over,
});

describe("a tap on the photograph", () => {
  it("turns on from the right half and back from the left", () => {
    expect(tapTurn(W * 0.75, W, at())).toBe(1);
    expect(tapTurn(W * 0.25, W, at())).toBe(-1);
    expect(tapTurn(W - 1, W, at())).toBe(1);
    expect(tapTurn(1, W, at())).toBe(-1);
  });

  it("counts the very middle as the right half, and the page's edges as the page", () => {
    expect(tapTurn(W / 2, W, at())).toBe(1);
    expect(tapTurn(W / 2 - 0.01, W, at())).toBe(-1);
    expect(tapTurn(0, W, at())).toBe(-1);
    expect(tapTurn(W, W, at())).toBe(1);
  });

  it("goes nowhere before the first page or past the last", () => {
    expect(tapTurn(W * 0.25, W, at({ index: 0 }))).toBe(0);
    expect(tapTurn(W * 0.75, W, at({ index: 0 }))).toBe(1);
    // The last print turns on to the page after it, as a swipe does…
    expect(tapTurn(W * 0.75, W, at({ index: 6 }))).toBe(1);
    // …and that page is the last there is.
    expect(tapTurn(W * 0.75, W, at({ index: 7 }))).toBe(0);
    expect(tapTurn(W * 0.25, W, at({ index: 7 }))).toBe(-1);
    // One print and its end page; and a pager with nothing in it.
    expect(tapTurn(W * 0.25, W, at({ index: 0, count: 2 }))).toBe(0);
    expect(tapTurn(W * 0.75, W, at({ index: 0, count: 1 }))).toBe(0);
    expect(tapTurn(W * 0.75, W, at({ index: 0, count: 0 }))).toBe(0);
  });

  it("turns nothing while the photograph is zoomed in", () => {
    expect(tapTurn(W * 0.75, W, at({ zoomed: true }))).toBe(0);
    expect(tapTurn(W * 0.25, W, at({ zoomed: true }))).toBe(0);
  });

  it("turns nothing while a develop state is showing, or the stage is held", () => {
    expect(tapTurn(W * 0.75, W, at({ locked: true }))).toBe(0);
    expect(tapTurn(W * 0.25, W, at({ locked: true }))).toBe(0);
  });

  it("turns nothing while VoiceOver is running, whose double-tap lands in the middle of the stage", () => {
    expect(tapTurn(W / 2, W, at({ screenReader: true }))).toBe(0);
    expect(tapTurn(W * 0.9, W, at({ screenReader: true }))).toBe(0);
    expect(tapTurn(W * 0.1, W, at({ screenReader: true }))).toBe(0);
  });

  it("turns nothing while a turn is under way, so quick taps turn one page", () => {
    expect(tapTurn(W * 0.75, W, at({ turning: true }))).toBe(0);
    expect(tapTurn(W * 0.25, W, at({ turning: true }))).toBe(0);
    // Three taps in quick succession, as the stage hears them: the first
    // starts a turn, which holds the rest until the pager settles.
    const pager = { settled: 2, turning: false };
    const turned: number[] = [];
    const tap = (x: number) => {
      const step = tapTurn(x, W, at({ index: pager.settled, turning: pager.turning }));
      if (step === 0) return;
      pager.turning = true;
      turned.push(pager.settled + step);
    };
    tap(W * 0.8);
    tap(W * 0.8);
    tap(W * 0.2);
    expect(turned).toEqual([3]);
    // Settled on the page it went to, the next tap is counted from there.
    pager.settled = 3;
    pager.turning = false;
    tap(W * 0.8);
    expect(turned).toEqual([3, 4]);
  });

  it("turns nothing for a press with no place on the page, or a page with no width", () => {
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number, -1, W + 1]) {
      expect(tapTurn(x, W, at()), String(x)).toBe(0);
    }
    expect(tapTurn(10, 0, at())).toBe(0);
    expect(tapTurn(10, Number.NaN, at())).toBe(0);
  });

  it("only ever answers a step of one page", () => {
    for (let index = 0; index < 8; index++) {
      for (const x of [0, 50, W / 2, 300, W]) {
        const step = tapTurn(x, W, at({ index }));
        expect([-1, 0, 1]).toContain(step);
        expect(index + step).toBeGreaterThanOrEqual(0);
        expect(index + step).toBeLessThan(8);
      }
    }
  });
});

/** The room holding nothing back, and the pager still on the third of seven prints and the end page. */
const held = (over: Partial<TapHeld> = {}): TapHeld => ({
  locked: false,
  scrollEnabled: true,
  screenReader: false,
  reduceMotion: false,
  ...over,
});
const pager = (over: Partial<TapPager> = {}): TapPager => ({ index: 2, count: 8, turning: false, ...over });

describe("what the stage does with a tap", () => {
  it("turns on a page or back one from the settled page, with the slide a swipe ends in", () => {
    expect(tapStep(held(), pager(), W * 0.75, W, false)).toEqual({ to: 3, cut: false });
    expect(tapStep(held(), pager(), W * 0.25, W, false)).toEqual({ to: 1, cut: false });
    expect(tapStep(held(), pager({ index: 6 }), W * 0.75, W, false)).toEqual({ to: 7, cut: false });
    expect(tapStep(held(), pager({ index: 7 }), W * 0.25, W, false)).toEqual({ to: 6, cut: false });
  });

  it("is a cut under Reduce Motion, to the same page, and held back by the same things", () => {
    expect(tapStep(held({ reduceMotion: true }), pager(), W * 0.75, W, false)).toEqual({ to: 3, cut: true });
    expect(tapStep(held({ reduceMotion: true }), pager(), W * 0.25, W, false)).toEqual({ to: 1, cut: true });
    expect(tapStep(held({ reduceMotion: true, locked: true }), pager(), W * 0.75, W, false)).toBeNull();
    expect(tapStep(held({ reduceMotion: true }), pager({ turning: true }), W * 0.75, W, false)).toBeNull();
    expect(tapStep(held({ reduceMotion: true }), pager(), W * 0.75, W, true)).toBeNull();
  });

  it("turns nothing while a develop state is showing, or the room holds the stage", () => {
    expect(tapStep(held({ locked: true }), pager(), W * 0.75, W, false)).toBeNull();
    expect(tapStep(held({ locked: true }), pager(), W * 0.25, W, false)).toBeNull();
  });

  it("turns nothing while the pager cannot be swiped: a develop under way, a chapter loading", () => {
    expect(tapStep(held({ scrollEnabled: false }), pager(), W * 0.75, W, false)).toBeNull();
    expect(tapStep(held({ scrollEnabled: false }), pager(), W * 0.25, W, false)).toBeNull();
  });

  it("turns nothing while a turn is under way, so quick taps turn one page", () => {
    expect(tapStep(held(), pager({ turning: true }), W * 0.75, W, false)).toBeNull();
    expect(tapStep(held(), pager({ turning: true }), W * 0.25, W, false)).toBeNull();
  });

  it("turns nothing while the photograph is zoomed in", () => {
    expect(tapStep(held(), pager(), W * 0.75, W, true)).toBeNull();
    expect(tapStep(held(), pager(), W * 0.25, W, true)).toBeNull();
  });

  it("turns nothing under VoiceOver, whose double-tap lands in the middle of the stage", () => {
    expect(tapStep(held({ screenReader: true }), pager(), W / 2, W, false)).toBeNull();
    expect(tapStep(held({ screenReader: true }), pager(), W * 0.9, W, false)).toBeNull();
    expect(tapStep(held({ screenReader: true }), pager(), W * 0.1, W, false)).toBeNull();
  });

  it("turns nothing before the first page, past the last, or for a press with no place on the page", () => {
    expect(tapStep(held(), pager({ index: 0 }), W * 0.25, W, false)).toBeNull();
    expect(tapStep(held(), pager({ index: 7 }), W * 0.75, W, false)).toBeNull();
    expect(tapStep(held(), pager(), Number.NaN, W, false)).toBeNull();
    expect(tapStep(held(), pager(), W * 0.75, 0, false)).toBeNull();
  });

  it("is held back by each of these alone, whichever half is tapped", () => {
    const holds: [string, TapHeld, TapPager, boolean][] = [
      ["a develop state", held({ locked: true }), pager(), false],
      ["a pager that cannot be swiped", held({ scrollEnabled: false }), pager(), false],
      ["VoiceOver", held({ screenReader: true }), pager(), false],
      ["a turn under way", held(), pager({ turning: true }), false],
      ["zoomed in", held(), pager(), true],
    ];
    for (const [why, h, p, zoomed] of holds) {
      for (const x of [W * 0.1, W / 2, W * 0.9]) expect(tapStep(h, p, x, W, zoomed), `${why} at ${x}`).toBeNull();
    }
  });
});

/**
 * The stage and the room as the phone runs them, with no screen. The list
 * is Fabric's scroll view: a scroll it makes itself, with the slide or by
 * a cut, is told where it came to rest (`onMomentumScrollEnd`) once the JS
 * in hand has run; a scroll onto the offset it is already at is not told
 * at all. The room settles as `useDarkroom.settle` does, with the real
 * `dropOnSettle`: a print gone from Photos is taken out as the member
 * turns past it, and the list is put back on the same page (`rebase`).
 * The stage is `Stage`'s turn, step for step, held to it by the guards
 * further down; `atOnce` settles a cut there and then as well, as the
 * stage once did. `lose` keeps what the list tells until `late()`.
 */
function memoryRoom(ids: string[], o: { missing?: string[]; more?: boolean; reduceMotion?: boolean; atOnce?: boolean } = {}) {
  const missing = new Set(o.missing ?? []);
  const chapter = {
    prints: ids.map((id): Print => ({ id, uri: `ph://${id}`, width: 3000, height: 4000, takenAt: 0, subtypes: [] })),
    index: 0,
    rebase: 0,
  };
  const shown: string[] = [];
  let finished = false;
  const list = { at: 0, told: [] as number[], lose: false, lost: [] as number[] };
  const stage = { settledAt: 0, turning: false, held: null as (() => void) | null };
  const pages = () => chapter.prints.length + 1;

  const scrollTo = (i: number) => {
    if (i === list.at) return;
    list.at = i;
    (list.lose ? list.lost : list.told).push(i);
  };
  // useDarkroom.settle
  const settle = (index: number) => {
    const target = Math.max(0, Math.min(index, chapter.prints.length));
    if (target === chapter.index) return;
    const dropped = dropOnSettle(chapter.prints, target, (p, i) => i < target && missing.has(p.id));
    chapter.prints = dropped.prints;
    chapter.index = dropped.index;
    if (dropped.rebased) chapter.rebase += 1;
    const print = chapter.prints[chapter.index];
    if (print) shown.push(print.id);
    else if (!o.more) finished = true;
  };
  // Stage
  const settled = (i: number) => {
    stage.turning = false;
    stage.held = null;
    stage.settledAt = i;
    const rebase = chapter.rebase;
    settle(i);
    // The room renders: the stage counts from the room's page, and is put back on it when prints went behind.
    stage.settledAt = chapter.index;
    if (chapter.rebase !== rebase) scrollTo(Math.min(stage.settledAt, pages() - 1));
  };
  const snapTo = (i: number) => {
    scrollTo(i);
    settled(i);
  };
  const turn = (to: number) => {
    stage.turning = true;
    stage.held = () => {
      stage.held = null;
      snapTo(to);
    };
    scrollTo(to);
    if (o.atOnce) settled(to);
  };
  const goTo = (to: number) => {
    const i = Math.max(0, Math.min(pages() - 1, to));
    if (i === stage.settledAt) return snapTo(i);
    turn(i);
  };
  // What the list told reaches JS: onMomentumScrollEnd => settled(page(x)).
  const run = () => {
    while (list.told.length) settled(Math.max(0, Math.min(pages() - 1, list.told.shift()!)));
  };

  return {
    tap(x: number) {
      const step = tapStep(
        held({ reduceMotion: o.reduceMotion ?? false }),
        { index: stage.settledAt, count: pages(), turning: stage.turning },
        x,
        W,
        false,
      );
      if (step) turn(step.to);
      run();
    },
    /** VoiceOver's swipe up or down. */
    increment() {
      goTo(chapter.index + 1);
      run();
    },
    decrement() {
      goTo(chapter.index - 1);
      run();
    },
    /** TURN_HELD_MS goes by. */
    wait() {
      stage.held?.();
      run();
    },
    lose(on: boolean) {
      list.lose = on;
    },
    late() {
      list.told.push(...list.lost.splice(0));
      run();
    },
    get on() {
      return chapter.prints[chapter.index]?.id ?? "end";
    },
    get showing() {
      return list.at === chapter.index;
    },
    shown,
    get finished() {
      return finished;
    },
    get turning() {
      return stage.turning;
    },
  };
}

describe("a turn the stage makes itself", () => {
  const right = W * 0.8;

  it("is settled once under Reduce Motion, though it took a print out behind the member", () => {
    // On A, which Photos says is gone; the cut lands on B, A is taken out, and the list is put back under B.
    const r = memoryRoom(["A", "B", "C"], { missing: ["A"], reduceMotion: true });
    r.tap(right);
    expect(r.shown).toEqual(["B"]);
    expect(r.on).toBe("B");
    expect(r.showing).toBe(true);
    expect(r.turning).toBe(false);
    // Settled at once as well, the cut's own report is heard from the page it left: C, never seen, counts as shown.
    const twice = memoryRoom(["A", "B", "C"], { missing: ["A"], reduceMotion: true, atOnce: true });
    twice.tap(right);
    expect(twice.shown).toContain("C");
  });

  it("does not see a day to its end that the member is still in", () => {
    // On this day, A and B, nothing more to deal; A is gone.
    const r = memoryRoom(["A", "B"], { missing: ["A"], reduceMotion: true });
    r.tap(right);
    expect(r.shown).toEqual(["B"]);
    expect(r.finished).toBe(false);
    const twice = memoryRoom(["A", "B"], { missing: ["A"], reduceMotion: true, atOnce: true });
    twice.tap(right);
    expect(twice.finished).toBe(true);
  });

  it("is settled once for VoiceOver's swipe, and for the slide", () => {
    const voice = memoryRoom(["A", "B", "C"], { missing: ["A"] });
    voice.increment();
    expect(voice.shown).toEqual(["B"]);
    expect(voice.on).toBe("B");
    expect(voice.showing).toBe(true);
    const slide = memoryRoom(["A", "B", "C"], { missing: ["A"] });
    slide.tap(right);
    expect(slide.shown).toEqual(["B"]);
    expect(slide.showing).toBe(true);
  });

  it("turns one page at a time, and back, with nothing taken out", () => {
    for (const reduceMotion of [false, true]) {
      const r = memoryRoom(["A", "B", "C"], { reduceMotion });
      r.tap(right);
      r.tap(right);
      r.tap(W * 0.2);
      expect(r.shown).toEqual(["B", "C", "B"]);
      expect(r.showing).toBe(true);
    }
  });

  it("leaves no turn under way when VoiceOver swipes past either end", () => {
    const r = memoryRoom(["A", "B"]);
    r.decrement();
    expect(r.turning).toBe(false);
    r.increment();
    r.increment();
    expect(r.on).toBe("end");
    r.increment();
    expect(r.on).toBe("end");
    expect(r.turning).toBe(false);
  });

  it("puts the list on the page, and the room with it, should the list never say it landed", () => {
    const r = memoryRoom(["A", "B", "C", "D"]);
    r.lose(true);
    r.tap(right);
    // B is on the screen, and the room still counts A: taps wait.
    expect(r.on).toBe("A");
    expect(r.turning).toBe(true);
    r.wait();
    expect(r.on).toBe("B");
    expect(r.showing).toBe(true);
    expect(r.turning).toBe(false);
    // A report that comes after all changes nothing.
    r.late();
    expect(r.on).toBe("B");
    // The next tap counts from B, and turns one page.
    r.lose(false);
    r.tap(right);
    expect(r.on).toBe("C");
    expect(r.showing).toBe(true);
    expect(r.shown).toEqual(["B", "C"]);
  });
});

describe("the pager the tap turns", () => {
  const stage = code("src/components/darkroom/Stage.tsx");
  const between = (from: string, to: string) => stage.slice(stage.indexOf(from), stage.indexOf(to));
  const tap = between("tap(x: number, zoomed: boolean) {", "focus() {");
  const snap = between("const snapTo = useCallback(", "const turn = useCallback(");
  const turn = between("const turn = useCallback(", "const goTo = useCallback(");
  const goTo = between("const goTo = useCallback(", "React.useImperativeHandle(");

  it("is the stage's own list, scrolled to the page with the slide a swipe ends in, or by a cut", () => {
    expect(tap).toMatch(/if \(step\) turn\(step\.to, !step\.cut\);/);
    expect(turn).toMatch(/list\.current\?\.scrollToIndex\(\{ index: to, animated \}\);/);
    // One list, and no gestures of its own: the pager pages, the plate presses.
    expect(stage.match(/<Animated\.FlatList\b/g)).toHaveLength(1);
    expect(stage).not.toMatch(/<(ScrollView|FlatList|PagerView)\s|react-native-gesture-handler|react-native-pager-view|PanResponder|Gesture\./);
  });

  it("hands the whole tap to tapStep, its refs read only as tapStep's arguments", () => {
    // These two lines and nothing else, so no line before or after can set a hold aside.
    expect(tap).toMatch(
      /^tap\(x: number, zoomed: boolean\) \{\s*const step = tapStep\(taps\.current, \{ index: settledAt\.current, count: items\.length, turning: turning\.current \}, x, width, zoomed\);\s*if \(step\) turn\(step\.to, !step\.cut\);\s*\},\s*$/,
    );
    expect(tap.replace(/tapStep\([^;]*\);/, "")).not.toMatch(/\.current\b/);
    expect(stage).toMatch(/import \{ tapStep \} from "\.\/turn";/);
    expect(stage).toMatch(/taps\.current = \{ \.\.\.props\.taps, scrollEnabled: props\.scrollEnabled \};/);
  });

  it("settles a cut, under Reduce Motion or VoiceOver's, once: where the list says it landed", () => {
    expect(turn).not.toMatch(/\bsettled\(/);
    expect(goTo).toMatch(/const i = Math\.max\(0, Math\.min\(items\.length - 1, to\)\);\s*if \(i === settledAt\.current\) return snapTo\(i\);\s*turn\(i, false\);/);
    expect(snap).toMatch(/list\.current\?\.scrollToIndex\(\{ index: i, animated: false \}\);\s*settled\(i\);/);
    // Settled at once only onto the page the list is on, which it never reports, and when it never says it landed.
    expect(stage.match(/\bsnapTo\(/g)).toHaveLength(2);
    expect(stage.match(/\bturn\(/g)).toHaveLength(2);
    expect(stage).toMatch(/goTo,\s*tap\(/);
  });

  it("is turning from a tap or a swipe until the list settles, and DEVELOP waits with it", () => {
    expect(turn).toMatch(/turning\.current = true;\s*onDragging\(true\);/);
    expect(turn.indexOf("turning.current = true")).toBeLessThan(turn.indexOf("scrollToIndex"));
    expect(stage).toMatch(/onScrollBeginDrag=\{\(\) => \{[\s\S]*?turning\.current = true;\s*onDragging\(true\);\s*\}\}/);
    const settled = between("const settled = useCallback(", "const snapTo = useCallback(");
    expect(settled).toMatch(/turning\.current = false;/);
    expect(settled).toMatch(/settledAt\.current = i;/);
    expect(settled).toMatch(/onSettle\(i\);\s*onDragging\(false\);/);
    // Every way the list comes to rest goes through it, and nothing else does.
    expect(stage).toMatch(/onMomentumScrollEnd=\{\(e\) => settled\(page\(e\.nativeEvent\.contentOffset\.x\)\)\}/);
    expect(stage).toMatch(/webTimer\.current = setTimeout\(\(\) => settled\(page\(x\)\), WEB_SETTLE_MS\);/);
    expect(stage).toMatch(/if \(Math\.abs\(x - page\(x\) \* width\) < 0\.5\) settled\(page\(x\)\);/);
    expect(stage.match(/\bsettled\(/g)).toHaveLength(4);
    expect(stage).not.toMatch(/\bonSettle\((?!i\))/);
  });

  it("puts the list on the page, and settles there, should the list never say it landed", () => {
    expect(turn).toMatch(/turnHeld\.current = setTimeout\(\(\) => \{\s*turnHeld\.current = null;\s*snapTo\(to\);\s*\}, TURN_HELD_MS\);/);
    expect(stage).toMatch(/const TURN_HELD_MS = 1000;/);
    // Never onto a new chapter: it starts where it starts, and DEVELOP is let go.
    expect(stage).toMatch(
      /turning\.current = false;\s*if \(turnHeld\.current\) \{\s*clearTimeout\(turnHeld\.current\);\s*turnHeld\.current = null;\s*onDragging\(false\);\s*\}\s*scrollX\.setValue\(index \* width\);/,
    );
  });

  it("leaves VoiceOver's stage as it was: one adjustable element, turned by its swipes", () => {
    expect(stage).toMatch(/accessibilityRole=\{a11y\.single \? "adjustable" : undefined\}/);
    expect(stage).toMatch(/accessibilityLabel=\{a11y\.single \? STAGE_LABEL : undefined\}/);
    expect(stage).toMatch(/accessibilityHint=\{a11y\.single \? STAGE_HINT : undefined\}/);
    expect(stage).toMatch(/accessibilityActions=\{a11y\.single \? spokenActions\(a11y\.actions\) : undefined\}/);
    expect(stage).toMatch(/if \(said === "increment"\) return a11y\.onIncrement\(\);/);
    expect(stage).toMatch(/if \(said === "decrement"\) return a11y\.onDecrement\(\);/);
    // Its activation is left to iOS, which lands a touch in the middle: the plate hears it, and turns nothing.
    expect(stage).not.toMatch(/onAccessibilityTap/);
  });
});

describe("the plate the tap lands on", () => {
  const page = code("src/components/darkroom/PrintPage.tsx");
  const zoom = page.slice(page.indexOf("function Zoom("), page.indexOf("function actualSize("));

  it("hands on where the finger lifted across the page, and whether the print is zoomed in", () => {
    expect(zoom).toMatch(/onPress=\{\(e: GestureResponderEvent\) => onTap\(e\.nativeEvent\.pageX, zoomed\.current\)\}/);
    expect(zoom).not.toMatch(/locationX/);
    expect(page).toMatch(/<Zoom box=\{box\} current=\{current\} onTap=\{props\.onTap\}>/);
  });

  it("knows it is zoomed in from the scroll and from the pinch's own end", () => {
    expect(zoom).toMatch(/zoomed\.current = \(e\.nativeEvent\.zoomScale \?\? 1\) > ZOOMED;/);
    expect(zoom).toMatch(/onScroll=\{readZoom\}/);
    expect(zoom).toMatch(/onScrollEndDrag=\{readZoom\}/);
    expect(page).toMatch(/const ZOOMED = 1\.02;/);
  });

  it("has one press, with no delay and no double-tap, out of VoiceOver's way, and a finger held still turns nothing", () => {
    expect(zoom.match(/<Pressable\b/g)).toHaveLength(1);
    expect(zoom).toMatch(/style=\{\{ width: box\.width, height: box\.height \}\}\s+accessible=\{false\}\s+>/);
    // A long press at the usual half second takes a hold, so it lifts with no tap; a tap still turns as it lifts.
    expect(zoom).toMatch(
      /<Pressable\s+onPress=\{\(e: GestureResponderEvent\) => onTap\(e\.nativeEvent\.pageX, zoomed\.current\)\}\s+onLongPress=\{\(\) => undefined\}\s+style=/,
    );
    expect(zoom.match(/onLongPress/g)).toHaveLength(1);
    expect(zoom).not.toMatch(/delayLongPress|unstable_pressDelay|delayPressIn|onPressIn|onPressOut/);
    expect(page).not.toMatch(/doubleTap|onDoubleTap|TapGestureHandler|numberOfTaps/i);
  });

  it("is the only page that takes a tap: a title card and a page of words keep their own", () => {
    for (const file of ["src/components/darkroom/TitleCard.tsx", "src/components/darkroom/Plate.tsx"]) {
      expect(code(file), file).not.toMatch(/onTap|\.tap\(/);
    }
    const room = code("app/darkroom.tsx");
    expect(room.match(/onTap=/g)).toHaveLength(1);
    expect(room).toMatch(/const onPlateTap = useCallback\(\(x: number, zoomed: boolean\) => stage\.current\?\.tap\(x, zoomed\), \[\]\);/);
    expect(room).toMatch(/<PrintPage[\s\S]*?onTap=\{onPlateTap\}[\s\S]*?\/>/);
  });
});

describe("what holds the tap back", () => {
  const room = code("app/darkroom.tsx");

  it("is a develop state, a chapter on its way, its title card, and VoiceOver; Reduce Motion makes it a cut", () => {
    expect(room).toMatch(
      /taps=\{\{ locked: develop\.id != null \|\| state\.loading != null \|\| fades\.card != null, screenReader, reduceMotion \}\}/,
    );
    expect(room).toMatch(/const screenReader = useScreenReader\(\);/);
    expect(room).toMatch(/const reduceMotion = useReducedMotion\(\);/);
  });
});

describe("the room's words", () => {
  const room = code("app/darkroom.tsx");
  const head = code("src/components/darkroom/RunningHead.tsx");
  const page = code("src/components/darkroom/PrintPage.tsx");

  it("are never hidden by a tap: no chrome, no hidden status bar", () => {
    expect(existsSync(path.join(root, "src/components/darkroom/useChrome.ts"))).toBe(false);
    const roomFiles = readdirSync(path.join(root, "src/components/darkroom")).map((f) => `src/components/darkroom/${f}`);
    for (const file of ["app/darkroom.tsx", ...roomFiles]) {
      const src = code(file);
      expect(src, file).not.toMatch(/useChrome|setStatusBarHidden|steadyTop|chrome\./);
    }
  });

  it("keep the running head on the page, and pressable, under the safe area as it is", () => {
    expect(head).not.toMatch(/Animated|hidden|opacity\s*[,}]|opacity=/);
    expect(head).toMatch(/<View style=\{\[styles\.head, \{ paddingTop: top \}\]\} pointerEvents="box-none">/);
    expect(room).toMatch(/<RunningHead\s+top=\{insets\.top\}/);
  });

  it("keep each caption at full strength, and DEVELOP fading only onto the end page", () => {
    expect(page).not.toMatch(/captionOpacity|opacity:/);
    expect(page).toMatch(/<View style=\{\[styles\.caption, \{ top: top \+ box\.height, left: \(width - captionW\) \/ 2 \}\]\}>/);
    expect(room).toMatch(
      /const developOpacity = useMemo\(\s*\(\) => scrollX\.interpolate\(\{ inputRange: \[\(n - 1\) \* width, n \* width\], outputRange: \[1, 0\], extrapolate: "clamp" \}\),/,
    );
    expect(room).toMatch(/interactive=\{showsDevelop && !atTail && !state\.loading && !fades\.card\}/);
  });
});
