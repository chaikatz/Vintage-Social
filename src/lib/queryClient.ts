import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { retryRead } from "@/utils/retry";

/**
 * One cache for the whole app.
 *
 * A request that failed because the connection let go is tried again,
 * briefly spaced out, and one that ran out of time once; a refusal is
 * not. Coming back from the background re-reads what is on screen, and a
 * signal that returns reads again whatever could not load without it —
 * without either, a brief drop left a screen on its empty state until
 * someone pulled to refresh.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A read is tried even when the phone says it is offline. In
      // react-query's own mode ("online") a read asked for with no signal
      // waits, neither loading nor failed, and a screen opened that way
      // (the app opened in a lift, on a plane) drew its empty state: Home
      // said "A quiet start" to a member with a full feed, and a pull to
      // refresh did nothing. Tried, it fails at once, and the screen says
      // it could not load, with Try again.
      networkMode: "always",
      // That mode would also stop reading again when the signal comes
      // back; this keeps it, so a screen that could not load fills in by
      // itself once the phone is online.
      refetchOnReconnect: true,
      // A stalled read is tried once more, not three times: each try is a
      // full request limit (src/lib/boundedFetch.ts) behind a skeleton.
      // With no signal at all it is not tried again: the signal's return
      // reads it again (above), and the screen need not sit on its
      // skeleton through three more tries (5.6 s of waits) to say it
      // could not load.
      retry: (failures, error) => onlineManager.isOnline() && retryRead(failures, error),
      retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 5000),
    },
  },
});

/**
 * Whether the app is in front, for react-query, as iOS reports a change:
 * away once it has gone to the background, back once it is active again,
 * and no change while it is only inactive. Inactive is the app still on
 * screen under something of the system's: Control Center, the
 * notification list pulled down, a permission question, Face ID, a call's
 * banner. Each of those used to count as leaving and coming back, and
 * re-read every screen still mounted (every tab, every page pushed over
 * them) at the moment the member returned to the app.
 */
export function focusAfter(state: string): boolean | null {
  if (state === "active") return true;
  if (state === "background") return false;
  return null;
}

if (Platform.OS !== "web") {
  // react-query listens to `window` for these in a browser; the phone
  // has to be told.
  focusManager.setEventListener((handleFocus) => {
    // Where it stands as this listens, so the first "active" after a
    // launch is not taken for a return.
    const now = focusAfter(AppState.currentState);
    if (now !== null) handleFocus(now);
    const sub = AppState.addEventListener("change", (state) => {
      const focused = focusAfter(state);
      if (focused !== null) handleFocus(focused);
    });
    return () => sub.remove();
  });
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      // Connected is enough. The reachability probe pings a third party that
      // some networks block, and it would pause every query while Supabase
      // itself was perfectly reachable.
      setOnline(state.isConnected !== false);
    }),
  );
}
