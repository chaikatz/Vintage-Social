/**
 * The member whose thread is on screen, if one is.
 *
 * Each message files a notice (0040), and the phone shows a notice that
 * arrives while the app is open. Two members talking in an open thread
 * would each get a banner for every line the other sends, over the very
 * line it announces. A message notice from the member whose thread is in
 * front is therefore not shown; the thread's own poll brings the message.
 * One from anyone else still is.
 */
let onScreen: { peer: string } | null = null;

/**
 * The thread with `peerId` is in front. Returns what to call as it leaves
 * the front: that clears it only if no thread came in front since, the
 * same member's included (a thread opened over another of theirs).
 */
export function threadOnScreen(peerId: string): () => void {
  const mine = { peer: peerId };
  onScreen = mine;
  return () => {
    if (onScreen === mine) onScreen = null;
  };
}

/** Whether a notice's data is a message from the member whose thread is in front. */
export function fromThreadOnScreen(data: unknown): boolean {
  if (!onScreen || !data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.kind === "message" && d.actorId === onScreen.peer;
}
