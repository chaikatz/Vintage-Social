import { useCallback, useEffect, useRef } from "react";
import { enterApp, useSession } from "@/providers/SessionProvider";
import { shouldGoIn } from "./door";

/**
 * Sends a signed-in visitor through the door, once (see `shouldGoIn`).
 * Waits while `busy`: a join in progress goes in by itself when it lands,
 * through the `goIn` returned here, which also counts as the once.
 */
export function useDoorClosesBehind(busy: boolean): () => Promise<void> {
  const { session } = useSession();
  const gone = useRef(false);
  const goIn = useCallback(async () => {
    if (gone.current) return;
    gone.current = true;
    await enterApp();
  }, []);
  const signedIn = Boolean(session);
  useEffect(() => {
    if (shouldGoIn(signedIn, busy, gone.current)) void goIn();
  }, [signedIn, busy, goIn]);
  return goIn;
}
