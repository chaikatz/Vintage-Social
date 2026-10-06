import { useSyncExternalStore } from "react";

/**
 * Whether the tab pager may be swiped between tabs right now.
 *
 * The tabs live in a pager, which reads any horizontal movement as a
 * swipe to the next tab. A pinch on the timeline, or a drag across a
 * zoomed one, has a horizontal component too — and the pager took it,
 * shifting the whole screen sideways and sometimes changing tabs. A
 * screen that owns a gesture like that holds the lock for its duration;
 * the pager sits still while it is held.
 */
let holders = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Hold the pager still. Returns the release; releasing twice is harmless. */
export function holdTabSwipe(): () => void {
  holders += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    emit();
  };
}

/**
 * Whether the timeline should hold the pager right now. Only while it is
 * on the screen in view and either being pinched or left magnified: a
 * magnified line is dragged sideways with one finger, which is the pager's
 * gesture too, so the pager waits. At actual size, or shrunk, one finger
 * is the page's and a swipe changes tabs as anywhere else. Two fingers never
 * swipe the pager in any case — the native side sees to that — so the hold
 * here is for the one-finger drag, and a second line of defence for the pinch.
 */
export function shouldHoldTabSwipe(state: { focused: boolean; pinching: boolean; magnified: boolean }): boolean {
  return state.focused && (state.pinching || state.magnified);
}

/** For tests: how many holds are outstanding. */
export function tabSwipeHolds(): number {
  return holders;
}

export function useTabSwipeEnabled(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => holders === 0,
    () => true,
  );
}
