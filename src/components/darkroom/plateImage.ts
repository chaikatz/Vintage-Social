import type { PlateTrouble } from "./words";

/**
 * How a plate asks for its photograph, as rules that need no screen.
 *
 * On the phone a print's address is Photos' own `ph://` URL, and expo-image
 * (3.0) asks Photos for it at the view's own size × the screen's scale.
 * Three things about that view decide how quickly a print comes clear:
 *
 * 1. Every prop that reaches the native view is part of a request. On iOS
 *    a change to any one of them makes the view load again
 *    (`OnViewDidUpdateProps` → `reload()` in expo-image's ImageModule),
 *    which first cancels whatever it is still loading. A plate used to
 *    change two as the member turned to it: its priority (low beside,
 *    high in front) and its dissolve (taken off once the print had drawn).
 *    So a print still coming in, from iCloud above all, was stopped and
 *    started again the moment it was turned to, and the plates on either
 *    side reloaded too. The priority does nothing for a `ph://` address:
 *    the Photos loader takes no notice of it. So the request is fixed
 *    when the view is made: the same priority for every plate, and the
 *    dissolve decided once, for the life of the view.
 * 2. Photos, asked for the plate's size, hands back an image "similar to,
 *    or slightly larger than" it (its fast resize mode). expo-image then
 *    redraws a larger image down to size on the main thread, on every
 *    load and every reload, just as a page settles. `allowDownscaling`
 *    off leaves that to the GPU, which draws a slightly larger image as
 *    sharply, and keeps one bitmap rather than two.
 * 3. A request the Photos loader cannot answer (iCloud would not send it)
 *    reaches expo-image as no image and no error, so the plate hears
 *    nothing, and its soft proof would stay in place for good. A plate in
 *    front of the member that has heard nothing for `PLATE_STALL_MS` —
 *    no picture, no failure, no download progress — asks once more, and
 *    then says why it has no photograph (`stallCheck`), as a plate that
 *    failed outright does, and asks again by the same rules.
 */

/** The full image dissolves in over this; a print already drawn this visit comes from memory and does not. */
export const DISSOLVE = { duration: 240, effect: "cross-dissolve", timing: "ease-out" } as const;

/** Heard nothing for this long while in front of the member — no picture, no failure, no progress — a plate asks again. */
export const PLATE_STALL_MS = 12_000;

/** Silent tries a plate makes before it says why it has no photograph. */
export const SILENT_TRIES = 1;

export interface PhotographRequest {
  cachePolicy: "memory";
  priority: "normal";
  allowDownscaling: false;
  transition: typeof DISSOLVE | 0;
}

/**
 * What the plate's full image asks for, worked out once as the view is
 * made. Nothing in it depends on whether the page is in front: turning a
 * page must not change a request. Kept in memory only: nothing from the
 * camera roll is written to the app's disk cache.
 */
export function photographRequest(dissolve: boolean, reduceMotion: boolean): PhotographRequest {
  return {
    cachePolicy: "memory",
    priority: "normal",
    allowDownscaling: false,
    transition: dissolve && !reduceMotion ? DISSOLVE : 0,
  };
}

/**
 * How far a download has come, 0 to 1, from expo-image's progress event;
 * null when it does not say. For a `ph://` address the phone sends only a
 * fraction (`progress`), and only while the photograph comes down from
 * iCloud; elsewhere it sends bytes loaded of a total.
 */
export function progressOf(event: unknown): number | null {
  const e = (event ?? {}) as { progress?: unknown; loaded?: unknown; total?: unknown };
  const fraction =
    typeof e.progress === "number"
      ? e.progress
      : typeof e.loaded === "number" && typeof e.total === "number" && e.total > 0
        ? e.loaded / e.total
        : NaN;
  return Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : null;
}

/**
 * A plate in front of the member, with neither its photograph nor a
 * failure yet: wait on (`wait`, how much longer) while it has heard
 * something lately — the request itself, or iCloud's progress — then ask
 * once more (`again`), and after that say why there is no photograph:
 * IN ICLOUD while offline, COULDN’T SHOW THIS ONE while online. Either
 * is then asked for again by the plate's own rules (`asksAgain`).
 */
export function stallCheck(heardAt: number, now: number, silentTries: number, online: boolean):
  | { wait: number }
  | { again: true }
  | { trouble: PlateTrouble } {
  const quiet = now - heardAt;
  if (quiet < PLATE_STALL_MS) return { wait: PLATE_STALL_MS - quiet };
  if (silentTries < SILENT_TRIES) return { again: true };
  return { trouble: online ? "other" : "offline" };
}
