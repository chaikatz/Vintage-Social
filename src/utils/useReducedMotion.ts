import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Following a setting the member chose in iOS Settings › Accessibility,
 * and Reduce Motion first among them.
 *
 * Each setting is one small store: the first screen that wants it asks iOS
 * for the current value and listens for changes, every later screen reads
 * the answer already in hand, and the listener goes when the last screen
 * that wanted it does. So a page mounted halfway through a visit starts
 * with the right value rather than off for a frame and then on — which
 * for Reduce Motion is the difference between a cut and the start of a
 * fade — and ten pages on screen are one listener, not ten.
 *
 * Until iOS has answered, a setting reads as off. The last answer is kept
 * after the last listener goes, as the best guess for the next one, and
 * asked for again when it comes.
 *
 * The room's other settings (Increase Contrast, Bold Text, VoiceOver) are
 * in `useRoomAccessibility.ts` and use the same store.
 */

/** The change events these settings follow, as React Native names them. */
export type AccessibilityChangeEvent =
  | "reduceMotionChanged"
  | "darkerSystemColorsChanged"
  | "boldTextChanged"
  | "screenReaderChanged";

export interface AccessibilitySetting {
  /** The last answer, or off before there has been one. */
  get(): boolean;
  /** Listen for changes. The first listener starts the reading; the last to leave stops it. */
  subscribe(listener: () => void): () => void;
}

/**
 * A setting read with `read()` and followed through `event`. `read` may
 * return undefined where the platform has no such question (the browser
 * has no Bold Text), and the setting then simply stays off.
 */
export function accessibilitySetting(
  read: () => Promise<boolean> | undefined,
  event: AccessibilityChangeEvent,
): AccessibilitySetting {
  let on = false;
  const listeners = new Set<() => void>();
  let stop: (() => void) | null = null;

  const set = (next: boolean) => {
    if (next === on) return;
    on = next;
    for (const listener of [...listeners]) listener();
  };

  const start = () => {
    let live = true;
    // A change heard before the first answer arrives is newer than that
    // answer, which was asked for before the change was made.
    let heard = false;
    let subscription: { remove?: () => void } | undefined;
    try {
      subscription = AccessibilityInfo.addEventListener(event, (value: unknown) => {
        if (!live) return;
        heard = true;
        set(value === true);
      });
    } catch {
      // No such event here; the first answer is all there will be.
    }
    try {
      read()
        ?.then((value) => {
          if (live && !heard) set(value === true);
        })
        .catch(() => undefined);
    } catch {
      // No such question here: it stays as it was.
    }
    stop = () => {
      live = false;
      // The browser hands back nothing at all for an event it cannot follow.
      subscription?.remove?.();
    };
  };

  return {
    get: () => on,
    subscribe: (listener) => {
      listeners.add(listener);
      if (!stop) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && stop) {
          stop();
          stop = null;
        }
      };
    },
  };
}

/** Kept current on screen. */
export function useAccessibilitySetting(setting: AccessibilitySetting): boolean {
  return useSyncExternalStore(setting.subscribe, setting.get, setting.get);
}

/**
 * Reduce Motion. In the browser it is the page's `prefers-reduced-motion`.
 * `reducedMotion.get()` is the same answer outside a component, for code
 * running in a callback.
 */
export const reducedMotion = accessibilitySetting(() => AccessibilityInfo.isReduceMotionEnabled(), "reduceMotionChanged");

/**
 * Whether Reduce Motion is on. Where it is, every fade, cross-dissolve,
 * scale and slide of the Darkroom's own becomes a cut; the native-stack
 * fades stay, as they are iOS's own answer to the setting.
 */
export function useReducedMotion(): boolean {
  return useAccessibilitySetting(reducedMotion);
}
