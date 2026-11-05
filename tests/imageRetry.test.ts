import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A photograph that fails to load is asked for again, a few times, a
 * little later each time. The hook runs here on a minimal stand-in for
 * React's hooks (one component, re-run on every state change, effects
 * cleaned up when their inputs change), so its behaviour is checked, not
 * only its source.
 */

const harness = vi.hoisted(() => {
  type Effect = { deps: unknown[] | undefined; cleanup?: void | (() => void) };
  const slots: unknown[] = [];
  const effects: Effect[] = [];
  let index = 0;
  let effectIndex = 0;
  let pending: (() => void)[] = [];
  let rerender: (() => void) | null = null;
  const changed = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const react = {
    useState<T>(initial: T | (() => T)) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? (initial as () => T)() : initial;
      const set = (next: T | ((prev: T) => T)) => {
        const value = typeof next === "function" ? (next as (prev: T) => T)(slots[i] as T) : next;
        if (Object.is(value, slots[i])) return;
        slots[i] = value;
        rerender?.();
      };
      return [slots[i] as T, set] as const;
    },
    useRef<T>(initial: T) {
      const i = index++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i] as { current: T };
    },
    useCallback<T>(fn: T, deps: unknown[]) {
      const i = index++;
      const last = slots[i] as { fn: T; deps: unknown[] } | undefined;
      if (!last || changed(last.deps, deps)) slots[i] = { fn, deps };
      return (slots[i] as { fn: T }).fn;
    },
    useEffect(fn: () => void | (() => void), deps?: unknown[]) {
      const i = effectIndex++;
      const last = effects[i];
      if (!last || changed(last.deps, deps)) {
        pending.push(() => {
          if (last?.cleanup) last.cleanup();
          effects[i] = { deps, cleanup: fn() };
        });
      }
    },
  };
  return {
    react,
    mount<T>(hook: () => T) {
      let result!: T;
      let rendering = false;
      let again = false;
      const run = () => {
        if (rendering) {
          again = true;
          return;
        }
        rendering = true;
        do {
          again = false;
          index = 0;
          effectIndex = 0;
          pending = [];
          result = hook();
        } while (again);
        rendering = false;
        for (const e of pending) e();
      };
      rerender = run;
      run();
      return {
        get current() {
          return result;
        },
        render: run,
        unmount() {
          for (const e of effects) if (e?.cleanup) e.cleanup();
          rerender = null;
        },
      };
    },
    reset() {
      slots.length = 0;
      effects.length = 0;
      rerender = null;
    },
  };
});

vi.mock("react", () => harness.react);

import { IMAGE_RETRIES, retryDelayMs, useImageRetry } from "@/media/imageRetry";

beforeEach(() => {
  vi.useFakeTimers();
  harness.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a photograph that failed to load", () => {
  it("is asked for again three times, later each time", () => {
    expect(IMAGE_RETRIES).toBe(3);
    expect([1, 2, 3].map(retryDelayMs)).toEqual([1_500, 4_000, 10_000]);
    expect(retryDelayMs(4)).toBeNull();
    expect(retryDelayMs(0)).toBeNull();
    expect(retryDelayMs(1.5)).toBeNull();
  });

  it("is drawn afresh (a new key) after each wait, and left alone once the tries are spent", () => {
    let source = "https://example.test/a.jpg";
    const view = harness.mount(() => useImageRetry(source));
    expect(view.current.attempt).toBe(0);

    view.current.onError();
    vi.advanceTimersByTime(1_499);
    expect(view.current.attempt).toBe(0);
    vi.advanceTimersByTime(1);
    expect(view.current.attempt).toBe(1);

    view.current.onError();
    vi.advanceTimersByTime(4_000);
    expect(view.current.attempt).toBe(2);

    view.current.onError();
    vi.advanceTimersByTime(10_000);
    expect(view.current.attempt).toBe(3);

    view.current.onError();
    vi.advanceTimersByTime(60_000);
    expect(view.current.attempt).toBe(3);
    void source;
  });

  it("asks once for one failure, however many times the view reports it", () => {
    const view = harness.mount(() => useImageRetry("x"));
    view.current.onError();
    view.current.onError();
    view.current.onError();
    vi.advanceTimersByTime(1_500);
    expect(view.current.attempt).toBe(1);
    vi.advanceTimersByTime(20_000);
    expect(view.current.attempt).toBe(1);
  });

  it("starts again from the first try for a new picture, and forgets the old one's wait", () => {
    let source = "a";
    const view = harness.mount(() => useImageRetry(source));
    view.current.onError();
    vi.advanceTimersByTime(1_500);
    expect(view.current.attempt).toBe(1);
    view.current.onError();
    source = "b";
    view.render();
    expect(view.current.attempt).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(view.current.attempt).toBe(0);
    // The new picture's own first failure is tried again on its own clock.
    view.current.onError();
    vi.advanceTimersByTime(1_500);
    expect(view.current.attempt).toBe(1);
  });

  it("is not asked for after the view has gone", () => {
    const view = harness.mount(() => useImageRetry("x"));
    view.current.onError();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** The source without its comments. */
function code(file: string): string {
  return readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the pictures that try again", () => {
  it("are the feed's photograph, a clip's poster with or without its player, and a grid square", () => {
    const media = code("src/components/PostMedia.tsx");
    expect(media).toMatch(/const photoRetry = useImageRetry\(isVideo \? null : post\.media_path\);/);
    expect(media).toMatch(/recyclingKey=\{pictureKey\}\s*key=\{photoRetry\.attempt\}\s*onError=\{photoRetry\.onError\}/);
    expect(media.match(/const posterRetry = useImageRetry\(posterUrl\);/g)).toHaveLength(2);
    expect(media.match(/key=\{posterRetry\.attempt\}\s*onError=\{posterRetry\.onError\}/g)).toHaveLength(2);
    // The hook runs before the clip's early return, every time.
    expect(media.indexOf("useImageRetry(isVideo")).toBeLessThan(media.search(/if \(isVideo\) \{\s*return \(/));
    expect(media.search(/if \(isVideo\) \{\s*return \(/)).toBeGreaterThan(0);

    const grid = code("src/components/PhotoGrid.tsx");
    expect(grid).toMatch(/const retry = useImageRetry\(url\);/);
    expect(grid).toMatch(/key=\{retry\.attempt\}\s*onError=\{retry\.onError\}/);
  });
});
