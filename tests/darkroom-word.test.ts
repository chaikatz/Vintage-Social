import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// room.ts reads the platform for its faces; nothing else here touches React Native but its Animated nodes, which
// are loaded from node_modules below.
vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
  DynamicColorIOS: (o: { dark: string }) => o.dark,
  useColorScheme: () => "light",
}));

import { roles } from "@/components/darkroom/room";
import { fadeStart, WORD_FADE_MS, wordOnPage, wordOpacity, type WordKit } from "@/components/darkroom/wordFade";
import {
  DEVELOP_HINT,
  OPENING,
  POST,
  stageActions,
  stateWords,
  WORD_MAX_SCALE,
  type DevelopState,
} from "@/components/darkroom/words";
import { FakeNative, loadAnimated, type AnimatedNode, type AnimatedValueNode } from "./helpers/rnAnimated";
import { code, root } from "./helpers/screenSource";

/**
 * POST, the word under every photograph in the Memory Room (the code's
 * Develop): that it is on every photograph's page, in every way there is
 * of coming to one, and says POST.
 *
 * On build 58 it went missing: "sometimes it doesn't say develop under the
 * photos at the bottom". The cause is in how React Native's Animated keeps
 * native nodes, and the first two tests show it with Animated's own code
 * from node_modules (`tests/helpers/rnAnimated.ts`), against a fake of the
 * native side that records what the native driver would be told. The web
 * demo cannot show it: in the browser Animated runs in JavaScript, and the
 * value is never dropped.
 */

const W = 390;

describe("build 58's word, on React Native's own Animated", () => {
  it("lost its scroll when it was handed a zero on the end page, and stayed at nothing on the photographs after", () => {
    const native = new FakeNative();
    const A = loadAnimated(native);
    const pager = 7;
    const n = 6;
    const scrollX = new A.Value(0);
    const zero = new A.Value(0);
    // As build 58 had it: the scroll interpolated over the page after the last photograph, or a zero.
    const fade = scrollX.interpolate({ inputRange: [(n - 1) * W, n * W], outputRange: [1, 0], extrapolate: "clamp" });
    const word = new A.View();
    word.read(fade);
    A.attachScroll(pager, scrollX);
    const bound = native.boundTo(pager);
    expect(bound).toBe(scrollX.__nativeTag);

    native.scroll(pager, 2 * W);
    expect(word.opacity()).toBe(1);
    // On to the end page: the word is handed the zero, and the scroll value is left with no one reading it.
    native.scroll(pager, n * W);
    word.read(zero);
    expect(scrollX.__nativeTag).toBeUndefined();
    expect(native.nodes.has(bound!)).toBe(false);
    // Back to a photograph: the word reads the scroll again, which gets a new native node…
    word.read(fade);
    native.scroll(pager, 2 * W);
    // …that the pager's scroll was never bound to. The word stays at nothing on the third photograph.
    expect(scrollX.__nativeTag).not.toBe(bound);
    expect(native.boundTo(pager)).toBe(bound);
    expect(word.opacity()).toBe(0);
  });

  it("lost it the same way under a title card, until the chapter changed", () => {
    const native = new FakeNative();
    const A = loadAnimated(native);
    const scrollX = new A.Value(0);
    const zero = new A.Value(0);
    const fade = scrollX.interpolate({ inputRange: [5 * W, 6 * W], outputRange: [1, 0], extrapolate: "clamp" });
    const word = new A.View();
    word.read(fade);
    A.attachScroll(7, scrollX);
    native.scroll(7, 3 * W);
    word.read(zero);
    word.read(fade);
    // The value's new node is seeded where it was, so the word shows; but no scroll moves it any more.
    native.scroll(7, 6 * W);
    expect(native.boundTo(7)).not.toBe(scrollX.__nativeTag);
    expect(word.opacity()).toBe(1);
  });
});

// ---------------------------------------------------------------------------

/** The room as `app/darkroom.tsx` puts the word together, on React Native's nodes. */
function room() {
  const native = new FakeNative();
  const A = loadAnimated(native);
  const kit: WordKit<AnimatedValueNode, AnimatedNode> = {
    add: (a, b) => new A.Addition(a, b),
    multiply: (a, b) => new A.Multiplication(a, b),
  };
  const scrollX = new A.Value(0);
  const on = new A.Value(0);
  const start = new A.Value(fadeStart(0, W));
  const word = new A.View();
  // `useWordFade`: built once for the page width, and the one node the word is ever handed.
  const opacity = wordOpacity(kit, scrollX, on, start, W);
  word.read(opacity);
  let pager = 0;
  let lists = 200;
  let list: { detach(): void } | null = null;
  let count = 0;
  let page = 0;
  const r = {
    native,
    scrollX,
    word,
    opacity,
    /** What the room is showing; the word follows, as `useWordFade`'s effects make it. */
    show(p: { prints?: boolean; count?: number; page?: number; card?: boolean }) {
      if (p.count != null) count = p.count;
      if (p.page != null) page = p.page;
      start.setValue(fadeStart(count, W));
      const shown = wordOnPage({ prints: p.prints ?? true, photograph: page < count, card: p.card ?? false });
      on.setValue(shown ? 1 : 0);
    },
    /** A new chapter: the pager's list is mounted afresh, its scroll attached, and put on its first page. */
    chapter(n: number, at = 0) {
      list?.detach();
      pager = lists++;
      list = A.attachScroll(pager, scrollX);
      scrollX.setValue(at * W);
      native.scroll(pager, at * W);
      r.show({ count: n, page: at });
    },
    /** Prints behind the member taken out: `Stage` puts the list and the value back on the same photograph. */
    rebase(n: number, at: number) {
      scrollX.setValue(at * W);
      native.scroll(pager, at * W);
      r.show({ count: n, page: at });
    },
    /** The pager scrolled to `x` and, if it lands there, settled: `Stage` puts the scroll value on the page. */
    scroll(x: number, settle = true) {
      native.scroll(pager, x);
      if (!settle) return;
      const i = Math.round(x / W);
      scrollX.setValue(i * W);
      r.show({ page: i });
    },
    /** The word as the native driver draws it, and whether the pager's scroll still drives what it reads. */
    seen(): { opacity: number; driven: boolean } {
      const bound = native.boundTo(pager);
      return { opacity: Math.round(word.opacity() * 100) / 100, driven: bound != null && bound === scrollX.__nativeTag && native.nodes.has(bound) };
    },
  };
  return r;
}

describe("the room's word now", () => {
  it("is on every photograph's page whichever way the room came to it, and fades toward the end page with the finger", () => {
    const r = room();
    r.chapter(6);
    expect(r.seen()).toEqual({ opacity: 1, driven: true });
    // Swiped to the last photograph, and half way on to the end page, the finger still down.
    r.scroll(5 * W);
    expect(r.seen().opacity).toBe(1);
    r.scroll(5.5 * W, false);
    expect(r.seen()).toEqual({ opacity: 0.5, driven: true });
    // The end page: gone.
    r.scroll(6 * W);
    expect(r.seen()).toEqual({ opacity: 0, driven: true });
    // Back from it by a glide's cut, a frame tapped, or a swipe: there.
    for (const back of [5, 1, 0]) {
      r.scroll(back * W);
      expect(r.seen(), `page ${back}`).toEqual({ opacity: 1, driven: true });
    }
    // To the end page again and back, and every page after it.
    r.scroll(6 * W);
    for (let i = 5; i >= 0; i--) {
      r.scroll(i * W);
      expect(r.seen(), `page ${i}`).toEqual({ opacity: 1, driven: true });
    }
  });

  it("goes under a title card and comes back with the next chapter, its scroll still its own", () => {
    const r = room();
    r.chapter(6, 2);
    r.show({ card: true });
    expect(r.seen().opacity).toBe(0);
    r.chapter(12, 0);
    r.show({ card: true });
    r.show({ card: false });
    expect(r.seen()).toEqual({ opacity: 1, driven: true });
    r.scroll(11 * W);
    r.scroll(11.5 * W, false);
    expect(r.seen().opacity).toBe(0.5);
  });

  it("stays on the last photograph dealt as more are dealt, and comes on when the waiting card becomes a photograph", () => {
    const r = room();
    r.chapter(12, 0);
    r.scroll(11 * W);
    r.show({ count: 18 });
    expect(r.seen()).toEqual({ opacity: 1, driven: true });
    // Outran the deal: the waiting card, then the batch lands under the member.
    r.scroll(18 * W);
    expect(r.seen().opacity).toBe(0);
    r.show({ count: 24 });
    expect(r.seen()).toEqual({ opacity: 1, driven: true });
    // Or stepped back from the waiting card before it landed.
    r.scroll(24 * W);
    r.scroll(23 * W);
    expect(r.seen()).toEqual({ opacity: 1, driven: true });
  });

  it("keeps its place when prints behind are taken out, and goes on a word page", () => {
    const r = room();
    r.chapter(24, 0);
    r.scroll(23 * W);
    // Four prints behind the member left the chapter: the list is put back on the same photograph (`rebase`).
    r.rebase(20, 19);
    expect(r.seen()).toEqual({ opacity: 1, driven: true });
    r.show({ prints: false });
    expect(r.seen().opacity).toBe(0);
    r.show({ prints: true });
    expect(r.seen()).toEqual({ opacity: 1, driven: true });
  });

  it("shows on a photograph even should a scroll event never have come, since the pager puts the value on the page it settled on", () => {
    const r = room();
    r.chapter(6, 0);
    r.scroll(6 * W);
    // The scroll value left on the end page; the list settles on the second photograph without a word from UIKit.
    r.scrollX.setValue(1 * W);
    r.show({ page: 1 });
    expect(r.seen().opacity).toBe(1);
  });

  it("is on the page only with a photograph settled in front and no title card", () => {
    expect(wordOnPage({ prints: true, photograph: true, card: false })).toBe(true);
    for (const p of [
      { prints: false, photograph: true, card: false },
      { prints: true, photograph: false, card: false },
      { prints: true, photograph: true, card: true },
    ]) {
      expect(wordOnPage(p), JSON.stringify(p)).toBe(false);
    }
    expect(fadeStart(6, W)).toBe(-5 * W);
    expect(fadeStart(0, W)).toBe(-0);
    expect(WORD_FADE_MS).toBe(160);
  });
});

// ---------------------------------------------------------------------------

describe("the word, in the room's source", () => {
  const screen = code("app/darkroom.tsx");
  const hook = code("src/components/darkroom/useWordFade.ts");
  const stage = code("src/components/darkroom/Stage.tsx");

  it("is handed one node on every render, never a separate zero", () => {
    expect(screen).not.toMatch(/\bZERO\b/);
    expect(screen.match(/<Develop\s/g)).toHaveLength(1);
    const develop = screen.slice(screen.indexOf("<Develop"), screen.indexOf("/>", screen.indexOf("<Develop")));
    expect(develop).toMatch(/opacity=\{wordOpacity\}/);
    expect(screen).toMatch(/const wordShown = wordOnPage\(\{ prints: state\.view\.kind === "prints", photograph: current != null, card: fades\.card != null \}\);/);
    expect(screen).toMatch(/const wordOpacity = useWordFade\(scrollX, n, width, wordShown, reduceMotion\);/);
    // Nothing else reads the scroll value but the pager (`scrollX={scrollX}`) and the word.
    expect(screen.match(/\bscrollX\b/g)).toHaveLength(4);
  });

  it("builds the graph once a page width, moves the fade's start and fades the word by setting values", () => {
    expect(hook).toMatch(/const on = useRef\(new Animated\.Value\(shown \? 1 : 0\)\)\.current;/);
    expect(hook).toMatch(/const start = useRef\(new Animated\.Value\(fadeStart\(count, width\)\)\)\.current;/);
    expect(hook).toMatch(/const opacity = useMemo\(\(\) => wordOpacity\(kit, scrollX, on, start, width\), \[scrollX, on, start, width\]\);/);
    expect(hook).toMatch(/start\.setValue\(fadeStart\(count, width\)\);/);
    expect(hook).toMatch(/toValue: shown \? 1 : 0,\s*duration: reduceMotion \? 0 : WORD_FADE_MS,/);
    expect(hook).toMatch(/useNativeDriver: true,/);
  });

  it("is put on the page the pager settled on", () => {
    const settled = stage.slice(stage.indexOf("const settled = useCallback("), stage.indexOf("const snapTo = useCallback("));
    expect(settled).toMatch(/settledAt\.current = i;\s*scrollX\.setValue\(i \* width\);\s*onSettle\(i\);/);
    expect(settled).toMatch(/\[onSettle, onDragging, scrollX, width\]/);
  });
});

// ---------------------------------------------------------------------------

const states: DevelopState[] = [
  { kind: "idle" },
  { kind: "working", slow: false },
  { kind: "working", slow: true },
  { kind: "inCloud", network: "wifi" },
  { kind: "inCloud", network: "cellular" },
  { kind: "downloading", progress: 0.4 },
  { kind: "downloading", progress: null },
  { kind: "offline" },
  { kind: "cloudFailed" },
  { kind: "missing" },
  { kind: "unreadable" },
  { kind: "gone" },
];
const contexts = [false, true].flatMap((limited) =>
  [false, true].flatMap((setAside) => [false, true].map((shelfChapter) => ({ limited, setAside, shelfChapter }))),
);

describe("what the word says", () => {
  it("is POST at rest, and something in every state, never empty", () => {
    expect(stateWords({ kind: "idle" }, contexts[0]).bottom.label).toBe(POST);
    expect(POST).toBe("Post");
    for (const s of states) {
      for (const ctx of contexts) {
        const label = stateWords(s, ctx).bottom.label;
        expect(label.trim().length, `${s.kind} ${JSON.stringify(ctx)}`).toBeGreaterThan(0);
      }
    }
  });

  it("never says develop to a member, on the page or to VoiceOver", () => {
    for (const s of states) {
      for (const ctx of contexts) {
        const w = stateWords(s, ctx);
        const said = [w.line1, w.line2, w.right?.label, w.bottom.label, w.bottom.reason, w.announce];
        const busy = s.kind === "working" || s.kind === "downloading";
        for (const a of stageActions(Date.UTC(2019, 6, 3), ctx.setAside, { words: w, stated: s.kind !== "idle", busy })) said.push(a.label);
        for (const t of said) expect(t ?? "", `${s.kind} ${JSON.stringify(ctx)}`).not.toMatch(/develop/i);
      }
    }
    expect(DEVELOP_HINT).not.toMatch(/develop/i);
    expect(OPENING).toBe("Opening…");
  });

  it("sets no word with develop in it anywhere in the room", () => {
    const dir = "src/components/darkroom";
    const files = ["app/darkroom.tsx", ...readdirSync(path.join(root, dir)).map((f) => `${dir}/${f}`)];
    for (const file of files) {
      const src = code(file).replace(/^import[\s\S]*?from\s+"[^"]+";$/gm, "");
      // Quoted words and JSX text; the act's own name ("develop") and test ids are code, not words.
      const quoted = [...src.matchAll(/"([^"\n]*)"|`([^`]*)`|>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*)\s*</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
      const words = quoted.filter((q) => !/^(develop|developing|darkroom-[\w-]+)$/.test(q));
      for (const q of words) expect(q, file).not.toMatch(/develop/i);
    }
  });

  it("keeps every word in its place to one line on a 320-point phone, at the largest type it allows", () => {
    const style = roles.wordPrimary.style as { fontSize: number; letterSpacing: number };
    // Courier New's every letter is 0.6 of its size; the tracking grows with the type, to be safe.
    const width = (label: string) => label.length * (0.6 * style.fontSize + style.letterSpacing) * WORD_MAX_SCALE;
    const room = 320 - 2 * 24;
    for (const s of states) {
      for (const ctx of contexts) {
        const label = stateWords(s, ctx).bottom.label;
        expect(width(label), label).toBeLessThanOrEqual(room);
      }
    }
    expect(code("src/components/darkroom/Develop.tsx")).toMatch(/maxFontSizeMultiplier=\{WORD_MAX_SCALE\}/);
    expect(code("src/components/darkroom/Develop.tsx")).toMatch(/paddingHorizontal=\{24\}/);
    // The longest, set at the cap, with room to spare: what it replaced, DOWNLOAD AND DEVELOP, did not fit.
    expect(width("Download and post")).toBeLessThan(room);
    expect(width("Download and develop")).toBeGreaterThan(room);
  });
});
