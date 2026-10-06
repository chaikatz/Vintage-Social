import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { isTransient } from "@/utils/retry";

/**
 * One cache for the whole app.
 *
 * A request that failed because the connection let go is tried again,
 * briefly spaced out; a refusal is not. Coming back from the background
 * re-reads what is on screen, and a signal that returns resumes whatever
 * was waiting on it — without either, a brief drop left a screen on its
 * empty state until someone pulled to refresh.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => failureCount < 3 && isTransient(error),
      retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 5000),
    },
  },
});

if (Platform.OS !== "web") {
  // react-query listens to `window` for these in a browser; the phone
  // has to be told.
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener("change", (state) => handleFocus(state === "active"));
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
