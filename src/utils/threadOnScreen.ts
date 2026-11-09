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
let peerOnScreen: string | null = null;

/** The thread with `peerId` is in front. */
export function threadOnScreen(peerId: string): void {
  peerOnScreen = peerId;
}

/** The thread with `peerId` has left the front (another may have come). */
export function threadOffScreen(peerId: string): void {
  if (peerOnScreen === peerId) peerOnScreen = null;
}

/** Whether a notice's data is a message from the member whose thread is in front. */
export function fromThreadOnScreen(data: unknown): boolean {
  if (!peerOnScreen || !data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.kind === "message" && d.actorId === peerOnScreen;
}
