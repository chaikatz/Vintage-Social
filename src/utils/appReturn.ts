import { AppState } from "react-native";

/**
 * Whether the app has come back to the front from the background, told
 * each state iOS reports in turn.
 *
 * Only a return from the background counts. "inactive" is the app still
 * on screen under something of the system's (Control Center, the
 * notification list pulled down, a permission question, Face ID, a
 * call's banner), and the "active" after it is no return: work kept for
 * a return used to run for each of those too. Going away passes through
 * "inactive" to "background"; coming back is "background" to "active"
 * (React Native's RCTAppState reports the moment before as "background").
 * The same rule decides what React Query re-reads (src/lib/queryClient.ts).
 *
 * `initial` is the state as listening starts: an app launched into the
 * background has its first "active" counted as a return.
 */
export function returnTracker(initial: string | null | undefined): (state: string) => boolean {
  let away = initial === "background";
  return (state) => {
    if (state === "background") {
      away = true;
      return false;
    }
    if (state === "active" && away) {
      away = false;
      return true;
    }
    return false;
  };
}

/** Runs `run` on each return to the app from the background. Returns the way to stop. */
export function onReturnFromBackground(run: () => void): () => void {
  const back = returnTracker(AppState.currentState);
  const sub = AppState.addEventListener("change", (state) => {
    if (back(state)) run();
  });
  return () => sub.remove();
}
