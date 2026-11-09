import { useCallback, useEffect, useRef } from "react";
import { enterApp, useSession } from "@/providers/SessionProvider";
import { shouldGoIn } from "./door";

/**
 * Sends a signed-in visitor through the door, once (see `shouldGoIn`).
 * Waits while `busy`: a join in progress goes in by itself when it lands,
 * through the `goIn` returned here, which also counts as the once.
 * `invitation` goes with them, for the waiting room (`invitationCarried`).
 */
export function useDoorClosesBehind(busy: boolean, invitation?: string): () => Promise<void> {
  const { session } = useSession();
  const gone = useRef(false);
  // As it stands when the visitor goes in, not when goIn was made.
  const carried = useRef(invitation);
  carried.current = invitation;
  const goIn = useCallback(async () => {
    if (gone.current) return;
    gone.current = true;
    await enterApp(carried.current);
  }, []);
  const signedIn = Boolean(session);
  useEffect(() => {
    if (shouldGoIn(signedIn, busy, gone.current)) void goIn();
  }, [signedIn, busy, goIn]);
  return goIn;
}
