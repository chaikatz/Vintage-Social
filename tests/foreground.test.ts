import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/** The AppState listener the query client installs, caught as iOS would call it. */
const appState = vi.hoisted(() => ({ listeners: [] as ((state: string) => void)[] }));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appState.listeners.push(listener);
      return { remove: () => undefined };
    },
  },
}));
vi.mock("@react-native-community/netinfo", () => ({ default: { addEventListener: () => () => undefined } }));

import { QueryObserver, focusManager } from "@tanstack/react-query";
import { focusAfter, queryClient } from "@/lib/queryClient";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

describe("coming back to the app", () => {
  it("re-reads what is on screen after the background, not after Control Center or a system question", async () => {
    expect(focusAfter("active")).toBe(true);
    expect(focusAfter("background")).toBe(false);
    expect(focusAfter("inactive")).toBeNull();

    // A read on screen (an observer keeps it so), stale at once, and the
    // refetches coming back to the app starts.
    queryClient.mount();
    const queryFn = vi.fn(async () => "fresh");
    const watch = new QueryObserver(queryClient, { queryKey: ["on-screen"], queryFn, staleTime: 0 });
    const stop = watch.subscribe(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
    expect(queryFn).toHaveBeenCalledTimes(1);
    queryFn.mockClear();

    expect(appState.listeners.length).toBeGreaterThan(0);
    const say = (state: string) => appState.listeners.forEach((l) => l(state));

    // Control Center, a permission question: inactive, then active again.
    say("inactive");
    say("active");
    await new Promise((r) => setTimeout(r, 0));
    expect(queryFn).not.toHaveBeenCalled();
    expect(focusManager.isFocused()).toBe(true);

    // Away to the home screen and back.
    say("inactive");
    say("background");
    expect(focusManager.isFocused()).toBe(false);
    say("active");
    await new Promise((r) => setTimeout(r, 0));
    expect(queryFn).toHaveBeenCalledTimes(1);

    stop();
    queryClient.unmount();
  });

  it("the token refresher runs from launch, not only after the first trip to the background", () => {
    expect(read("src/lib/supabase.ts")).toMatch(
      /if \(!isDemoMode\(\) && AppState\.currentState !== "background"\) supabase\.auth\.startAutoRefresh\(\);/,
    );
  });
});
