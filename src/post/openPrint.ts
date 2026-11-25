import * as Haptics from "expo-haptics";
import { DEMO_PREFIX } from "@/demo/photos";
import { connection, developLocal, discardDeveloped } from "@/darkroom/develop";
import type { Print } from "@/darkroom/types";
import { showAlert } from "@/utils/alert";
import { composeParamsFor, discardOpened } from "@/utils/library";
import type { PickedParams } from "@/utils/pickForCompose";

/**
 * A photograph from the Post tab's roll, opened in the editor.
 *
 * On the phone it goes the way the library picker's do
 * (`composeParamsFor`): Photos renders its current version at the
 * editor's 2048 pixels, upright, bringing it down from iCloud when it
 * must, and never the full original or a Live Photo's video. The
 * library's identifier goes with it, so a post from the roll is
 * remembered as one from the Memory Room is: it comes off the shelf, and
 * the room's place moves on past it (`markDeveloped`, once the server has
 * the post). The browser demo's photographs are the app's own pictures,
 * opened as the room opens them. Either way the editor slides in as it
 * does from the pickers: nothing here says it came from the room.
 *
 * `signal` is the tab's: leaving it, or the app going to the background,
 * stops the work, and the answer is null. A photograph that could not be
 * opened is said so here, after the fact, in the words the library
 * picker uses, and the answer is null too.
 */
export async function openPrint(print: Print, signal?: AbortSignal): Promise<PickedParams | null> {
  if (typeof print.uri === "number" || print.uri.startsWith(DEMO_PREFIX)) {
    const result = await developLocal(print, { signal });
    if (result.status === "ok") {
      const { from: _room, ...params } = result.params;
      return params;
    }
    if (result.status !== "cancelled" && !signal?.aborted) await sayNotOpened();
    return null;
  }
  const params = await composeParamsFor(
    { id: print.id, uri: String(print.uri), width: print.width, height: print.height, creationTime: print.takenAt },
    { signal },
  );
  if (params) return { ...params, assetId: print.id };
  if (!signal?.aborted) await sayNotOpened();
  return null;
}

async function sayNotOpened(): Promise<void> {
  const offline = (await connection()) === "offline";
  showAlert(
    "Couldn’t open that one",
    offline ? "It may be in iCloud, and this iPhone is offline." : "It may still be in iCloud. Try again in a moment.",
  );
}

/** A copy made to open a photograph that will not be opened after all: only copies made here are ever deleted. */
export function discardPrintCopy(uri: string | null | undefined): void {
  discardOpened(uri);
  discardDeveloped(uri);
}

/** POST, once per attempt, as the room's DEVELOP is: one firm tap. */
export function postHaptic(): void {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => undefined);
  } catch {
    // No haptics here.
  }
}
