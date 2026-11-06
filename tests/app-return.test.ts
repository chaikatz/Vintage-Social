import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/** The AppState listeners, caught as iOS would call them. */
const appState = vi.hoisted(() => ({ current: "active", listeners: new Set<(state: string) => void>() }));

vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.current;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appState.listeners.add(listener);
      return { remove: () => appState.listeners.delete(listener) };
    },
  },
}));

import { onReturnFromBackground, returnTracker } from "@/utils/appReturn";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");
const say = (...states: string[]) => states.forEach((s) => appState.listeners.forEach((l) => l(s)));

describe("a return to the app", () => {
  it("is a return from the background, not from Control Center or a system question", () => {
    const back = returnTracker("active");
    expect(["inactive", "active"].map(back)).toEqual([false, false]);
    expect(["inactive", "background", "active"].map(back)).toEqual([false, false, true]);
    // Coming back reports "background" once more on the way in (RCTAppState).
    expect(["inactive", "background", "background", "active"].map(back)).toEqual([false, false, false, true]);
    expect(back("active")).toBe(false);
  });

  it("counts the first active of an app launched into the background", () => {
    expect(returnTracker("background")("active")).toBe(true);
  });

  it("is told to whoever listens, until they stop", () => {
    appState.current = "active";
    const run = vi.fn();
    const stop = onReturnFromBackground(run);
    say("inactive", "active");
    expect(run).not.toHaveBeenCalled();
    say("inactive", "background", "active");
    expect(run).toHaveBeenCalledTimes(1);
    stop();
    say("background", "active");
    expect(run).toHaveBeenCalledTimes(1);
    expect(appState.listeners.size).toBe(0);
  });
});

describe("On this day", () => {
  it("reads the library again on a return from Settings only, not under Control Center", () => {
    const screen = read("app/memories.tsx");
    expect(screen).toMatch(/return onReturnFromBackground\(\(\) => lookAgain\(reachNow\.current === "limited"\)\);/);
    expect(screen).not.toMatch(/AppState\.addEventListener/);
  });
});
