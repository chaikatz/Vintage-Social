import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterTabSettles, tabSettled, TAB_SETTLE_MS } from "@/post/settle";

/**
 * The Post tab waits for its own slide before it reads the library or
 * draws new rows. InteractionManager.runAfterInteractions used to be how;
 * React Native 0.81 makes it a bare setImmediate (its
 * disableInteractionManager flag is on by default), so it waited for
 * nothing. The tab now waits on a timer, which stops when the tab is left.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("waiting for the tab to settle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs once the slide is over, and not before", () => {
    const run = vi.fn();
    afterTabSettles(run);
    vi.advanceTimersByTime(TAB_SETTLE_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(TAB_SETTLE_MS).toBeGreaterThanOrEqual(250);
  });

  it("never runs for a tab left first", () => {
    const run = vi.fn();
    const stop = afterTabSettles(run);
    vi.advanceTimersByTime(100);
    stop();
    vi.advanceTimersByTime(TAB_SETTLE_MS * 2);
    expect(run).not.toHaveBeenCalled();
  });

  it("lets a query go on once settled, or at once when it was stopped meanwhile", async () => {
    let done = false;
    void tabSettled().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(TAB_SETTLE_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    const stop = new AbortController();
    let early = false;
    void tabSettled(stop.signal).then(() => (early = true));
    stop.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(early).toBe(true);
  });

  it("is how the roll waits, never InteractionManager", () => {
    for (const f of ["src/post/useRoll.ts", "app/(tabs)/create.tsx"]) {
      expect(code(f), f).not.toMatch(/InteractionManager/);
    }
    expect(code("src/post/useRoll.ts").match(/afterTabSettles\(/g)).toHaveLength(2);
  });
});
