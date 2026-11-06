import { useCallback, useEffect, useRef, useState } from "react";
import { onlineManager } from "@tanstack/react-query";

/**
 * A photograph that failed to load, asked for again.
 *
 * The image view gives up on the first failure: a download cut off by a
 * weak signal, a request that timed out while a dozen others were going
 * on, a server that answered once with an error. A feed photograph then
 * stayed on its small grid copy, stretched to the width of the screen and
 * soft, and a grid square stayed empty, until the screen was left and
 * opened again. Now a failure is tried again a few times, a little later
 * each time, with the small copy still standing in meanwhile.
 *
 * The image view keeps no list of addresses that failed (expo-image asks
 * its loader to retry them), so drawing the image afresh is enough.
 *
 * The tries are spent in about fifteen seconds, and a member who scrolled
 * on through a longer loss of signal was left with the empty squares and
 * soft stretched copies until the screen was opened again. So a picture
 * whose last try failed is asked for again the moment the phone is back
 * online (react-query's online manager, which NetInfo drives; see
 * src/lib/queryClient.ts), with its tries afresh; and while the phone is
 * offline no try is spent on a wait that cannot succeed.
 */

/** Tries after the first failure. */
export const IMAGE_RETRIES = 3;

/** How long to wait before try `attempt` (1 is the first retry), in ms; null once they are spent. */
export function retryDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > IMAGE_RETRIES) return null;
  return [1_500, 4_000, 10_000][attempt - 1];
}

interface RetryState {
  source: unknown;
  /** The image's key: one more each time it is drawn afresh. */
  attempt: number;
  /** Tries spent since the first failure, or since the connection came back. */
  tries: number;
  /** Whether the last try failed. */
  failed: boolean;
}

function fresh(source: unknown): RetryState {
  return { source, attempt: 0, tries: 0, failed: false };
}

/**
 * Which try a picture is on, and what to call when one fails. `attempt`
 * goes on the image as its `key`, so a retry draws it afresh. A new
 * picture (`source` changes) starts again from the first try.
 */
export function useImageRetry(source: unknown): { attempt: number; onError: () => void } {
  const [state, setState] = useState<RetryState>(() => fresh(source));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = state.source === source ? state : fresh(source);
  if (current !== state) setState(current);

  // A retry still waiting for the picture before is called off when the
  // picture changes, and when the view goes.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [source],
  );

  const { attempt, tries, failed } = current;
  const onError = useCallback(() => {
    setState((s) => (s.source === source && !s.failed ? { ...s, failed: true } : s));
    // Offline, the wait would fail as well: the connection's return asks instead.
    if (!onlineManager.isOnline()) return;
    const delay = retryDelayMs(tries + 1);
    if (delay == null || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setState((s) => (s.source === source ? { source, attempt: s.attempt + 1, tries: s.tries + 1, failed: false } : s));
    }, delay);
  }, [tries, source]);

  // Only a picture whose last try failed listens for the connection.
  useEffect(() => {
    if (!failed) return;
    return onlineManager.subscribe((online) => {
      if (!online) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setState((s) => (s.source === source && s.failed ? { source, attempt: s.attempt + 1, tries: 0, failed: false } : s));
    });
  }, [failed, source]);

  return { attempt, onError };
}
