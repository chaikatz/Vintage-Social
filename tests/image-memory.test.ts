import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/** The AppState listeners, caught as iOS would call them. */
const appState = vi.hoisted(() => ({ listeners: new Set<(state: string) => void>() }));
const cleared = vi.hoisted(() => ({ count: 0 }));

vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appState.listeners.add(listener);
      return { remove: () => appState.listeners.delete(listener) };
    },
  },
}));
vi.mock("expo-image", () => ({
  Image: {
    clearMemoryCache: async () => {
      cleared.count += 1;
      return true;
    },
  },
}));

import { releaseImagesInBackground } from "@/utils/imageMemory";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");
const say = (...states: string[]) => states.forEach((s) => appState.listeners.forEach((l) => l(s)));

describe("a long session's decoded photographs", () => {
  it("are let go when the app goes to the background, once each time away", () => {
    cleared.count = 0;
    const stop = releaseImagesInBackground();
    // Control Center, a system question: still on screen, nothing let go.
    say("inactive", "active");
    expect(cleared.count).toBe(0);
    // Away: let go. Coming back reports "background" once more on the way in.
    say("inactive", "background");
    expect(cleared.count).toBe(1);
    say("background", "active");
    expect(cleared.count).toBe(1);
    // Away again.
    say("inactive", "background");
    expect(cleared.count).toBe(2);
    stop();
    say("active", "background");
    expect(cleared.count).toBe(2);
  });

  it("never throws into the app when the cache cannot be emptied", () => {
    const fails = vi.fn(() => Promise.reject(new Error("no module")));
    const throws = vi.fn(() => {
      throw new Error("no module");
    });
    const stopA = releaseImagesInBackground(undefined, fails);
    const stopB = releaseImagesInBackground(undefined, throws);
    expect(() => say("background")).not.toThrow();
    expect(fails).toHaveBeenCalledTimes(1);
    expect(throws).toHaveBeenCalledTimes(1);
    stopA();
    stopB();
    say("active");
  });

  it("is set up once, by the root layout, for the life of the app", () => {
    const layout = read("app/_layout.tsx");
    expect(layout).toMatch(/import \{ releaseImagesInBackground \} from "@\/utils\/imageMemory";/);
    // At module level, beside startOutbox(): not inside a component that could mount twice.
    expect(layout).toMatch(/^releaseImagesInBackground\(\);$/m);
  });
});
