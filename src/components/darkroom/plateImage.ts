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
 *    front of the member that has heard nothing for a while — no picture,
 *    no failure, no download progress — asks once more, and then says why
 *    it has no photograph (`stallCheck`, run by `PlateStall`), as a plate
 *    that failed outright does, and asks again by the same rules. Asking
 *    again cancels what Photos was doing, and Photos does not promise how
 *    often it reports a download's progress (Low Data Mode, or iCloud busy
 *    with a sync, can leave long gaps), so a plate is patient
 *    (`PLATE_PATIENCE_MS`) once iCloud has been heard sending its
 *    photograph, and before it gives up on its last try while online. And
 *    one that gave up only for hearing nothing asks again as soon as the
 *    member turns back to it, where one that Photos refused waits, as
 *    before, for the phone to come back online or the library to change.
 */

/** Pages before the settled one that keep a soft proof while their photograph comes: turning back to a print that had not drawn yet shows it soft, not an empty well. */
export const PROOF_BEHIND = 1;

/**
 * Pages after the settled one with a soft proof. The stage mounts only the
 * pages either side of the one in view, and the page after next is mounted
 * as a swipe begins, so on a quick double swipe it slides in before the
 * first swipe has settled: with a proof it slides in soft.
 */
export const PROOF_AHEAD = 2;

/**
 * Whether a page draws the soft proof (a 48 pt thumbnail Photos keeps on
 * the phone, scaled up): the settled page, the one before and the two
 * after. The full photograph is still asked for only by the pages the
 * stage has mounted.
 */
export function wantsProof(index: number, settled: number): boolean {
  return index >= settled - PROOF_BEHIND && index <= settled + PROOF_AHEAD;
}

/** The full image dissolves in over this; a print already drawn this visit comes from memory and does not. */
export const DISSOLVE = { duration: 240, effect: "cross-dissolve", timing: "ease-out" } as const;

/** Heard nothing at all of a first try for this long while in front of the member — no picture, no failure, no progress — a plate asks again; and, offline, says why. */
export const PLATE_STALL_MS = 12_000;

/** Online, the quiet a plate bears once iCloud has been heard sending its photograph, and on its last try before it says why. */
export const PLATE_PATIENCE_MS = 30_000;

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
 * How long the soft proof stays under a photograph that has come in: as
 * long as its dissolve, which expo-image runs from an empty view, so the
 * proof is what the photograph fades in over, never the bare well. At once
 * for a photograph that does not dissolve.
 */
export function proofHoldMs(request: Pick<PhotographRequest, "transition">): number {
  return request.transition === 0 ? 0 : request.transition.duration;
}

/** How far a plate zooms in under a pinch (its scroll view's `maximumZoomScale`). */
export const PLATE_ZOOM = 2;

export interface CloserRequest {
  cachePolicy: "none";
  priority: "normal";
  allowDownscaling: false;
  transition: typeof DISSOLVE | 0;
}

/**
 * A plate zoomed in draws its photograph a second time, over the first, at
 * the zoom's own size, so at the most zoom one pixel of it lands on one
 * pixel of the screen; the plate's own is asked for at the plate's size,
 * and only stretched by the zoom. It is there only while the plate in
 * front is zoomed in, and let go as it goes back to actual size: kept by
 * its view alone, never in the memory cache or on disk. Photos is asked
 * for it at that size, never for the original's own; and one that Photos
 * would have to bring down from iCloud is not waited for (`Closer`, in
 * PrintPage.tsx), so a pinch never starts a download.
 */
export function closerRequest(reduceMotion: boolean): CloserRequest {
  return {
    cachePolicy: "none",
    priority: "normal",
    allowDownscaling: false,
    transition: reduceMotion ? 0 : DISSOLVE,
  };
}

/** Where the closer photograph lies in a plate `box`: `PLATE_ZOOM` times its size, drawn at its scale, over it exactly. */
export function closerBox(box: { width: number; height: number }): {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
} {
  const width = box.width * PLATE_ZOOM;
  const height = box.height * PLATE_ZOOM;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height, scale: 1 / PLATE_ZOOM };
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
 * is then asked for again by the plate's own rules (`asksAgain`, and
 * `PlateStall.turnedTo`).
 */
export function stallCheck(heardAt: number, now: number, silentTries: number, online: boolean, downloading = false):
  | { wait: number }
  | { again: true }
  | { trouble: PlateTrouble } {
  const allowed = quietAllowed(silentTries, online, downloading);
  const quiet = now - heardAt;
  if (quiet < allowed) return { wait: allowed - quiet };
  if (silentTries < SILENT_TRIES) return { again: true };
  return { trouble: online ? "other" : "offline" };
}

/**
 * How long a plate in front may hear nothing before it acts. Offline,
 * nothing can be on its way, so not long. Online, `PLATE_STALL_MS` for a
 * first try that has heard nothing at all; `PLATE_PATIENCE_MS` once
 * iCloud has been heard sending the photograph, whose progress may come
 * seldom, and on the last try, after which the plate gives up.
 */
export function quietAllowed(silentTries: number, online: boolean, downloading: boolean): number {
  if (!online) return PLATE_STALL_MS;
  return downloading || silentTries >= SILENT_TRIES ? PLATE_PATIENCE_MS : PLATE_STALL_MS;
}

/** What a plate does when its stall watch acts: ask for its photograph again, or say why there is none. */
export interface StallActions {
  again: () => void;
  trouble: (why: PlateTrouble) => void;
}

/**
 * One plate's watch on a photograph that may never answer, for the life
 * of the plate: when it last heard anything, how many silent tries it
 * has made, whether iCloud has been heard sending this try, and whether
 * the trouble it shows came from hearing nothing rather than from Photos
 * saying no.
 */
export class PlateStall {
  private heardAt = 0;
  private tries = 0;
  private downloading = false;
  private gaveUp = false;

  constructor(private readonly clock: () => number = Date.now) {}

  /**
   * Watch while the plate waits in front of the member; returns the way
   * to stop. The quiet is counted from now, or from the last thing heard
   * if that is later.
   */
  watch(online: boolean, act: StallActions): () => void {
    this.heardAt = Math.max(this.heardAt, this.clock());
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      timer = null;
      const next = stallCheck(this.heardAt, this.clock(), this.tries, online, this.downloading);
      if ("wait" in next) {
        timer = setTimeout(check, next.wait);
      } else if ("again" in next) {
        this.tries += 1;
        this.heardAt = this.clock();
        this.downloading = false;
        act.again();
      } else {
        this.gaveUp = true;
        act.trouble(next.trouble);
      }
    };
    check();
    return () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
  }

  /** iCloud's progress on this try: something is coming. */
  heard(): void {
    this.heardAt = this.clock();
    this.downloading = true;
  }

  /** The photograph drew. */
  drew(): void {
    this.fresh();
  }

  /** Photos said no (expo-image's error): the plate's trouble is Photos' own, not a silence. */
  failed(): void {
    this.gaveUp = false;
    this.downloading = false;
  }

  /** Asked for again from the start: the library changed, the phone came back online, or the member turned back to it. */
  fresh(): void {
    this.tries = 0;
    this.downloading = false;
    this.gaveUp = false;
  }

  /**
   * The member has turned back to the plate: whether it asks again. Only
   * a plate that gave up for hearing nothing while online does. One that
   * says IN ICLOUD is asked again as the phone comes back online, and one
   * Photos refused as the phone does or the library changes (`asksAgain`).
   */
  turnedTo(trouble: PlateTrouble | null): boolean {
    return trouble === "other" && this.gaveUp;
  }
}
