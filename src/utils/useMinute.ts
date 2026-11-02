import { useSyncExternalStore } from "react";
import { AppState, type AppStateStatus } from "react-native";

/**
 * The time, kept to the minute, for every line on screen that says how
 * long ago something was: "29m ago" becomes "30m ago" without anyone
 * touching the page.
 *
 * One clock for the whole app, not one per card. The first line on screen
 * that wants the time starts it; it moves on once a minute and tells every
 * line at once; it stops when the last line goes. While the app is in the
 * background it does not tick at all, and when the app is back it reads the
 * time at once, so a phone picked up after an hour says so before the next
 * minute comes round.
 *
 * The time it holds changes only when it ticks, so a page drawn twice in a
 * minute is drawn the same way both times.
 */

const MINUTE = 60_000;

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let appState: { remove: () => void } | null = null;

function tick(): void {
  now = Date.now();
  for (const listener of [...listeners]) listener();
}

function run(): void {
  if (!timer) timer = setInterval(tick, MINUTE);
}

function pause(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function start(): void {
  if (AppState.currentState !== "background") run();
  appState = AppState.addEventListener("change", (next: AppStateStatus) => {
    if (next === "background") {
      pause();
    } else if (!timer) {
      // Back in front: the time is read now, not at the next minute.
      tick();
      run();
    }
  });
}

function stop(): void {
  pause();
  appState?.remove();
  appState = null;
}

export const minuteClock = {
  /**
   * The time as of the last tick, in milliseconds. With nothing on screen
   * keeping it, the last reading may be old, so the first line to ask
   * after a quiet spell is given the time afresh.
   */
  get(): number {
    if (listeners.size === 0 && Date.now() - now >= MINUTE) now = Date.now();
    return now;
  },
  /** Follow the clock. The first to follow starts it; the last to leave stops it. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1) start();
    return () => {
      if (!listeners.delete(listener)) return;
      if (listeners.size === 0) stop();
    };
  },
};

/** The time, kept current to the minute, in milliseconds. */
export function useMinute(): number {
  return useSyncExternalStore(minuteClock.subscribe, minuteClock.get, minuteClock.get);
}
