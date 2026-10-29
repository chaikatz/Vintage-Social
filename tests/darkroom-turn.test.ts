import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tapTurn, type TapContext } from "@/components/darkroom/turn";

/**
 * Turning the room's pages with a tap: which way a tap on the photograph
 * turns (`tapTurn`), and, read from the source, the lines that make the
 * pager's own scroll do it — held back while the print is zoomed in, while
 * a develop state is showing, while a turn is under way and under
 * VoiceOver — and that keep the room's words on the page, now that a tap
 * no longer hides them. The room itself is walked in the browser
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

describe("the pager the tap turns", () => {
  const stage = code("src/components/darkroom/Stage.tsx");
  const tap = stage.slice(stage.indexOf("tap(x: number, zoomed: boolean) {"), stage.indexOf("focus() {"));

  it("is the stage's own list, scrolled to the page with the slide a swipe ends in", () => {
    expect(tap).toMatch(/const to = settledAt\.current \+ step;/);
    expect(tap).toMatch(/list\.current\?\.scrollToIndex\(\{ index: to, animated: true \}\);/);
    // One list, and no gestures of its own: the pager pages, the plate presses.
    expect(stage.match(/<Animated\.FlatList\b/g)).toHaveLength(1);
    expect(stage).not.toMatch(/<(ScrollView|FlatList|PagerView)\s|react-native-gesture-handler|react-native-pager-view|PanResponder|Gesture\./);
  });

  it("is a cut under Reduce Motion, which settles as it lands", () => {
    expect(tap).toMatch(/if \(held\.reduceMotion\) return goTo\(to\);/);
    expect(stage).toMatch(/list\.current\?\.scrollToIndex\(\{ index: i, animated: false \}\);\s*settled\(i\);/);
  });

  it("counts from the settled page, and holds a tap back while zoomed, locked, turning or under VoiceOver", () => {
    expect(tap).toMatch(/tapTurn\(x, width, \{/);
    expect(tap).toMatch(/index: settledAt\.current,/);
    expect(tap).toMatch(/count: items\.length,/);
    expect(tap).toMatch(/\n\s+zoomed,\n/);
    expect(tap).toMatch(/locked: held\.locked \|\| !held\.scrollEnabled,/);
    expect(tap).toMatch(/turning: turning\.current,/);
    expect(tap).toMatch(/screenReader: held\.screenReader,/);
    expect(tap).toMatch(/if \(step === 0\) return;/);
    expect(stage).toMatch(/taps\.current = \{ \.\.\.props\.taps, scrollEnabled: props\.scrollEnabled \};/);
  });

  it("is turning from a tap or a swipe until the list settles, and DEVELOP waits with it", () => {
    expect(tap).toMatch(/turning\.current = true;\s*onDragging\(true\);/);
    expect(tap.indexOf("turning.current = true")).toBeLessThan(tap.indexOf("scrollToIndex"));
    expect(stage).toMatch(/onScrollBeginDrag=\{\(\) => \{[\s\S]*?turning\.current = true;\s*onDragging\(true\);\s*\}\}/);
    const settled = stage.slice(stage.indexOf("const settled = useCallback("), stage.indexOf("const goTo = useCallback("));
    expect(settled).toMatch(/turning\.current = false;/);
    expect(settled).toMatch(/settledAt\.current = i;/);
    expect(settled).toMatch(/onSettle\(i\);\s*onDragging\(false\);/);
    // Every way the list comes to rest goes through it.
    expect(stage).toMatch(/onMomentumScrollEnd=\{\(e\) => settled\(page\(e\.nativeEvent\.contentOffset\.x\)\)\}/);
    expect(stage).toMatch(/webTimer\.current = setTimeout\(\(\) => settled\(page\(x\)\), WEB_SETTLE_MS\);/);
    expect(stage).toMatch(/if \(Math\.abs\(x - page\(x\) \* width\) < 0\.5\) settled\(page\(x\)\);/);
    expect(stage).not.toMatch(/\bonSettle\((?!i\))/);
  });

  it("lets taps be heard again should the list never say it settled", () => {
    expect(tap).toMatch(/turnHeld\.current = setTimeout\(\(\) => \{\s*turnHeld\.current = null;\s*turning\.current = false;\s*onDragging\(false\);\s*\}, TURN_HELD_MS\);/);
    expect(stage).toMatch(/const TURN_HELD_MS = 1000;/);
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

  it("has one press, with no delay, no double-tap and no long press, out of VoiceOver's way", () => {
    expect(zoom.match(/<Pressable\b/g)).toHaveLength(1);
    expect(zoom).toMatch(/style=\{\{ width: box\.width, height: box\.height \}\}\s+accessible=\{false\}\s+>/);
    expect(zoom).not.toMatch(/onLongPress|delayLongPress|unstable_pressDelay|delayPressIn/);
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
