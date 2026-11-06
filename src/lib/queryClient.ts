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
      // Each read is tried once whatever the phone says of its signal, and
      // only its further tries wait for one. In react-query's own mode
      // ("online") a read asked for with no signal was not tried at all,
      // and waited neither loading nor failed: reads of the phone's own,
      // which need no network (the photo library on On this day), waited
      // for one, and a screen opened that way (the app opened in a lift,
      // on a plane) drew its empty state: Home said "A quiet start" to a
      // member with a full feed. What a read that failed so shows is
      // decided below (showOfflineFirstReadsAsFailed).
      networkMode: "offlineFirst",
      // A stalled read is tried once more, not three times: each try is a
      // full request limit (src/lib/boundedFetch.ts) behind a skeleton.
      retry: retryRead,
      retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 5000),
    },
  },
});

/**
 * A screen's first read that failed with no signal, shown as failed.
 *
 * Its further tries wait for the signal (above), and while they wait the
 * read is neither loading nor failed, so Home, opened with no signal,
 * drew "A quiet start" and a pull to refresh did nothing. Marked failed
 * here, it says it could not load, with Try again, and the tries that
 * wait for the signal go on as soon as it returns and fill the screen in
 * by themselves.
 *
 * It is marked failed without being counted as an answer (`isFetched`
 * stays false), so a screen that waits for an answer before saying it is
 * empty (your profile's grid, the inbox) goes on waiting rather than
 * saying there is nothing. A read that has something keeps it, and is not
 * marked. Only with no signal: tries also wait while the app is in the
 * background, which is no failure. Returns the way to stop.
 */
export function showOfflineFirstReadsAsFailed(client: QueryClient): () => void {
  return client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "pause") return;
    const { state } = event.query;
    if (state.data !== undefined || state.status !== "pending" || onlineManager.isOnline()) return;
    event.query.setState({ status: "error", error: state.fetchFailureReason });
  });
}
showOfflineFirstReadsAsFailed(queryClient);

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
