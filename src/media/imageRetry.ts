import { useCallback, useEffect, useRef, useState } from "react";

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
 */

/** Tries after the first failure. */
export const IMAGE_RETRIES = 3;

/** How long to wait before try `attempt` (1 is the first retry), in ms; null once they are spent. */
export function retryDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > IMAGE_RETRIES) return null;
  return [1_500, 4_000, 10_000][attempt - 1];
}

/**
 * Which try a picture is on, and what to call when one fails. `attempt`
 * goes on the image as its `key`, so a retry draws it afresh. A new
 * picture (`source` changes) starts again from the first try.
 */
export function useImageRetry(source: unknown): { attempt: number; onError: () => void } {
  const [state, setState] = useState({ source, attempt: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = state.source === source ? state : { source, attempt: 0 };
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

  const attempt = current.attempt;
  const onError = useCallback(() => {
    const delay = retryDelayMs(attempt + 1);
    if (delay == null || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setState((s) => (s.source === source ? { source, attempt: s.attempt + 1 } : s));
    }, delay);
  }, [attempt, source]);

  return { attempt, onError };
}
