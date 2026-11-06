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

/** react-query's online manager, as NetInfo drives it on the phone: it tells its listeners of a change only. */
const online = vi.hoisted(() => {
  const listeners = new Set<(online: boolean) => void>();
  let value = true;
  return {
    listeners,
    onlineManager: {
      isOnline: () => value,
      subscribe(listener: (online: boolean) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    set(next: boolean) {
      if (next === value) return;
      value = next;
      for (const listener of [...listeners]) listener(next);
    },
    reset() {
      listeners.clear();
      value = true;
    },
  };
});
vi.mock("@tanstack/react-query", () => ({ onlineManager: online.onlineManager }));

import { IMAGE_RETRIES, retryDelayMs, useImageRetry } from "@/media/imageRetry";

beforeEach(() => {
  vi.useFakeTimers();
  harness.reset();
  online.reset();
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
    expect(online.listeners.size).toBe(0);
  });
});

describe("a photograph that failed to load, when the connection comes back", () => {
  const spend = (view: { current: { onError: () => void } }) => {
    for (const wait of [1_500, 4_000, 10_000]) {
      view.current.onError();
      vi.advanceTimersByTime(wait);
    }
    view.current.onError();
  };

  it("is asked for again the moment the phone is back online, with its tries afresh, after they were spent", () => {
    const view = harness.mount(() => useImageRetry("x"));
    spend(view);
    expect(view.current.attempt).toBe(3);
    vi.advanceTimersByTime(120_000);
    expect(view.current.attempt).toBe(3);
    // Signal lost for a while, then back.
    online.set(false);
    expect(view.current.attempt).toBe(3);
    online.set(true);
    expect(view.current.attempt).toBe(4);
    // Asked for, it listens no longer; failing again, it has its three tries.
    expect(online.listeners.size).toBe(0);
    view.current.onError();
    vi.advanceTimersByTime(1_500);
    expect(view.current.attempt).toBe(5);
  });

  it("spends no try while the phone is offline, and is asked for as soon as it is back", () => {
    online.set(false);
    const view = harness.mount(() => useImageRetry("x"));
    view.current.onError();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(view.current.attempt).toBe(0);
    online.set(true);
    expect(view.current.attempt).toBe(1);
  });

  it("is asked for once, at once, when a retry was still waiting", () => {
    const view = harness.mount(() => useImageRetry("x"));
    view.current.onError();
    online.set(false);
    online.set(true);
    expect(view.current.attempt).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(view.current.attempt).toBe(1);
  });

  it("is left alone once it has loaded: a picture on screen never blinks for a reconnection", () => {
    const view = harness.mount(() => useImageRetry("x"));
    expect(online.listeners.size).toBe(0);
    online.set(false);
    online.set(true);
    expect(view.current.attempt).toBe(0);
    // Failed once, and the retry loaded it.
    view.current.onError();
    vi.advanceTimersByTime(1_500);
    expect(view.current.attempt).toBe(1);
    expect(online.listeners.size).toBe(0);
    online.set(false);
    online.set(true);
    expect(view.current.attempt).toBe(1);
  });

  it("forgets the old picture's failure when it is given a new one", () => {
    let source = "a";
    const view = harness.mount(() => useImageRetry(source));
    spend(view);
    expect(online.listeners.size).toBe(1);
    source = "b";
    view.render();
    expect(online.listeners.size).toBe(0);
    online.set(false);
    online.set(true);
    expect(view.current.attempt).toBe(0);
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
  it("are the feed's photograph, a clip's poster with or without its player, a grid square and an avatar", () => {
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

    // And a member's picture, its hook before the early return for no picture.
    const avatar = code("src/components/Avatar.tsx");
    expect(avatar).toMatch(/const retry = useImageRetry\(url\);/);
    expect(avatar.indexOf("useImageRetry(url)")).toBeLessThan(avatar.indexOf("if (!url)"));
    expect(avatar).toMatch(/cachePolicy="memory-disk"\s*key=\{retry\.attempt\}\s*onError=\{retry\.onError\}/);
  });
});
